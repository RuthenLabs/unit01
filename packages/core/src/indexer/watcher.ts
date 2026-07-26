import chokidar from 'chokidar';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { IndexerDB } from '../database/db.js';
import { chunkFile } from './chunker.js';
import { DiffTracker } from './difftracker.js';

const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  'target',
  '__pycache__',
  '.next',
  '.svelte-kit',
  '.unit01'
];

function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export class FileWatcher {
  private watcher: chokidar.FSWatcher | null = null;
  private db: IndexerDB;
  private workspaceRoot: string;
  private diffTracker: DiffTracker;
  private onUpdate: () => void;
  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private pendingEvents = new Map<string, 'add' | 'change' | 'unlink'>();

  constructor(
    workspaceRoot: string,
    db: IndexerDB,
    diffTracker: DiffTracker,
    onUpdate: () => void
  ) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.db = db;
    this.diffTracker = diffTracker;
    this.onUpdate = onUpdate;
  }

  public start() {
    this.watcher = chokidar.watch(this.workspaceRoot, {
      ignored: (filePath: string) => {
        const rel = path.relative(this.workspaceRoot, filePath);
        if (!rel) return false; // root itself
        const parts = rel.split(path.sep);
        return parts.some(part => part.startsWith('.') || IGNORE_PATTERNS.includes(part));
      },
      persistent: true,
      ignoreInitial: true // Initial scan is handled manually during index startup
    });

    this.watcher
      .on('add', (filePath) => this.enqueue(filePath, 'add'))
      .on('change', (filePath) => this.enqueue(filePath, 'change'))
      .on('unlink', (filePath) => this.enqueue(filePath, 'unlink'));
  }

  public stop() {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();
    this.pendingEvents.clear();
  }

  public flush() {
    for (const [filePath, timer] of this.debounceTimers.entries()) {
      clearTimeout(timer);
      const eventType = this.pendingEvents.get(filePath) || (fs.existsSync(filePath) ? 'change' : 'unlink');
      this.handleFileEvent(filePath, eventType);
    }
    this.debounceTimers.clear();
    this.pendingEvents.clear();
  }

  private enqueue(filePath: string, eventType: 'add' | 'change' | 'unlink') {
    const existingTimer = this.debounceTimers.get(filePath);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    this.pendingEvents.set(filePath, eventType);

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath);
      this.pendingEvents.delete(filePath);
      this.handleFileEvent(filePath, eventType);
    }, 500); // 500ms debounce

    this.debounceTimers.set(filePath, timer);
  }

  private handleFileEvent(filePath: string, eventType: 'add' | 'change' | 'unlink') {
    const relpath = path.relative(this.workspaceRoot, filePath);

    if (eventType === 'unlink') {
      const oldChunks = this.db.getChunksForFile(filePath);
      this.db.removeFile(filePath);
      this.diffTracker.trackChange(relpath, oldChunks, []);
      this.onUpdate();
      return;
    }

    // Read file and process
    try {
      if (!fs.existsSync(filePath)) return;
      const stat = fs.statSync(filePath);
      if (stat.isDirectory()) return;

      const content = fs.readFileSync(filePath, 'utf-8');
      const hash = computeHash(content);
      const existingFile = this.db.getFile(filePath);

      // Skip if the file hasn't actually changed
      if (existingFile && existingFile.hash === hash) {
        return;
      }

      const oldChunks = this.db.getChunksForFile(filePath);
      
      // Perform chunking
      const newChunks = chunkFile(filePath, relpath, content);
      
      // Update database
      this.db.upsertFile({
        path: filePath,
        hash,
        size: stat.size,
        modified: stat.mtimeMs
      });
      
      this.db.removeChunksForFile(filePath);
      this.db.insertChunks(newChunks);

      // Track the changes
      this.diffTracker.trackChange(relpath, oldChunks, newChunks);
      this.onUpdate();
    } catch (err) {
      console.error(`Error processing watched file ${filePath}:`, err);
    }
  }
}
