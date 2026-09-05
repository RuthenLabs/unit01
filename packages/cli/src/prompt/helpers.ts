import * as path from 'path';
import * as fs from 'fs';
import { execSync, exec } from 'child_process';

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function getGitBranch(workspaceRoot: string): string {
  try {
    return execSync('git branch --show-current', { cwd: workspaceRoot, stdio: 'pipe' })
      .toString()
      .trim();
  } catch {
    return 'main';
  }
}

export function detectProjectType(workspaceRoot: string): string | null {
  if (fs.existsSync(path.join(workspaceRoot, 'package.json'))) return 'Node.js';
  if (fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) return 'Rust';
  if (fs.existsSync(path.join(workspaceRoot, 'go.mod'))) return 'Go';
  if (fs.existsSync(path.join(workspaceRoot, 'pyproject.toml'))) return 'Python';
  if (fs.existsSync(path.join(workspaceRoot, 'setup.py'))) return 'Python';
  if (fs.existsSync(path.join(workspaceRoot, 'Gemfile'))) return 'Ruby';
  if (fs.existsSync(path.join(workspaceRoot, 'CMakeLists.txt'))) return 'C/C++';
  if (fs.existsSync(path.join(workspaceRoot, 'composer.json'))) return 'PHP';
  return null;
}

export function detectTestCommand(workspaceRoot: string): string {
  if (fs.existsSync(path.join(workspaceRoot, 'Cargo.toml'))) {
    return 'cargo test';
  }
  if (fs.existsSync(path.join(workspaceRoot, 'go.mod'))) {
    return 'go test ./...';
  }
  if (fs.existsSync(path.join(workspaceRoot, 'package.json'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf-8'));
      if (pkg.scripts?.test) {
        if (
          fs.existsSync(path.join(workspaceRoot, 'bun.lockb')) ||
          fs.existsSync(path.join(workspaceRoot, 'bun.lock'))
        ) {
          return 'bun test';
        }
        if (fs.existsSync(path.join(workspaceRoot, 'yarn.lock'))) {
          return 'yarn test';
        }
        if (fs.existsSync(path.join(workspaceRoot, 'pnpm-lock.yaml'))) {
          return 'pnpm test';
        }
        return 'npm test';
      }
    } catch {}
    return 'npm test';
  }
  if (
    fs.existsSync(path.join(workspaceRoot, 'pyproject.toml')) ||
    fs.existsSync(path.join(workspaceRoot, 'requirements.txt')) ||
    fs.existsSync(path.join(workspaceRoot, 'setup.py'))
  ) {
    return 'pytest';
  }
  return 'npm test';
}

export function sendDesktopNotification(title: string, message: string) {
  try {
    const cleanTitle = title.replace(/['"]/g, '');
    const cleanMessage = message.replace(/['"]/g, '');

    if (process.platform === 'darwin') {
      exec(`osascript -e 'display notification "${cleanMessage}" with title "${cleanTitle}"'`);
    } else if (process.platform === 'linux') {
      exec(`notify-send "${cleanTitle}" "${cleanMessage}"`);
    }
  } catch {}
}

export function hasRepetitionLoop(text: string): boolean {
  const strippedText = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/<think>[\s\S]*/g, '');
  const len = strippedText.length;
  const minSequenceSize = 20;
  const maxChunkSize = Math.min(200, Math.floor(len / 3));

  if (len < minSequenceSize * 3) {
    return false;
  }

  for (let size = minSequenceSize; size <= maxChunkSize; size++) {
    const chunk3 = strippedText.slice(-size);
    const chunk2 = strippedText.slice(-2 * size, -size);
    const chunk1 = strippedText.slice(-3 * size, -2 * size);
    if (chunk1 === chunk2 && chunk2 === chunk3) {
      const lettersCount = (chunk3.match(/[a-zA-Z]/g) || []).length;
      const uniqueChars = new Set(chunk3).size;

      if (uniqueChars >= 5 && lettersCount / size >= 0.35) {
        return true;
      }
    }
  }

  const lines = strippedText.split(/\r?\n/).map(line => line.trim()).filter(line => line.length > 0);
  if (lines.length >= 5) {
    const last5 = lines.slice(-5);
    const first = last5[0];
    const allMatch = last5.every(l => l === first);
    if (allMatch) {
      const uniqueChars = new Set(first).size;
      const lettersCount = (first.match(/[a-zA-Z]/g) || []).length;
      if (first.length >= 8 && uniqueChars >= 4 && lettersCount >= 3) {
        return true;
      }
    }
  }
  return false;
}
