import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import chalk from 'chalk';
import { IndexerDB, ChunkRecord } from '../database/db.js';
import { chunkFile } from './chunker.js';
import { buildRepoMap } from './repomap.js';
import { FileWatcher } from './watcher.js';
import { DiffTracker } from './difftracker.js';
import { ShadowBackupManager } from '../database/backup.js';

const themeAccent = chalk.hex('#38BDF8');

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

const BINARY_EXTS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.pdf', '.zip', '.tar', '.gz',
  '.mp4', '.mp3', '.wav', '.mov', '.avi', '.exe', '.dll', '.so', '.dylib', '.node',
  '.woff', '.woff2', '.eot', '.ttf', '.otf', '.db', '.sqlite', '.sqlite3'
]);

function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export class DirectiveIndexer {
  public db: IndexerDB;
  private watcher: FileWatcher | null = null;
  private workspaceRoot: string;
  private diffTracker: DiffTracker;
  private backupManager: ShadowBackupManager;
  public currentRepoMap: string = '';

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.db = new IndexerDB(this.workspaceRoot);
    this.diffTracker = new DiffTracker();
    this.backupManager = new ShadowBackupManager(this.db);
  }

  /**
   * Run initial codebase scan, prune deleted files, generate initial repo map, and start background watcher.
   */
  public async initialize(options?: { silent?: boolean; onFileIndexed?: (relPath: string) => void }) {
    const silent = options?.silent ?? false;
    if (!silent) {
      console.log(`  ${themeAccent('index')} workspace: ${this.workspaceRoot}`);
    }
    
    const scannedFiles = new Set<string>();

    const walk = (currentDir: string) => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch (err) {
        console.error(`Failed to read directory ${currentDir}:`, err);
        return;
      }

      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        
        // Skip ignored directories/files or hidden files
        if (IGNORE_PATTERNS.includes(entry.name) || entry.name.startsWith('.')) {
          continue;
        }

        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          // Skip binary files and files > 5MB
          const ext = path.extname(entry.name).toLowerCase();
          if (BINARY_EXTS.has(ext)) {
            continue;
          }

          try {
            const stat = fs.statSync(fullPath);
            if (stat.size > 5 * 1024 * 1024) {
              continue; // Skip files > 5MB
            }

            scannedFiles.add(fullPath);
            this.processFileOnStartup(fullPath, stat, options);
          } catch (err) {
            console.error(`Failed to process file ${fullPath}:`, err);
          }
        }
      }
    };

    // Run the recursive walk
    if (fs.existsSync(this.workspaceRoot)) {
      walk(this.workspaceRoot);
    }

    // Prune deleted files that were in DB but are no longer on disk
    const allDbFiles = this.db.getAllFiles();
    for (const dbFile of allDbFiles) {
      if (!scannedFiles.has(dbFile.path)) {
        if (!silent) {
          console.log(`  ${themeAccent('index')} Pruning: ${dbFile.path}`);
        }
        this.db.removeFile(dbFile.path);
      }
    }

    // Build initial Repo Map
    this.currentRepoMap = buildRepoMap(this.db);

    // Start file watcher for real-time updates
    this.watcher = new FileWatcher(
      this.workspaceRoot,
      this.db,
      this.diffTracker,
      () => {
        // Callback runs when watcher updates a file
        this.currentRepoMap = buildRepoMap(this.db);
      }
    );
    this.watcher.start();
    if (!silent) {
      console.log(`  ${themeAccent('index')} Initial scan complete and background watcher started.`);
    }
  }

  public processFileOnStartup(filePath: string, stat: fs.Stats, options?: { silent?: boolean; onFileIndexed?: (relPath: string) => void }) {
    const relpath = path.relative(this.workspaceRoot, filePath);
    const silent = options?.silent ?? false;
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const hash = computeHash(content);
      const existing = this.db.getFile(filePath);

      // Notify the indexing callback even if we skip re-chunking (to show scanning progress)
      if (options?.onFileIndexed) {
        options.onFileIndexed(relpath);
      }

      // Skip re-chunking if hash is identical
      if (existing && existing.hash === hash) {
        return;
      }

      if (!silent) {
        console.log(`  ${themeAccent('index')} Indexing: ${relpath}`);
      }
      const chunks = chunkFile(filePath, relpath, content);
      
      this.db.upsertFile({
        path: filePath,
        hash,
        size: stat.size,
        modified: stat.mtimeMs
      });
      this.db.removeChunksForFile(filePath);
      this.db.insertChunks(chunks);
    } catch (err) {
      console.error(`Failed to index file ${filePath}:`, err);
    }
  }

  /**
   * Retrieve the current repository map (max 1500 tokens).
   */
  public getRepoMap(): string {
    return this.currentRepoMap;
  }

  /**
   * Retrieve the recent changes log (max 10 lines).
   */
  public getRecentChanges(): string {
    return this.diffTracker.formatRecentChanges();
  }

  /**
   * Create a shadow backup of a file before a write or patch.
   */
  public backupBeforeWrite(absolutePath: string) {
    this.backupManager.backupFile(absolutePath);
  }

  /**
   * Revert the latest change on a file via /undo.
   */
  public undoWrite(absolutePath: string): boolean {
    return this.backupManager.restoreBackup(absolutePath);
  }

  /**
   * Search chunks in the codebase using FTS5 keyword matching.
   */
  public search(query: string): (ChunkRecord & { rank: number })[] {
    return this.db.searchChunks(query);
  }

  /**
   * Update indexer database and shadow backups when a file is renamed.
   */
  public renameFile(absSource: string, absDest: string) {
    // 1. Move backup records
    this.backupManager.renameBackup(absSource, absDest);
    
    // 2. Delete old DB record & chunks
    this.db.removeFile(absSource);
    
    // 3. Index new file
    try {
      if (fs.existsSync(absDest)) {
        const stat = fs.statSync(absDest);
        const relpath = path.relative(this.workspaceRoot, absDest);
        const content = fs.readFileSync(absDest, 'utf-8');
        const hash = computeHash(content);
        const chunks = chunkFile(absDest, relpath, content);
        
        this.db.upsertFile({
          path: absDest,
          hash,
          size: stat.size,
          modified: stat.mtimeMs
        });
        this.db.removeChunksForFile(absDest);
        this.db.insertChunks(chunks);
      }
    } catch (e) {
      console.error(`Failed to re-index renamed file ${absDest}:`, e);
    }
    
    // 4. Update current repository map
    this.currentRepoMap = buildRepoMap(this.db);
  }

  /**
   * Clean up background watcher and close DB connection.
   */
  public close() {
    if (this.watcher) {
      this.watcher.stop();
    }
    this.db.close();
  }
}
