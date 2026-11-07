import { addDays, zonedTimeToUnix } from './time.js';

/** An error whose message is safe and useful to show the person who ran a command. */
export class UserError extends Error {}

export const DEFAULT_TEMPLATE = `{role}  **__Question {number}__**
**Your question here**

Discuss in the attached thread and if you want to get pinged, collect the role in <id:customize>`;

// nextNumber: question number the next ping will use
// rotation:   staff user IDs, in turn order
// nextIndex:  position in `rotation` of whoever is up next
// today:      { date, userId, number } for the turn already handed out today
// noPingOn:   a date (YYYY-MM-DD) on which the daily ping should not fire
export const defaultState = () => ({ nextNumber: 1, rotation: [], nextIndex: 0, today: null, noPingOn: null });

const INSTRUCTIONS = 'Pick a question and post it in the DDL server using this template (and start a thread on it):';

/**
 * All the QOTD rules. Methods change `state` and queue pings in `outbox`;
 * the caller saves the state and then sends the pings.
 */
export class Qotd {
  /** `now` is { date: 'YYYY-MM-DD', minutes } in the configured timezone. */
  constructor(state, config, now) {
    this.state = state;
    this.config = config;
    this.now = now;
    this.outbox = [];
  }

  pingTimePassed() {
    return this.now.minutes >= this.config.pingHour * 60 + this.config.pingMinute;
  }

  /** Unix seconds of the ping time on a given date. */
  pingTimestamp(date) {
    return zonedTimeToUnix(date, this.config.pingHour, this.config.pingMinute, this.config.timezone);
  }

  /** Today's turn, if it has already been handed out. */
  todaysTurn() {
    const today = this.state.today;
    return today && today.date === this.now.date ? today : null;
  }

  template(number) {
    const text = this.config.template?.trimEnd() || DEFAULT_TEMPLATE;
    const role = this.config.qotdRoleId ? `<@&${this.config.qotdRoleId}>` : '@Daily Questions Ping';
    return text.replaceAll('{number}', String(number)).replaceAll('{role}', role);
  }

  templateBlock(number) {
    return '```\n' + this.template(number) + '\n```';
  }

  ping(userId, number, intro) {
    this.outbox.push({ userId, content: `${intro}\n${this.templateBlock(number)}` });
  }

  assignNext() {
    const { rotation } = this.state;
    if (!rotation.length) throw new UserError('The rotation is empty. Add people with `/qotd add` first.');
    const index = this.state.nextIndex % rotation.length;
    const userId = rotation[index];
    const number = this.state.nextNumber;
    this.ping(userId, number, `<@${userId}> it's your turn for QOTD today! You're doing **Question ${number}**.\n${INSTRUCTIONS}`);
    this.state.today = { date: this.now.date, userId, number };
    this.state.nextIndex = (index + 1) % rotation.length;
    this.state.nextNumber = number + 1;
    this.state.noPingOn = null;
    return this.state.today;
  }

  /** Runs every minute: hands out today's turn once the ping time has passed (also catches up after an outage). */
  dailyTick() {
    if (!this.pingTimePassed() || this.todaysTurn() || this.state.noPingOn === this.now.date) return null;
    if (!this.state.rotation.length) return null;
    return this.assignNext();
  }

  /** Sends today's ping right away, or re-sends it if it already went out. */
  pingNow() {
    const today = this.todaysTurn();
    if (!today) return { resent: false, ...this.assignNext() };
    this.ping(
      today.userId,
      today.number,
      `<@${today.userId}> reminder: it's your turn for QOTD today! You're doing **Question ${today.number}**.\n${INSTRUCTIONS}`,
    );
    return { resent: true, ...today };
  }

  /** Hands today's turn to the next person in line. The rotation carries on from them. */
  skip() {
    const today = this.todaysTurn();
    if (!today) throw new UserError("Nobody has been pinged for today yet, so there's no turn to pass.");
    const { rotation } = this.state;
    const start = rotation.length ? this.state.nextIndex % rotation.length : 0;
    let chosen = -1;
    for (let i = 0; i < rotation.length; i++) {
      const index = (start + i) % rotation.length;
      if (rotation[index] !== today.userId) {
        chosen = index;
        break;
      }
    }
    if (chosen === -1) throw new UserError("There's nobody else in the rotation to pass today's turn to.");

    const previous = today.userId;
    const userId = rotation[chosen];
    this.ping(
      userId,
      today.number,
      `<@${userId}> <@${previous}> passed today's QOTD to you, so you're up! You're doing **Question ${today.number}**.\n${INSTRUCTIONS}`,
    );
    this.state.today = { ...today, userId };
    this.state.nextIndex = (chosen + 1) % rotation.length;
    return { previous, userId, number: today.number };
  }

  /** Sets the question number. If today's ping already went out, it's corrected and re-sent. */
  setNumber(number) {
    const today = this.todaysTurn();
    if (!today) {
      this.state.nextNumber = number;
      return { today: null, corrected: false };
    }
    const corrected = today.number !== number;
    today.number = number;
    this.state.nextNumber = number + 1;
    if (corrected) {
      this.ping(today.userId, number, `<@${today.userId}> correction: today's QOTD is **Question ${number}**. Here's the fixed template:`);
    }
    return { today, corrected };
  }

  add(userId, position) {
    const { rotation } = this.state;
    if (rotation.includes(userId)) {
      throw new UserError(`<@${userId}> is already in the rotation (spot ${rotation.indexOf(userId) + 1}).`);
    }
    const wasEmpty = rotation.length === 0;
    const index = position ? Math.min(position - 1, rotation.length) : rotation.length;
    rotation.splice(index, 0, userId);

    let firstPingTomorrow = false;
    if (wasEmpty) {
      this.state.nextIndex = 0;
      // Don't surprise anyone with an instant ping if setup happens after today's ping time.
      if (this.pingTimePassed() && !this.todaysTurn()) {
        this.state.noPingOn = this.now.date;
        firstPingTomorrow = true;
      }
    } else if (index < this.state.nextIndex) {
      this.state.nextIndex++;
    }
    return { spot: index + 1, total: rotation.length, wasEmpty, firstPingTomorrow };
  }

  remove(userId) {
    const { rotation } = this.state;
    const index = rotation.indexOf(userId);
    if (index === -1) throw new UserError(`<@${userId}> isn't in the rotation.`);
    rotation.splice(index, 1);
    if (index < this.state.nextIndex) this.state.nextIndex--;
    if (this.state.nextIndex >= rotation.length) this.state.nextIndex = 0;
    return { total: rotation.length, hasTodaysTurn: this.todaysTurn()?.userId === userId };
  }

  setNext(userId) {
    const index = this.state.rotation.indexOf(userId);
    if (index === -1) throw new UserError(`<@${userId}> isn't in the rotation. Add them with \`/qotd add\` first.`);
    this.state.nextIndex = index;
  }

  /** Upcoming turns, starting with today's if it already went out. */
  upcoming(count) {
    const today = this.todaysTurn();
    const { rotation, nextIndex, nextNumber } = this.state;
    const entries = [];
    if (today) entries.push({ date: this.now.date, userId: today.userId, number: today.number, done: true });
    const first = today || this.state.noPingOn === this.now.date ? addDays(this.now.date, 1) : this.now.date;
    for (let i = 0; i < count && rotation.length; i++) {
      entries.push({
        date: addDays(first, i),
        userId: rotation[(nextIndex + i) % rotation.length],
        number: nextNumber + i,
        done: false,
      });
    }
    return entries;
  }
}
