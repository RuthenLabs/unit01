import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

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
  return null;
}
