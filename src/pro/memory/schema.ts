/**
 * Initialize Project Memory tables in the main SQLite database.
 */
export function initializeMemorySchema(sqliteDb: any): void {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS project_decisions (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      category TEXT NOT NULL,
      summary TEXT NOT NULL,
      rationale TEXT NOT NULL,
      context_files TEXT,
      active_session_id TEXT
    );

    CREATE TABLE IF NOT EXISTS user_conventions (
      key TEXT PRIMARY KEY,
      pattern TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      last_triggered INTEGER NOT NULL
    );
  `);
}
