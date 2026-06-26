import type { Knex } from 'knex';

const DEFAULT_INSTRUCTION = `You are a deterministic processing tool. You are NOT a conversational assistant or chatbot.

BEHAVIOR RULES:
- Execute instructions precisely. Do not add pleasantries, greetings, or filler.
- If an instruction is unclear or impossible, state exactly what is unclear. Do not guess or improvise.
- Never apologize. Never use phrases like "Sure!", "Great question!", "I''d be happy to help".
- Respond only with the requested output. No preamble, no summary unless explicitly asked.

PURPOSE:
- Analyze file content provided in context (from file analysis results).
- Follow user instructions from skill prompts or the overall prompt.
- Produce structured output that may serve as input to subsequent tool calls.

CONTEXT FORMAT:
- File analyses appear in context as prior results. Use them as source data.
- Skill references in prompts appear as /skill_name. These are metadata references to registered skill definitions — do NOT interpret them as literal text or commands. The skill''s system prompt has already been injected into your instructions.
- Your output may be consumed by another processing step. Maintain machine-parseable structure when instructed.

IF YOU CANNOT COMPLY:
- State: "Cannot process: [specific reason]"
- Do not attempt partial or speculative output.`;

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('projects', (t) => {
    t.text('id').primary();
    t.text('name').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('files', (t) => {
    t.text('id').primary();
    t.text('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.text('filename').notNullable();
    t.text('name').notNullable();
    t.text('analysis');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('system_instructions', (t) => {
    t.text('id').primary();
    t.text('text').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('skills', (t) => {
    t.text('id').primary();
    t.text('name').notNullable();
    t.text('description').notNullable().defaultTo('');
    t.text('system_prompt').notNullable().defaultTo('');
    t.text('tool_name');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('prompts', (t) => {
    t.text('id').primary();
    t.text('project_id').notNullable().references('id').inTable('projects').onDelete('CASCADE');
    t.text('pipeline_id').references('id').inTable('prompts');
    t.text('type').notNullable().defaultTo('llm');
    t.text('prompt').notNullable().defaultTo('');
    t.text('response').notNullable().defaultTo('');
    t.text('messages');
    t.text('skill_id').references('id').inTable('skills');
    t.text('system_instruction_id').references('id').inTable('system_instructions');
    t.text('status').notNullable().defaultTo('pending');
    t.text('error');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('prompt_context', (t) => {
    t.text('prompt_id').notNullable().references('id').inTable('prompts').onDelete('CASCADE');
    t.text('ref_type').notNullable();
    t.text('ref_id').notNullable();
  });

  // Seed default instruction
  const existing = await knex('system_instructions').where('id', 'default').first();
  if (!existing) {
    await knex('system_instructions').insert({
      id: 'default',
      text: DEFAULT_INSTRUCTION,
    });
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('prompt_context');
  await knex.schema.dropTableIfExists('prompts');
  await knex.schema.dropTableIfExists('skills');
  await knex.schema.dropTableIfExists('system_instructions');
  await knex.schema.dropTableIfExists('files');
  await knex.schema.dropTableIfExists('projects');
}
