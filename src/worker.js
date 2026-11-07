// Cloudflare Worker entry point.
// - fetch():     Discord sends every /qotd command here (the "Interactions Endpoint URL").
// - scheduled(): Cloudflare runs this every minute; it sends the daily ping once it's ping time.
import templateText from '../template.txt';
import { commandReply, isManager, MANAGER_ONLY, managerOnlyMessage } from './commands.js';
import { parseConfig } from './config.js';
import { Qotd, UserError } from './core.js';
import { DEFAULT_API, editOriginalResponse, sendPing, verifySignature } from './discord-api.js';
import { readState, writeState } from './storage.js';
import { zonedNow } from './time.js';

const EPHEMERAL = 64;

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * Loads the state, runs `fn` on it, saves, then sends any queued pings.
 * Retries if something else saved at the same moment. If a ping fails, the change is rolled back.
 */
async function transact(env, config, fn) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const { state, version } = await readState(env.DB);
    const snapshot = JSON.stringify(state);
    const q = new Qotd(state, config, zonedNow(config.timezone));
    const result = fn(q);
    const changed = JSON.stringify(q.state) !== snapshot;
    if (changed && !(await writeState(env.DB, q.state, version))) continue;
    try {
      for (const message of q.outbox) await sendPing(config, message);
    } catch (err) {
      if (changed) await writeState(env.DB, JSON.parse(snapshot), version + 1).catch(() => {});
      throw err;
    }
    return result;
  }
  throw new UserError('The bot was busy. Please try again.');
}

async function handleCommand(interaction, env) {
  let content;
  try {
    const config = parseConfig(env, templateText);
    const sub = interaction.data?.options?.[0];
    if (interaction.data?.name !== 'qotd' || !sub) throw new UserError('Unknown command.');

    const member = interaction.member ?? {};
    const ctx = {
      callerId: member.user?.id ?? interaction.user?.id,
      isManager: isManager(member, config),
      users: interaction.data.resolved?.users ?? {},
    };
    if (MANAGER_ONLY.has(sub.name) && !ctx.isManager) throw new UserError(managerOnlyMessage(config));

    const opts = Object.fromEntries((sub.options ?? []).map((o) => [o.name, o.value]));
    content = await transact(env, config, (q) => commandReply(q, sub.name, opts, ctx));
  } catch (err) {
    if (err instanceof UserError) {
      content = err.message;
    } else {
      console.error('Command failed:', err);
      content = `Something went wrong: ${err.message}`;
    }
  }
  await editOriginalResponse(env.DISCORD_API || DEFAULT_API, interaction, content).catch((err) =>
    console.error("Couldn't send the command reply:", err),
  );
}

export default {
  async fetch(request, env, ctx) {
    if (request.method !== 'POST') return new Response('QOTD bot is running.');

    const body = await request.text();
    const valid = await verifySignature(
      env.DISCORD_PUBLIC_KEY,
      request.headers.get('X-Signature-Ed25519'),
      request.headers.get('X-Signature-Timestamp'),
      body,
    );
    if (!valid) return new Response('Invalid request signature', { status: 401 });

    const interaction = JSON.parse(body);
    if (interaction.type === 1) return json({ type: 1 }); // Discord checking the endpoint works
    if (interaction.type === 2) {
      // Show "thinking..." right away, then fill in the reply (Discord only waits 3 seconds).
      ctx.waitUntil(handleCommand(interaction, env));
      return json({ type: 5, data: { flags: EPHEMERAL } });
    }
    return new Response('Unsupported interaction type', { status: 400 });
  },

  async scheduled(controller, env) {
    const config = parseConfig(env, templateText);
    const now = zonedNow(config.timezone);
    if (now.minutes < config.pingHour * 60 + config.pingMinute) return;
    const turn = await transact(env, config, (q) => q.dailyTick());
    if (turn) console.log(`[${turn.date}] Pinged ${turn.userId} for Question ${turn.number}`);
  },
};
