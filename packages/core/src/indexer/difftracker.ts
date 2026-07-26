import { ChunkRecord } from '../database/db.js';

export interface DiffLogEntry {
  filepath: string;
  action: 'created' | 'modified' | 'deleted';
  detail?: string;
  timestamp: number;
}

export class DiffTracker {
  private logEntries: DiffLogEntry[] = [];

  constructor() {}

  /**
   * Compare old chunks of a file to new chunks, and track the differences.
   */
  public trackChange(
    relpath: string,
    oldChunks: ChunkRecord[],
    newChunks: ChunkRecord[]
  ) {
    const timestamp = Date.now();

    if (oldChunks.length === 0 && newChunks.length > 0) {
      this.logEntries.push({
        filepath: relpath,
        action: 'created',
        timestamp
      });
      this.trimLog();
      return;
    }

    if (oldChunks.length > 0 && newChunks.length === 0) {
      this.logEntries.push({
        filepath: relpath,
        action: 'deleted',
        timestamp
      });
      this.trimLog();
      return;
    }

    // Map old and new chunks by ID for functions/classes
    const oldSymbols = oldChunks.filter(c => c.chunk_type === 'function' || c.chunk_type === 'class');
    const newSymbols = newChunks.filter(c => c.chunk_type === 'function' || c.chunk_type === 'class');

    const oldMap = new Map<string, ChunkRecord>();
    for (const c of oldSymbols) {
      // Create a key based on chunk_type + name (since lines might shift)
      oldMap.set(`${c.chunk_type}:${c.name}`, c);
    }

    const added: string[] = [];
    const modified: string[] = [];

    for (const c of newSymbols) {
      const key = `${c.chunk_type}:${c.name}`;
      const oldChunk = oldMap.get(key);

      if (!oldChunk) {
        added.push(`added ${c.name} ${c.chunk_type} (line ${c.start_line})`);
      } else {
        if (oldChunk.content !== c.content) {
          modified.push(`modified ${c.name} ${c.chunk_type} (line ${c.start_line})`);
        }
        oldMap.delete(key);
      }
    }

    const deleted = Array.from(oldMap.values()).map(c => `removed ${c.name} ${c.chunk_type}`);

    // If specific symbol updates were found, log them
    if (added.length > 0 || modified.length > 0 || deleted.length > 0) {
      const details = [...added, ...modified, ...deleted];
      for (const d of details) {
        this.logEntries.push({
          filepath: relpath,
          action: 'modified',
          detail: d,
          timestamp
        });
      }
    } else {
      // Generic file modification if no individual functions/classes changed
      this.logEntries.push({
        filepath: relpath,
        action: 'modified',
        timestamp
      });
    }

    this.trimLog();
  }

  private trimLog() {
    // Keep only the 10 most recent log entries
    if (this.logEntries.length > 10) {
      this.logEntries = this.logEntries.slice(-10);
    }
  }

  /**
   * Formats the diff log into a max 10-line block for context injection.
   */
  public formatRecentChanges(): string {
    if (this.logEntries.length === 0) {
      return '';
    }

    const lines = this.logEntries.map(entry => {
      if (entry.action === 'created') {
        return `- created: ${entry.filepath}`;
      } else if (entry.action === 'deleted') {
        return `- deleted: ${entry.filepath}`;
      } else {
        if (entry.detail) {
          return `- modified: ${entry.filepath} (${entry.detail})`;
        } else {
          return `- modified: ${entry.filepath}`;
        }
      }
    });

    // Ensure we take only the latest 10 lines
    const finalLines = lines.slice(-10);
    return `[Recent Changes]\n${finalLines.join('\n')}`;
  }

  public clear() {
    this.logEntries = [];
  }
}
