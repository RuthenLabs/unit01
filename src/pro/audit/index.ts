import * as crypto from 'crypto';
import { IndexerDB } from '../../core/database/db.js';
import { initializeAuditSchema } from './schema.js';

export interface AuditRecord {
  id: string;
  timestamp: number;
  service: string; // 'slack', 'github', 'discord', 'telegram', 'notion', 'shell', 'file_write'
  operation: string; // e.g. 'post_message', 'create_issue', 'execute_script'
  target: string; // e.g. URL, file path, channel name
  payload_summary: string;
  payload_hash: string;
  status: 'approved' | 'denied' | 'failed' | 'completed';
  duration_ms?: number;
}

export class AuditLogStore {
  private db: IndexerDB;

  constructor(db: IndexerDB) {
    this.db = db;
    initializeAuditSchema(this.db.db);
  }

  /**
   * Log an audited operation execution.
   */
  public logAction(record: Omit<AuditRecord, 'id' | 'timestamp'>): string {
    const id = crypto.randomUUID();
    const timestamp = Date.now();

    this.db.db.prepare(`
      INSERT INTO audit_logs (id, timestamp, service, operation, target, payload_summary, payload_hash, status, duration_ms)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      timestamp,
      record.service,
      record.operation,
      record.target,
      record.payload_summary,
      record.payload_hash,
      record.status,
      record.duration_ms || null
    );

    return id;
  }

  /**
   * Fetch the last N audit log entries.
   */
  public getRecentLogs(limit = 15): AuditRecord[] {
    return this.db.db.prepare('SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?').all(limit) as AuditRecord[];
  }

  /**
   * Load details of a specific audit log by ID.
   */
  public getLogDetails(id: string): AuditRecord | null {
    const row = this.db.db.prepare('SELECT * FROM audit_logs WHERE id = ?').get(id) as AuditRecord | undefined;
    return row || null;
  }

  /**
   * Update status of an audit log entry.
   */
  public updateStatus(id: string, status: AuditRecord['status']): void {
    this.db.db.prepare('UPDATE audit_logs SET status = ? WHERE id = ?').run(status, id);
  }
}
