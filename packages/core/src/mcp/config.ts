import * as fs from 'fs';
import * as path from 'path';
import { homedir } from 'os';

export interface McpServerConfig {
  /** Human-readable name shown in /mcp list */
  name: string;
  /** 'stdio' = spawn a local process; 'sse' = connect to an HTTP SSE endpoint */
  transport: 'stdio' | 'sse';
  /** For stdio: the executable to run (e.g. 'npx', 'node', 'python') */
  command?: string;
  /** For stdio: args passed to command */
  args?: string[];
  /** For stdio: extra env vars injected into the spawned process */
  env?: Record<string, string>;
  /** For sse: the full URL of the SSE endpoint */
  url?: string;
  /** Optional description shown in /mcp list */
  description?: string;
}

export interface McpConfig {
  servers: Record<string, McpServerConfig>;
}

const CONFIG_DIR  = path.join(homedir(), '.unit01');
const CONFIG_FILE = path.join(CONFIG_DIR, 'mcp.json');

/** Load and parse ~/.unit01/mcp.json. Returns empty config if file doesn't exist. */
export function loadMcpConfig(): McpConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    return { servers: {} };
  }
  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as McpConfig;
    return parsed;
  } catch (err: any) {
    console.error(`[mcp] Failed to parse ~/.unit01/mcp.json: ${err.message}`);
    return { servers: {} };
  }
}

/** Persist a new or updated server entry to ~/.unit01/mcp.json. */
export function saveMcpServer(id: string, server: McpServerConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  const config = loadMcpConfig();
  config.servers[id] = server;
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
}

/** Remove a server entry from ~/.unit01/mcp.json. */
export function removeMcpServer(id: string): boolean {
  const config = loadMcpConfig();
  if (!config.servers[id]) return false;
  delete config.servers[id];
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
  return true;
}
