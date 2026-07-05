import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { homedir } from 'os';
import {
  parseWriteFile,
  parsePatchFile,
  parsePatchFileBlocks,
  parseReadFile,
  parseMoveFile
} from '../../cli/parser.js';

export interface SessionData {
  id: string;
  workspaceRoot: string;
  startedAt: number;
  lastUpdatedAt: number;
  activeModel: string;
  firstMessage: string;
  messageCount: number;
  conversationHistory: { role: string; content: string }[];
}

export class SessionStore {
  private workspaceRoot: string;
  private baseDir: string;
  private workspaceHash: string;
  private sessionsDir: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.workspaceHash = crypto.createHash('sha256').update(this.workspaceRoot).digest('hex');
    const home = homedir();
    if (process.platform === 'darwin') {
      this.baseDir = path.join(home, 'Library', 'Application Support', 'com.nayalabs.unit01');
    } else {
      this.baseDir = path.join(home, '.local', 'share', 'com.nayalabs.unit01');
    }
    this.sessionsDir = path.join(this.baseDir, this.workspaceHash, 'sessions');
    if (!fs.existsSync(this.sessionsDir)) {
      fs.mkdirSync(this.sessionsDir, { recursive: true });
    }
  }

  /**
   * Save or overwrite a session file.
   */
  public save(
    sessionId: string,
    data: { startedAt: number; activeModel: string; conversationHistory: { role: string; content: string }[] }
  ): void {
    const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
    
    // Find the first user message that is not a tool output
    const firstUserMsg = data.conversationHistory.find(
      m => m.role === 'user' && !m.content.includes('<tool_output>')
    );
    let firstMessage = firstUserMsg ? firstUserMsg.content : '';

    // If firstMessage is empty, try to preserve the existing firstMessage from the stored file
    if (!firstMessage) {
      try {
        if (fs.existsSync(sessionFile)) {
          const content = fs.readFileSync(sessionFile, 'utf8');
          const oldData = JSON.parse(content) as SessionData;
          if (oldData && oldData.firstMessage) {
            firstMessage = oldData.firstMessage;
          }
        }
      } catch (err) {
        // Ignore errors reading existing file
      }
    }

    const fullData: SessionData = {
      id: sessionId,
      workspaceRoot: this.workspaceRoot,
      startedAt: data.startedAt,
      lastUpdatedAt: Date.now(),
      activeModel: data.activeModel,
      firstMessage,
      messageCount: data.conversationHistory.length,
      conversationHistory: data.conversationHistory
    };

    fs.writeFileSync(sessionFile, JSON.stringify(fullData, null, 2), 'utf8');
  }

  /**
   * List all sessions for the current workspace, sorted by lastUpdatedAt descending.
   */
  public list(workspaceRoot: string): SessionData[] {
    const resolvedRoot = path.resolve(workspaceRoot);
    const hash = crypto.createHash('sha256').update(resolvedRoot).digest('hex');
    const home = homedir();
    
    let baseDir: string;
    if (process.platform === 'darwin') {
      baseDir = path.join(home, 'Library', 'Application Support', 'com.nayalabs.unit01');
    } else {
      baseDir = path.join(home, '.local', 'share', 'com.nayalabs.unit01');
    }
    
    const targetDir = path.join(baseDir, hash, 'sessions');
    if (!fs.existsSync(targetDir)) {
      return [];
    }

    const files = fs.readdirSync(targetDir);
    const sessions: SessionData[] = [];
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      const filePath = path.join(targetDir, file);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(content) as SessionData;
        sessions.push(data);
      } catch (err) {
        // Ignore malformed files
      }
    }

    return sessions.sort((a, b) => b.lastUpdatedAt - a.lastUpdatedAt);
  }

  /**
   * Returns full session data for a given ID.
   */
  public load(sessionId: string): SessionData | null {
    const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
    if (!fs.existsSync(sessionFile)) {
      return null;
    }
    try {
      const content = fs.readFileSync(sessionFile, 'utf8');
      return JSON.parse(content) as SessionData;
    } catch (err) {
      return null;
    }
  }

  /**
   * Removes a session file.
   */
  public delete(sessionId: string): void {
    const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
    }
  }

  /**
   * Renames a session.
   */
  public rename(sessionId: string, newTitle: string): void {
    const sessionFile = path.join(this.sessionsDir, `${sessionId}.json`);
    if (fs.existsSync(sessionFile)) {
      try {
        const content = fs.readFileSync(sessionFile, 'utf8');
        const data = JSON.parse(content) as SessionData;
        data.firstMessage = newTitle;
        fs.writeFileSync(sessionFile, JSON.stringify(data, null, 2), 'utf8');
      } catch (err) {
        // Ignore errors
      }
    }
  }
}

export function runStalenessCheck(
  history: { role: string; content: string }[],
  workspaceRoot: string,
  onStaleWarning: (message: string) => void
): void {
  const referencedFiles = new Set<string>();
  for (const msg of history) {
    if (msg.role !== 'assistant') continue;
    
    const writeResult = parseWriteFile(msg.content);
    if (writeResult) referencedFiles.add(writeResult.filePath);

    const patchResult = parsePatchFile(msg.content);
    if (patchResult) referencedFiles.add(patchResult.filePath);

    const patchBlocksResult = parsePatchFileBlocks(msg.content);
    if (patchBlocksResult) referencedFiles.add(patchBlocksResult.filePath);

    const readPath = parseReadFile(msg.content);
    if (readPath) referencedFiles.add(readPath);

    const moveResult = parseMoveFile(msg.content);
    if (moveResult) {
      referencedFiles.add(moveResult.sourcePath);
      referencedFiles.add(moveResult.destinationPath);
    }
  }

  let missingCount = 0;
  for (const relPath of referencedFiles) {
    const absPath = path.resolve(workspaceRoot, relPath);
    if (!fs.existsSync(absPath)) {
      missingCount++;
    }
  }

  if (missingCount >= 3) {
    onStaleWarning('This session references files that no longer exist in the workspace. The workspace may have changed significantly since this session.');
  }
}
