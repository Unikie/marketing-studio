import Database from 'better-sqlite3';
import path from 'path';

export function initDb(dataDir: string): Database.Database {
  const dbPath = path.join(dataDir, 'paradice.db');
  const db = new Database(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS files (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      name TEXT NOT NULL,
      analysis TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_instructions (
      id TEXT PRIMARY KEY,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL DEFAULT '',
      tool_name TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS prompts (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      pipeline_id TEXT,
      type TEXT NOT NULL DEFAULT 'llm',
      prompt TEXT NOT NULL DEFAULT '',
      response TEXT NOT NULL DEFAULT '',
      messages TEXT,
      skill_id TEXT,
      system_instruction_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (pipeline_id) REFERENCES prompts(id),
      FOREIGN KEY (skill_id) REFERENCES skills(id),
      FOREIGN KEY (system_instruction_id) REFERENCES system_instructions(id)
    );

    CREATE TABLE IF NOT EXISTS prompt_context (
      prompt_id TEXT NOT NULL,
      ref_type TEXT NOT NULL,
      ref_id TEXT NOT NULL,
      FOREIGN KEY (prompt_id) REFERENCES prompts(id) ON DELETE CASCADE
    );

    INSERT OR IGNORE INTO system_instructions (id, text)
      VALUES ('default', 'You are a deterministic processing tool. You are NOT a conversational assistant or chatbot.

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
- Do not attempt partial or speculative output.');
  `);

  // Migration: add tool_name to skills if missing
  try {
    db.prepare('SELECT tool_name FROM skills LIMIT 1').get();
  } catch {
    db.exec('ALTER TABLE skills ADD COLUMN tool_name TEXT');
  }

  return db;
}
