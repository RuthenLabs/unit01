import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { loadMcpConfig, McpServerConfig } from './config.js';

export interface McpTool {
  serverId: string;
  serverName: string;
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface McpCallResult {
  success: boolean;
  output: string;
}

interface ConnectedServer {
  id: string;
  config: McpServerConfig;
  client: Client;
  tools: McpTool[];
}

/**
 * Manages connections to all configured MCP servers.
 * Singleton — call McpClientManager.getInstance() everywhere.
 */
export class McpClientManager {
  private static instance: McpClientManager | null = null;
  private servers: Map<string, ConnectedServer> = new Map();
  private initialized = false;

  private constructor() {}

  public static getInstance(): McpClientManager {
    if (!McpClientManager.instance) {
      McpClientManager.instance = new McpClientManager();
    }
    return McpClientManager.instance;
  }

  /**
   * Connect to all servers defined in ~/.unit01/mcp.json.
   * Safe to call multiple times — skips already-connected servers.
   */
  public async initialize(silent = false): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;

    const config = loadMcpConfig();
    const serverIds = Object.keys(config.servers);

    if (serverIds.length === 0) return;

    await Promise.allSettled(
      serverIds.map(id => this.connectServer(id, config.servers[id], silent))
    );
  }

  /** Connect to a single MCP server and discover its tools. */
  public async connectServer(id: string, serverConfig: McpServerConfig, silent = false): Promise<boolean> {
    try {
      const client = new Client(
        { name: 'unit01', version: '1.0.0' },
        { capabilities: {} }
      );

      let transport;
      if (serverConfig.transport === 'stdio') {
        if (!serverConfig.command) throw new Error(`Server "${id}" missing "command" field.`);
        transport = new StdioClientTransport({
          command: serverConfig.command,
          args: serverConfig.args || [],
          env: { ...process.env, ...(serverConfig.env || {}) } as Record<string, string>
        });
      } else if (serverConfig.transport === 'sse') {
        if (!serverConfig.url) throw new Error(`Server "${id}" missing "url" field.`);
        transport = new SSEClientTransport(new URL(serverConfig.url));
      } else {
        throw new Error(`Unknown transport type: ${(serverConfig as any).transport}`);
      }

      await client.connect(transport);

      // Discover tools from this server
      const toolsResult = await client.listTools();
      const tools: McpTool[] = (toolsResult.tools || []).map((t: any) => ({
        serverId: id,
        serverName: serverConfig.name,
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || {}
      }));

      this.servers.set(id, { id, config: serverConfig, client, tools });

      if (!silent) {
        console.log(`  [mcp] Connected to "${serverConfig.name}" (${tools.length} tools)`);
      }

      return true;
    } catch (err: any) {
      if (!silent) {
        console.error(`  [mcp] Failed to connect to "${id}": ${err.message}`);
      }
      return false;
    }
  }

  /** Disconnect and remove a server. */
  public async disconnectServer(id: string): Promise<void> {
    const server = this.servers.get(id);
    if (!server) return;
    try {
      await server.client.close();
    } catch (_) {}
    this.servers.delete(id);
  }

  /** Get all tools from all connected servers, flattened. */
  public getAllTools(): McpTool[] {
    const tools: McpTool[] = [];
    for (const server of this.servers.values()) {
      tools.push(...server.tools);
    }
    return tools;
  }

  /** Get all connected server IDs and their status. */
  public getConnectedServers(): Array<{ id: string; name: string; toolCount: number }> {
    return Array.from(this.servers.values()).map(s => ({
      id: s.id,
      name: s.config.name,
      toolCount: s.tools.length
    }));
  }

  /** Check if any MCP servers are connected. */
  public hasServers(): boolean {
    return this.servers.size > 0;
  }

  /**
   * Call a tool on a specific server.
   * @param serverId - the server ID from mcp.json
   * @param toolName - the tool name as advertised by the server
   * @param args - parsed arguments object
   */
  public async callTool(serverId: string, toolName: string, args: Record<string, any>): Promise<McpCallResult> {
    const server = this.servers.get(serverId);
    if (!server) {
      return {
        success: false,
        output: `MCP server "${serverId}" is not connected. Check ~/.unit01/mcp.json and reconnect.`
      };
    }

    try {
      const result = await server.client.callTool({ name: toolName, arguments: args });

      // Flatten content array into a string
      const content = (result.content as any[]) || [];
      const output = content
        .map((c: any) => {
          if (c.type === 'text') return c.text;
          if (c.type === 'image') return `[image: ${c.mimeType}]`;
          return JSON.stringify(c);
        })
        .join('\n');

      return { success: !result.isError, output: output || '(no output)' };
    } catch (err: any) {
      return { success: false, output: `MCP tool call failed: ${err.message}` };
    }
  }

  /**
   * Find which server owns a given tool name.
   * Returns null if not found.
   */
  public resolveToolServer(toolName: string, serverId?: string): ConnectedServer | null {
    if (serverId) {
      return this.servers.get(serverId) || null;
    }
    // Search all servers
    for (const server of this.servers.values()) {
      if (server.tools.some(t => t.name === toolName)) {
        return server;
      }
    }
    return null;
  }
}
