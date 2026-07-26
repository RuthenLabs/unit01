/**
 * Initialize Local Audit Log tables in the main SQLite database.
 */
export function initializeAuditSchema(sqliteDb: any): void {
  sqliteDb.exec(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      service TEXT NOT NULL,
      operation TEXT NOT NULL,
      target TEXT NOT NULL,
      payload_summary TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      duration_ms INTEGER
    );
  `);
}
