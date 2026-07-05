import * as path from 'path';
import * as fs from 'fs';
import { IndexerDB, ChunkRecord } from '../database/db.js';

// Rough token estimation: 4 characters per token
const MAX_CHAR_LIMIT = 1500 * 4;

const IGNORE_DIRS = ['node_modules', '.git', 'dist', 'target', '__pycache__', '.next', '.svelte-kit', '.unit01'];

function getSubdirectories(workspaceRoot: string): string[] {
  const dirs: string[] = [];
  
  function walk(current: string, depth: number) {
    if (depth > 3) return;
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || IGNORE_DIRS.includes(entry.name)) {
        continue;
      }
      if (entry.isDirectory()) {
        const fullPath = path.join(current, entry.name);
        const rel = path.relative(workspaceRoot, fullPath);
        dirs.push(rel + '/');
        walk(fullPath, depth + 1);
      }
    }
  }
  walk(workspaceRoot, 1);
  return dirs;
}

function getSpecialTypeSuffix(filepath: string): string | null {
  const ext = path.extname(filepath).toLowerCase();
  const base = path.basename(filepath).toLowerCase();

  if (ext === '.css' || ext === '.scss' || ext === '.sass') {
    return '[stylesheet]';
  }
  if (ext === '.json' || ext === '.toml' || ext === '.yaml' || ext === '.yml' || base === 'package.json') {
    return '[config]';
  }
  if (ext === '.md' || ext === '.txt') {
    return '[docs]';
  }
  if (base.startsWith('.env')) {
    return '[env]';
  }
  return null;
}

function cleanSignature(content: string, name: string, type: 'function' | 'class'): string {
  const firstLine = content.split('\n')[0].trim();
  // Strip trailing opening braces, equals signs, or arrow syntax
  let sig = firstLine.replace(/[\{\=\s]+$/, '').replace(/\s*\=\s*$/, '').trim();
  
  if (type === 'class') {
    // If it doesn't already contain class word, format nicely
    if (!sig.includes('class ')) {
      return `class ${name}`;
    }
  }
  return sig;
}

export function buildRepoMap(db: IndexerDB): string {
  // 1. Get all directories
  const directories = getSubdirectories(db.workspaceRoot);
  
  // 2. Get all files sorted by modified timestamp DESC
  const files = db.getAllFiles().sort((a, b) => b.modified - a.modified);
  
  let mapLines: string[] = [];
  
  if (directories.length > 0) {
    mapLines.push('[Directories]');
    mapLines.push(...directories);
    mapLines.push('');
  }
  
  if (files.length > 0) {
    mapLines.push('[Files]');
  }
  
  let currentLength = mapLines.join('\n').length;
  let omittedCount = 0;

  for (const file of files) {
    const relpath = path.relative(db.workspaceRoot, file.path); // Already relative or direct key
    const specialSuffix = getSpecialTypeSuffix(relpath);

    let fileEntry = '';
    if (specialSuffix) {
      fileEntry = `${relpath} → ${specialSuffix}`;
    } else {
      // Fetch symbols
      const chunks = db.getChunksForFile(file.path);
      // Group by AST function / class
      const symbols = chunks.filter(c => c.chunk_type === 'function' || c.chunk_type === 'class') as (ChunkRecord & { chunk_type: 'function' | 'class' })[];
      
      if (symbols.length === 0) {
        fileEntry = `${relpath}`;
      } else {
        const sigs = symbols.map(s => {
          const sig = cleanSignature(s.content, s.name, s.chunk_type);
          return `  → ${sig}`;
        });
        fileEntry = `${relpath}\n${sigs.join('\n')}`;
      }
    }

    // Add entry if it doesn't overflow character limit
    const addedLength = fileEntry.length + 2; // + newline
    if (currentLength + addedLength <= MAX_CHAR_LIMIT) {
      mapLines.push(fileEntry);
      currentLength += addedLength;
    } else {
      omittedCount++;
    }
  }

  if (omittedCount > 0) {
    mapLines.push(`\n... [${omittedCount} more files omitted to fit within token limit]`);
  }

  return mapLines.join('\n');
}
