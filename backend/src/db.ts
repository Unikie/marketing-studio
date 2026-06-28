import knexLib from 'knex';
import knexConfig from './knexfile';

let db: knexLib.Knex;

export async function initDb(): Promise<knexLib.Knex> {
  db = knexLib(knexConfig);
  await db.migrate.latest();
  return db;
}

export async function resetDb(): Promise<void> {
  const client = db.client.config.client;

  if (client === 'pg') {
    await db.raw('DROP SCHEMA IF EXISTS public CASCADE');
    await db.raw('CREATE SCHEMA public');
    await db.raw('GRANT ALL ON SCHEMA public TO CURRENT_USER');
  } else {
    await db.migrate.rollback(undefined, true);
  }

  await db.migrate.latest();
}

export function getDb(): knexLib.Knex {
  if (!db) throw new Error('Database not initialized. Call initDb() first.');
  return db;
}
