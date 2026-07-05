import * as crypto from 'crypto';
import { IndexerDB } from '../../core/database/db.js';
import { initializeMemorySchema } from './schema.js';
import { isPro, FREE_LIMITS } from '../../core/tier.js';

export interface ProjectDecision {
  id: string;
  timestamp: number;
  category: 'database' | 'auth' | 'styles' | 'conventions' | 'other';
  summary: string;
  rationale: string;
  context_files: string[]; // JSON stored string list
  active_session_id?: string;
}

export interface UserConvention {
  key: string;
  pattern: string;
  created_at: number;
  last_triggered: number;
}

export class ProjectMemoryStore {
  private db: IndexerDB;

  constructor(db: IndexerDB) {
    this.db = db;
    initializeMemorySchema(this.db.db);
  }

  /**
   * Log a new architectural decision to the persistent memory store.
   */
  public logDecision(decision: Omit<ProjectDecision, 'id' | 'timestamp'>): string {
    const id = crypto.randomUUID();
    const timestamp = Date.now();
    const contextFilesStr = JSON.stringify(decision.context_files);

    this.db.db.prepare(`
      INSERT INTO project_decisions (id, timestamp, category, summary, rationale, context_files, active_session_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      timestamp,
      decision.category,
      decision.summary,
      decision.rationale,
      contextFilesStr,
      decision.active_session_id || null
    );

    return id;
  }

  /**
   * Save or update a coding guideline/pattern convention.
   */
  public upsertConvention(key: string, pattern: string): void {
    const now = Date.now();
    this.db.db.prepare(`
      INSERT INTO user_conventions (key, pattern, created_at, last_triggered)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET
        pattern = excluded.pattern,
        last_triggered = excluded.last_triggered
    `).run(key, pattern, now, now);
  }

  /**
   * Fetch all stored decisions.
   */
  public getAllDecisions(): ProjectDecision[] {
    const rows = this.db.db.prepare('SELECT * FROM project_decisions ORDER BY timestamp DESC').all() as any[];
    return rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      category: r.category,
      summary: r.summary,
      rationale: r.rationale,
      context_files: JSON.parse(r.context_files || '[]'),
      active_session_id: r.active_session_id
    }));
  }

  /**
   * Fetch all active coding conventions.
   */
  public getAllConventions(): UserConvention[] {
    return this.db.db.prepare('SELECT * FROM user_conventions ORDER BY last_triggered DESC').all() as UserConvention[];
  }

  /**
   * Auto-scan an assistant response for decision/convention signals and persist them.
   * Uses lightweight heuristics — no LLM call required.
   * Called automatically after every final model response.
   */
  public autoCapture(responseText: string, sessionId?: string): void {
    if (!responseText || responseText.length < 20) return;

    // ── Convention signals ───────────────────────────────────────────────────
    const conventionPatterns = [
      // "always use X", "we always use X"
      /(?:we |I |let's )?always use ([^.!?\n]{5,80})/gi,
      // "convention: X"
      /convention[:\s]+([^.!?\n]{5,80})/gi,
      // "going forward, use X" / "from now on, use X"
      /(?:going forward|from now on)[,\s]+(?:use |we(?:'ll| will) use )?([^.!?\n]{5,80})/gi,
      // "the rule is X" / "the pattern is X"
      /the (?:rule|pattern|standard|style) (?:is|will be)[:\s]+([^.!?\n]{5,80})/gi,
    ];

    for (const pattern of conventionPatterns) {
      let match;
      while ((match = pattern.exec(responseText)) !== null) {
        const raw = match[1]?.trim();
        if (!raw || raw.length < 5) continue;
        // Derive a short key from first 3 significant words
        const key = raw.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).slice(0, 3).join('_');
        if (key.length < 3) continue;
        try {
          this.upsertConvention(key, raw);
        } catch (_) {}
      }
    }

    // ── Decision signals ─────────────────────────────────────────────────────
    const decisionPatterns: Array<{ re: RegExp; category: ProjectDecision['category'] }> = [
      // DB/schema decisions
      { re: /(?:we(?:'ve| have)?|I'(?:ve|ll)) decided? to use ([^.!?\n]{5,120}) (?:for|as) (?:the |our )?(?:database|db|schema|ORM|storage)/gi, category: 'database' },
      // Auth decisions
      { re: /(?:we(?:'ve| have)?|I'(?:ve|ll)) (?:decided? to use|going with|using) ([^.!?\n]{5,120}) (?:for|as) (?:the |our )?auth/gi, category: 'auth' },
      // Style/UI decisions
      { re: /(?:we(?:'ve| have)?|I'(?:ve|ll)) (?:decided? to use|going with|using) ([^.!?\n]{5,120}) (?:for|as) (?:the |our )?(?:styling|CSS|UI|design)/gi, category: 'styles' },
      // Generic "we decided" catch-all
      { re: /we(?:'ve| have) decided(?: that| to)? ([^.!?\n]{10,200})/gi, category: 'other' },
      // "I'll use X because Y"
      { re: /I(?:'ll| will) use ([^.!?\n]{5,100}) because ([^.!?\n]{5,150})/gi, category: 'conventions' },
    ];

    for (const { re, category } of decisionPatterns) {
      let match;
      while ((match = re.exec(responseText)) !== null) {
        const summary = (match[1] || match[0])?.trim();
        const rationale = match[2]?.trim() || 'Auto-captured from assistant response.';
        if (!summary || summary.length < 8) continue;
        // Deduplicate: skip if a very similar summary already exists
        const existing = this.getAllDecisions();
        const isDuplicate = existing.some(d =>
          d.summary.toLowerCase().slice(0, 40) === summary.toLowerCase().slice(0, 40)
        );
        if (isDuplicate) continue;
        try {
          this.logDecision({
            category,
            summary: summary.slice(0, 200),
            rationale: rationale.slice(0, 300),
            context_files: [],
            active_session_id: sessionId
          });
        } catch (_) {}
      }
    }
  }

  /**
   * Format long-term decisions and style conventions into a system instruction context.
   */
  public generateMemoryContextBlock(): string {
    const decisions = this.getAllDecisions();
    const conventions = this.getAllConventions();

    if (decisions.length === 0 && conventions.length === 0) return '';

    const pro = isPro();
    const maxDecisions = pro ? 10 : FREE_LIMITS.MEMORY_DECISIONS;
    const maxConventions = pro ? 999 : FREE_LIMITS.MEMORY_CONVENTIONS;

    let xml = '\n<project_memory>\n';
    let limited = false;

    if (conventions.length > 0) {
      xml += '  <style_conventions>\n';
      conventions.slice(0, maxConventions).forEach(conv => {
        xml += `    - [${conv.key}]: "${conv.pattern}"\n`;
      });
      xml += '  </style_conventions>\n';
      if (conventions.length > maxConventions) limited = true;
    }

    if (decisions.length > 0) {
      xml += '  <past_architectural_decisions>\n';
      decisions.slice(0, maxDecisions).forEach(dec => {
        xml += `    - [${dec.category}] ${dec.summary} (Rationale: ${dec.rationale})\n`;
      });
      xml += '  </past_architectural_decisions>\n';
      if (decisions.length > maxDecisions) limited = true;
    }

    if (!pro && limited) {
      xml += `  <!-- Note: Free tier memory limits active. Upgrade to Pro to restore all memory decisions and style conventions. -->\n`;
    }

    xml += '</project_memory>\n';
    return xml;
  }
}
