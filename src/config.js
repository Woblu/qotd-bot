import { DEFAULT_API } from './discord-api.js';

const SNOWFLAKE = /^\d{17,20}$/;

/** Reads settings from .env (when deploying) or Cloudflare secrets (when running). Throws listing every problem. */
export function parseConfig(env, template = '') {
  const get = (name) => String(env[name] ?? '').trim();
  const problems = [];

  const id = (name, required) => {
    const value = get(name);
    if (!value) {
      if (required) problems.push(`${name} is empty.`);
      return '';
    }
    if (!SNOWFLAKE.test(value)) problems.push(`${name} should be a long number like 123456789012345678, but it's "${value}".`);
    return value;
  };

  const token = get('DISCORD_TOKEN');
  if (!token) problems.push('DISCORD_TOKEN is empty.');
  const staffGuildId = id('STAFF_GUILD_ID', true);
  const staffChannelId = id('STAFF_CHANNEL_ID', true);
  const qotdRoleId = id('QOTD_ROLE_ID', false);
  const managerRoleId = id('MANAGER_ROLE_ID', false);

  const timezone = get('TIMEZONE') || 'UTC';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    problems.push(`TIMEZONE "${timezone}" isn't a valid timezone name (example: America/Chicago).`);
  }

  const pingTime = get('PING_TIME') || '12:00';
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(pingTime);
  if (!match) problems.push(`PING_TIME "${pingTime}" must be 24-hour HH:MM (example: 08:00 or 17:30).`);

  if (problems.length) throw new Error(problems.join('\n'));

  const pingHour = Number(match[1]);
  const pingMinute = Number(match[2]);
  return {
    token,
    staffGuildId,
    staffChannelId,
    qotdRoleId,
    managerRoleId,
    timezone,
    pingHour,
    pingMinute,
    pingTime: `${String(pingHour).padStart(2, '0')}:${match[2]}`,
    template,
    api: get('DISCORD_API') || DEFAULT_API,
  };
}
