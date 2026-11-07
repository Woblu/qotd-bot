import { defaultState } from './core.js';

const SELECT = 'SELECT data, version FROM state WHERE id = 1';
const SETUP = [
  'CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, data TEXT NOT NULL, version INTEGER NOT NULL)',
  "INSERT OR IGNORE INTO state (id, data, version) VALUES (1, '{}', 0)",
];

/** Loads the saved state from the D1 database (creating the table the first time). */
export async function readState(db) {
  let row = await db
    .prepare(SELECT)
    .first()
    .catch((err) => {
      if (!/no such table/i.test(String(err?.message))) throw err;
      return null;
    });
  if (!row) {
    await db.batch(SETUP.map((sql) => db.prepare(sql)));
    row = await db.prepare(SELECT).first();
  }
  return { state: { ...defaultState(), ...JSON.parse(row.data) }, version: row.version };
}

/** Saves only if nobody else saved since `version` was read. Returns false on a clash. */
export async function writeState(db, state, version) {
  const result = await db
    .prepare('UPDATE state SET data = ?, version = version + 1 WHERE id = 1 AND version = ?')
    .bind(JSON.stringify(state), version)
    .run();
  return result.meta.changes === 1;
}
