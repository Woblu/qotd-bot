import { UserError } from './core.js';

export const MANAGER_ONLY = new Set(['add', 'remove', 'set-next', 'set-number', 'ping-now']);

const ADMINISTRATOR = 0x8n;
const MANAGE_GUILD = 0x20n;

export function isManager(member, config) {
  let permissions = 0n;
  try {
    permissions = BigInt(member?.permissions ?? 0);
  } catch {}
  if (permissions & (ADMINISTRATOR | MANAGE_GUILD)) return true;
  return Boolean(config.managerRoleId && member?.roles?.includes(config.managerRoleId));
}

export function managerOnlyMessage(config) {
  const role = config.managerRoleId ? ` or the <@&${config.managerRoleId}> role` : '';
  return `Only QOTD managers can use that (Manage Server permission${role}).`;
}

/**
 * Runs one /qotd subcommand against `q` and returns the (private) reply text.
 * `ctx` is { callerId, isManager, users } where `users` holds the resolved user objects.
 */
export function commandReply(q, sub, opts, ctx) {
  const when = (date) => `<t:${q.pingTimestamp(date)}:f>`;
  const nextTurn = () => q.upcoming(1).find((e) => !e.done);

  switch (sub) {
    case 'template': {
      const today = q.todaysTurn();
      if (opts.number) return `Template for **Question ${opts.number}**:\n${q.templateBlock(opts.number)}`;
      if (today) {
        return `Today is **Question ${today.number}** (<@${today.userId}>'s turn):\n${q.templateBlock(today.number)}`;
      }
      return `The next question is **Question ${q.state.nextNumber}**:\n${q.templateBlock(q.state.nextNumber)}`;
    }

    case 'schedule': {
      const { rotation } = q.state;
      if (!rotation.length) return 'The rotation is empty. A manager can add people with `/qotd add`.';
      const count = Math.min(Math.max(rotation.length, 7), 14);
      const lines = q
        .upcoming(count)
        .map((e) => `**Q${e.number}** · <@${e.userId}> · ${e.done ? 'today (already pinged)' : when(e.date)}`);
      return [
        `**Upcoming QOTD turns** (pings daily at ${q.config.pingTime} ${q.config.timezone})`,
        ...lines,
        '',
        `**Rotation order:** ${rotation.map((id) => `<@${id}>`).join(' → ')}`,
      ].join('\n');
    }

    case 'skip': {
      const today = q.todaysTurn();
      if (today && today.userId !== ctx.callerId && !ctx.isManager) {
        throw new UserError("Only the person whose turn it is (or a QOTD manager) can pass today's turn.");
      }
      const r = q.skip();
      return `Done. Today's turn (Question ${r.number}) went to <@${r.userId}>, and they've been pinged.`;
    }

    case 'add': {
      if (ctx.users[opts.user]?.bot) throw new UserError("Bots can't take a QOTD turn.");
      const r = q.add(opts.user, opts.position);
      const lines = [`Added <@${opts.user}> at spot ${r.spot} of ${r.total}.`];
      if (r.wasEmpty) {
        lines.push(`The first ping will be **Question ${q.state.nextNumber}**. Use \`/qotd set-number\` if that's wrong.`);
      }
      if (r.firstPingTomorrow) {
        lines.push(
          `Today's ping time has passed, so the first ping is ${when(nextTurn().date)}. Use \`/qotd ping-now\` to start today instead.`,
        );
      }
      return lines.join('\n');
    }

    case 'remove': {
      const r = q.remove(opts.user);
      let reply = `Removed <@${opts.user}>. ${r.total} ${r.total === 1 ? 'person' : 'people'} left in the rotation.`;
      if (r.hasTodaysTurn) reply += "\nThey still have today's turn. Use `/qotd skip` to hand it to someone else.";
      return reply;
    }

    case 'set-next': {
      q.setNext(opts.user);
      const next = nextTurn();
      return `<@${opts.user}> is up next: **Question ${next.number}**, ${when(next.date)}.`;
    }

    case 'set-number': {
      const r = q.setNumber(opts.number);
      if (!r.today) return `The next ping will be **Question ${opts.number}**.`;
      let reply = `Today's question (<@${r.today.userId}>) is **Question ${opts.number}**, and the next ping will be **Question ${opts.number + 1}**.`;
      if (r.corrected) reply += '\nI sent them the corrected template.';
      return reply;
    }

    case 'ping-now': {
      const r = q.pingNow();
      return r.resent
        ? `Re-sent today's ping to <@${r.userId}> (Question ${r.number}).`
        : `Sent! <@${r.userId}> was pinged for Question ${r.number}. The scheduled ping won't fire again today.`;
    }

    default:
      throw new UserError('Unknown command. Run `npm run deploy` again to refresh the commands.');
  }
}
