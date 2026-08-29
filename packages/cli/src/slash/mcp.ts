import chalk from 'chalk';
import { SlashContext } from './types.js';

export async function handleMcpCommands(command: string, arg: string, ctx: SlashContext): Promise<boolean> {
  if (command !== '/mcp') return false;

  const { ui } = ctx;
  const { McpClientManager } = await import('@unit01/core/mcp/client.js');
  const { loadMcpConfig, removeMcpServer } = await import('@unit01/core/mcp/config.js');
  const mcpManager = McpClientManager.getInstance();
  const subCmd = arg?.trim().split(/\s+/)[0] || '';
  const subArgs = arg?.trim().split(/\s+/).slice(1) || [];

  // /mcp (no args) — list connected servers + their tools
  if (!subCmd) {
    const connected = mcpManager.getConnectedServers();
    const config = loadMcpConfig();
    const configuredIds = Object.keys(config.servers);

    if (configuredIds.length === 0) {
      ui.printSystemMessage('info', 'No MCP servers configured. Use /mcp add <id> to add one.');
      ui.addTextOutput(
        `  ${chalk.hex('#6B7280')('Example:')}\n` +
        `  ${chalk.hex('#F59E0B')('/mcp add filesystem')} ${chalk.hex('#6B7280')('— then follow the prompts')}\n` +
        `  ${chalk.hex('#F59E0B')('/mcp add github-mcp')} ${chalk.hex('#6B7280')('— for GitHub MCP server')}`
      );
    } else {
      const lines = configuredIds.map(id => {
        const srv = config.servers[id];
        const conn = connected.find(c => c.id === id);
        const status = conn
          ? chalk.hex('#34D399')('● connected') + chalk.hex('#6B7280')(` (${conn.toolCount} tools)`)
          : chalk.hex('#F87171')('○ disconnected');
        return `  ${chalk.hex('#F59E0B')(id.padEnd(20))} ${status}  ${chalk.hex('#6B7280')(srv.description || srv.name)}`;
      });
      ui.addTextOutput(`\n${lines.join('\n')}\n`);

      const allTools = mcpManager.getAllTools();
      if (allTools.length > 0) {
        const toolLines = allTools.map(t =>
          `  ${chalk.hex('#38BDF8')(t.serverId.padEnd(20))} ${chalk.white(t.name.padEnd(30))} ${chalk.hex('#6B7280')(t.description.slice(0, 60))}`
        );
        ui.addTextOutput(`  ${chalk.hex('#F59E0B')('Available MCP Tools:')}\n${toolLines.join('\n')}\n`);
      }
    }
    return true;
  }

  // /mcp add <id> — interactive add
  if (subCmd === 'add') {
    const id = subArgs[0];
    if (!id) {
      ui.printSystemMessage('error', 'Usage: /mcp add <server-id>');
      return true;
    }
    ui.addTextOutput(
      `\n  ${chalk.hex('#F59E0B').bold('Adding MCP Server: ')}${chalk.white(id)}\n` +
      `  Edit ${chalk.hex('#38BDF8')('~/.unit01/mcp.json')} and add:\n\n` +
      `  ${chalk.hex('#6B7280')(JSON.stringify({
        [id]: {
          name: id,
          transport: 'stdio',
          command: 'npx',
          args: ['-y', `@modelcontextprotocol/${id}`],
          description: 'Your MCP server description'
        }
      }, null, 2).split('\n').join('\n  '))}\n\n` +
      `  Then run ${chalk.hex('#F59E0B')('/mcp reload')} to connect.\n`
    );
    return true;
  }

  // /mcp reload — reconnect all servers from config
  if (subCmd === 'reload') {
    ui.printSystemMessage('info', 'Reloading MCP servers...');
    const config = loadMcpConfig();
    let connected = 0;
    for (const [id, srv] of Object.entries(config.servers)) {
      const ok = await mcpManager.connectServer(id, srv, false);
      if (ok) connected++;
    }
    ui.printSystemMessage('info', `MCP reload complete — ${connected}/${Object.keys(config.servers).length} servers connected.`);
    return true;
  }

  // /mcp remove <id>
  if (subCmd === 'remove') {
    const id = subArgs[0];
    if (!id) {
      ui.printSystemMessage('error', 'Usage: /mcp remove <server-id>');
      return true;
    }
    await mcpManager.disconnectServer(id);
    const removed = removeMcpServer(id);
    if (removed) {
      ui.printSystemMessage('info', `MCP server "${id}" removed.`);
    } else {
      ui.printSystemMessage('error', `Server "${id}" not found in config.`);
    }
    return true;
  }

  ui.printSystemMessage('info', 'Usage: /mcp · /mcp add <id> · /mcp remove <id> · /mcp reload');
  return true;
}
