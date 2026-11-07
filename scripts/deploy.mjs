// Sets up (first time) and updates the bot on Cloudflare. Run with: npm run deploy
// Safe to run as many times as you like, e.g. after editing .env or template.txt.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { commands } from '../src/command-definitions.js';
import { parseConfig } from '../src/config.js';
import { discordRequest } from '../src/discord-api.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const wranglerBin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
const tomlFile = fileURLToPath(new URL('../wrangler.toml', import.meta.url));
const templateFile = fileURLToPath(new URL('../template.txt', import.meta.url));
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const TOTAL = 7;

const step = (n, text) => console.log(`\n[${n}/${TOTAL}] ${text}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function fail(text) {
  console.error(`\nX ${text}\n`);
  process.exit(1);
}

function wrangler(args, { input, quiet = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [wranglerBin, ...args], { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const collect = (stream) => (chunk) => {
      output += chunk;
      if (!quiet) stream.write(chunk);
    };
    child.stdout.on('data', collect(process.stdout));
    child.stderr.on('data', collect(process.stderr));
    child.stdin.end(input ?? '');
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(output) : reject(Object.assign(new Error(`wrangler ${args[0]} failed`), { output })),
    );
  });
}

function connectToGatewayOnce(token) {
  // Discord requires a bot to connect to its gateway at least once before it can post messages.
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://gateway.discord.gg/?v=10&encoding=json');
    let ready = false;
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('Timed out connecting to Discord.'));
    }, 30_000);
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.op === 10) {
        ws.send(JSON.stringify({ op: 2, d: { token, intents: 0, properties: { os: process.platform, browser: 'qotd-bot', device: 'qotd-bot' } } }));
      } else if (msg.op === 0 && msg.t === 'READY') {
        ready = true;
        clearTimeout(timer);
        ws.close(1000);
        resolve();
      }
    });
    ws.addEventListener('close', (event) => {
      clearTimeout(timer);
      if (!ready) reject(new Error(`Discord closed the connection (code ${event.code}).`));
    });
  });
}

// 1. Settings ---------------------------------------------------------------
step(1, 'Checking your .env settings');
let config;
try {
  config = parseConfig(process.env);
} catch (err) {
  fail(`Your .env file needs fixing:\n${err.message}`);
}
const template = existsSync(templateFile) ? readFileSync(templateFile, 'utf8') : '';
if (!template.includes('{number}')) console.warn("  Warning: template.txt has no {number}, so the question number won't show up.");
console.log(`  Daily ping at ${config.pingTime} ${config.timezone}`);

// 2. Discord ----------------------------------------------------------------
step(2, 'Checking the bot can reach your staff server and channel');
const bot = (path, options) => discordRequest(config.api, path, { token: config.token, ...options });
let app;
try {
  app = await bot('/applications/@me');
} catch (err) {
  if (err.status === 401) fail('Discord rejected DISCORD_TOKEN. Reset the token in the Developer Portal (Bot page) and paste the new one into .env.');
  throw err;
}
const invite = `https://discord.com/oauth2/authorize?client_id=${app.id}&scope=bot+applications.commands&permissions=3072`;
console.log(`  Bot: ${app.bot?.username ?? app.name}`);
try {
  const guild = await bot(`/guilds/${config.staffGuildId}`);
  console.log(`  Server: ${guild.name}`);
} catch (err) {
  if ([403, 404].includes(err.status)) {
    fail(`The bot isn't in the staff server, or STAFF_GUILD_ID is wrong.\nInvite it to the staff server with this link, then run this again:\n${invite}`);
  }
  throw err;
}
try {
  const channel = await bot(`/channels/${config.staffChannelId}`);
  if (channel.guild_id !== config.staffGuildId) fail('STAFF_CHANNEL_ID is a channel in a different server. Copy the ID of a channel in the staff server.');
  console.log(`  Channel: #${channel.name}`);
} catch (err) {
  if ([403, 404].includes(err.status)) {
    fail("The bot can't see the staff channel. Check STAFF_CHANNEL_ID, and give the bot View Channel + Send Messages in that channel.");
  }
  throw err;
}

// 3. Gateway + commands -----------------------------------------------------
step(3, 'Registering the /qotd command');
await connectToGatewayOnce(config.token);
try {
  await bot(`/applications/${app.id}/guilds/${config.staffGuildId}/commands`, { method: 'PUT', body: commands });
} catch (err) {
  if (err.status === 403) fail(`The bot isn't allowed to add commands. Re-invite it with this link (no need to kick it first):\n${invite}`);
  throw err;
}

// 4. Cloudflare login + database --------------------------------------------
step(4, 'Checking your Cloudflare login and database');
const whoami = await wrangler(['whoami'], { quiet: true }).catch((err) => err.output ?? '');
if (/not authenticated|not logged in/i.test(whoami)) fail('You are not logged in to Cloudflare. Run this first, then try again:\n  npx wrangler login');

let toml = readFileSync(tomlFile, 'utf8');
if (/database_id\s*=\s*""/.test(toml)) {
  const listOutput = await wrangler(['d1', 'list', '--json'], { quiet: true });
  const databases = JSON.parse(listOutput.slice(listOutput.indexOf('[')));
  let id = databases.find((db) => db.name === 'qotd-bot')?.uuid;
  if (!id) {
    console.log('  Creating the database (first time only)...');
    id = (await wrangler(['d1', 'create', 'qotd-bot'], { quiet: true })).match(UUID)?.[0];
    if (!id) fail("Created the database but couldn't read its ID. Run `npx wrangler d1 list` and paste the qotd-bot ID into wrangler.toml.");
  }
  toml = toml.replace(/database_id\s*=\s*""/, `database_id = "${id}"`);
  writeFileSync(tomlFile, toml);
  console.log(`  Database ready (${id})`);
} else {
  console.log('  Database ready');
}

// 5. Upload -----------------------------------------------------------------
step(5, 'Uploading the bot to Cloudflare');
const vars = {
  STAFF_GUILD_ID: config.staffGuildId,
  STAFF_CHANNEL_ID: config.staffChannelId,
  QOTD_ROLE_ID: config.qotdRoleId,
  MANAGER_ROLE_ID: config.managerRoleId,
  PING_TIME: config.pingTime,
  TIMEZONE: config.timezone,
};
const varArgs = Object.entries(vars)
  .filter(([, value]) => value)
  .flatMap(([key, value]) => ['--var', `${key}:${value}`]);
let deployOutput;
try {
  deployOutput = await wrangler(['deploy', ...varArgs]);
} catch (err) {
  if (/workers\.dev subdomain/i.test(err.output ?? '')) {
    fail('Cloudflare needs you to pick a workers.dev subdomain first: open https://dash.cloudflare.com, go to Workers & Pages, follow the setup, then run this again.');
  }
  throw err;
}
const url = deployOutput.match(/https:\/\/[\w.-]+\.workers\.dev/)?.[0];
if (!url) fail("Uploaded, but couldn't find the bot's workers.dev address in the output above.");

// 6. Secrets ----------------------------------------------------------------
step(6, 'Saving the bot token securely on Cloudflare');
await wrangler(['secret', 'bulk'], {
  input: JSON.stringify({ DISCORD_TOKEN: config.token, DISCORD_PUBLIC_KEY: app.verify_key }),
});

// 7. Point Discord at the Worker ---------------------------------------------
step(7, 'Connecting Discord to the bot');
if (app.interactions_endpoint_url === url) {
  console.log('  Already connected');
} else {
  for (let attempt = 1; ; attempt++) {
    try {
      await bot('/applications/@me', { method: 'PATCH', body: { interactions_endpoint_url: url } });
      break;
    } catch (err) {
      // Discord tests the address before accepting it; a fresh upload can take a few seconds to go live.
      if (attempt >= 6) fail(`Discord couldn't reach the bot at ${url}.\n${err.message}`);
      await sleep(5000);
    }
  }
  console.log(`  Discord will send /qotd commands to ${url}`);
}

console.log(`
Done! The bot is live on Cloudflare and runs 24/7, even when your computer is off.
It shows as "offline" in the member list. That's normal for this kind of bot.

Next, in the staff server:
  /qotd set-number 75      (the next question number)
  /qotd add @person        (once per staff member, in turn order)
  /qotd schedule           (check it looks right)
`);
