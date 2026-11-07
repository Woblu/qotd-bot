export const DEFAULT_API = 'https://discord.com/api/v10';
const USER_AGENT = 'DiscordBot (https://discord.com/developers/docs, 1.0) QOTD-Bot';

export class DiscordError extends Error {
  constructor(status, body, path) {
    let detail = body;
    let code;
    try {
      const parsed = JSON.parse(body);
      code = parsed.code;
      detail = parsed.message ?? body;
      if (parsed.errors) detail += ` ${JSON.stringify(parsed.errors)}`;
    } catch {}
    super(`Discord API error ${status} on ${path}: ${detail}`);
    this.status = status;
    this.code = code;
  }
}

export async function discordRequest(api, path, { token, method = 'GET', body } = {}) {
  const headers = { 'User-Agent': USER_AGENT };
  if (token) headers.Authorization = `Bot ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(api + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  if (!res.ok) throw new DiscordError(res.status, text, path);
  return text ? JSON.parse(text) : null;
}

/** Posts a ping in the staff channel. Only the pinged user gets notified. */
export async function sendPing(config, { userId, content }) {
  try {
    return await discordRequest(config.api, `/channels/${config.staffChannelId}/messages`, {
      token: config.token,
      method: 'POST',
      body: { content, allowed_mentions: { users: [userId] } },
    });
  } catch (err) {
    if ([10003, 50001, 50013].includes(err.code)) {
      throw new Error(
        `The bot can't post in the staff channel (${config.staffChannelId}). Check STAFF_CHANNEL_ID and give the bot View Channel + Send Messages there.`,
      );
    }
    throw err;
  }
}

/** Fills in the "thinking..." reply to a slash command. */
export function editOriginalResponse(api, interaction, content) {
  return discordRequest(api, `/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`, {
    method: 'PATCH',
    body: { content, allowed_mentions: { parse: [] } },
  });
}

function hexToBytes(hex) {
  if (!hex || hex.length % 2 || /[^0-9a-f]/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/** Checks that a request really came from Discord (required for interaction endpoints). */
export async function verifySignature(publicKeyHex, signatureHex, timestamp, body) {
  const key = hexToBytes(publicKeyHex);
  const signature = hexToBytes(signatureHex);
  if (!key || !signature || !timestamp) return false;
  try {
    const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify({ name: 'Ed25519' }, cryptoKey, signature, new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}
