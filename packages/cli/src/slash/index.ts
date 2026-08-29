import { SlashContext } from './types.js';
import { handleSessionCommands } from './session.js';
import { handleModelCommands } from './models.js';
import { handleConnectCommands } from './connect.js';
import { handleMcpCommands } from './mcp.js';
import { handleProCommands } from './pro.js';
import { handleSystemCommands } from './system.js';

export { SlashContext };

export async function dispatchSlashCommand(
  command: string,
  arg: string,
  ctx: SlashContext
): Promise<boolean> {
  const handlers = [
    handleSessionCommands,
    handleModelCommands,
    handleConnectCommands,
    handleMcpCommands,
    handleProCommands,
    handleSystemCommands
  ];

  for (const handler of handlers) {
    const handled = await handler(command, arg, ctx);
    if (handled) return true;
  }

  return false;
}
