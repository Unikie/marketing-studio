import type { Knex } from 'knex';

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('files', (t) => {
    t.text('sha256');
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('files', (t) => {
    t.dropColumn('sha256');
  });
}