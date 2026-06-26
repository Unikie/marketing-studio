import knexLib from 'knex';
import knexConfig from './knexfile';

let db: knexLib.Knex;

export async function initDb(): Promise<knexLib.Knex> {
  db = knexLib(knexConfig);
  await db.migrate.latest();
  return db;
}

export function getDb(): knexLib.Knex {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}
