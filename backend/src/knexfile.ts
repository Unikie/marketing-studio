import type { Knex } from 'knex';
import path from 'path';

const DATABASE_URL = process.env.DATABASE_URL || '';

function getConfig(): Knex.Config {
  if (DATABASE_URL.startsWith('postgres')) {
    return {
      client: 'pg',
      connection: DATABASE_URL,
      migrations: {
        directory: path.join(__dirname, 'migrations'),
      },
    };
  }

  // Default: SQLite
  const dataDir = process.env.DATA_DIR || './data';
  return {
    client: 'better-sqlite3',
    connection: {
      filename: path.join(dataDir, 'paradice.db'),
    },
    useNullAsDefault: true,
    migrations: {
      directory: path.join(__dirname, 'migrations'),
    },
  };
}

export default getConfig();
