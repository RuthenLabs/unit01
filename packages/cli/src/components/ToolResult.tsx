import React from 'react';
import { Box, Text } from 'ink';
import { isGui, guiEmit } from '../views/theme.js';

type ToolStatus = 'success' | 'failure' | 'skipped';

interface ToolResultProps {
  status: ToolStatus;
  message: string;
}

export function ToolResult({ status, message }: ToolResultProps) {
  if (isGui) {
    guiEmit({ type: 'tool-result', status, message });
    return null;
  }

  // Extract category, target, and metadata from legacy message strings
  let category = 'tool';
  let target = message;
  let metadata = '';

  // Parse "Skipped {filePath}"
  if (message.startsWith('Skipped ')) {
    category = 'write';
    target = message.substring(8);
    metadata = 'skipped';
  }
  // Parse "Ran: {cmd} (exit {code})"
  else if (message.startsWith('Ran: ')) {
    category = 'shell';
    const match = message.match(/^Ran:\s+(.+?)\s+\((.+?)\)$/);
    if (match) {
      target = match[1];
      metadata = match[2];
    }
  }
  // Parse "Wrote {filePath} ({lines})"
  else if (message.startsWith('Wrote ')) {
    category = 'write';
    const match = message.match(/^Wrote\s+(.+?)\s+\((.+?)\)$/);
    if (match) {
      target = match[1];
      metadata = match[2];
    } else {
      const failedMatch = message.match(/^Wrote\s+(.+?)\s+—\s+(.+?)$/);
      if (failedMatch) {
        target = failedMatch[1];
        metadata = failedMatch[2];
      }
    }
  }
  // Parse "Read {filePath} ({lines})"
  else if (message.startsWith('Read ')) {
    category = 'read';
    const match = message.match(/^Read\s+(.+?)\s+\((.+?)\)$/);
    if (match) {
      target = match[1];
      metadata = match[2];
    }
  }
  // Parse "Patched {filePath} ({metadata})"
  else if (message.startsWith('Patched ')) {
    category = 'patch';
    const match = message.match(/^Patched\s+(.+?)\s+\((.+?)\)$/);
    if (match) {
      target = match[1];
      metadata = match[2];
    } else {
      target = message.substring(8);
    }
  }
  // Parse "Searched/Hybrid searched "{query}" ({results} results)"
  else if (message.includes('Searched ') || message.includes('searched ')) {
    const match = message.match(/^(.+?searched)\s+"(.+?)"\s+\((.+?)\)$/i);
    if (match) {
      category = match[1].toLowerCase().includes('web') ? 'web' : 'search';
      target = `"${match[2]}"`;
      metadata = match[3];
    }
  }
  // Parse "Web searched "{query}" ({results} results)"
  else if (message.includes('Web searched ')) {
    const match = message.match(/^Web searched\s+"(.+?)"\s+\((.+?)\)$/i);
    if (match) {
      category = 'web';
      target = `"${match[1]}"`;
      metadata = match[2];
    }
  }
  // Parse "Listed directory {path}"
  else if (message.startsWith('Listed directory ')) {
    category = 'dir';
    const match = message.match(/^Listed directory\s+(.+?)\s+\((.+?)\)$/);
    if (match) {
      target = match[1];
      metadata = match[2];
    } else {
      target = message.substring(17);
    }
  }
  // Parse "Ran git status"
  else if (message.includes('git status')) {
    category = 'git';
    const match = message.match(/^Ran git status\s+\((.+?)\)$/);
    if (match) {
      target = 'status';
      metadata = match[1];
    } else {
      target = 'status';
    }
  }
  // Parse "Ran diagnostics: {cmd}"
  else if (message.startsWith('Ran diagnostics: ')) {
    category = 'diagnose';
    const match = message.match(/^Ran diagnostics:\s+(.+?)\s+\((.+?)\)$/);
    if (match) {
      target = match[1];
      metadata = match[2];
    } else {
      target = message.substring(16);
    }
  }
  // Parse "Moved {src} to {dst}"
  else if (message.startsWith('Moved ')) {
    category = 'move';
    const match = message.match(/^Moved\s+(.+?)\s+to\s+(.+?)\s+\((.+?)\)$/);
    if (match) {
      target = `${match[1]} ➔ ${match[2]}`;
      metadata = match[3];
    } else {
      const match2 = message.match(/^Moved\s+(.+?)\s+to\s+(.+?)$/);
      if (match2) {
        target = `${match2[1]} ➔ ${match2[2]}`;
      }
    }
  }

  if (!metadata && status === 'skipped') {
    metadata = 'skipped';
  }

  // Map parsed category to exact tool name (16 tools)
  let toolName = category;
  if (category === 'write') {
    toolName = 'write_file';
  } else if (category === 'shell') {
    toolName = 'run_command';
  } else if (category === 'read') {
    toolName = 'read_file';
  } else if (category === 'patch') {
    toolName = message.includes('block') || message.includes('patch_file_blocks') ? 'patch_file_blocks' : 'patch_file';
  } else if (category === 'search') {
    toolName = 'search_code';
  } else if (category === 'web') {
    toolName = 'web_search';
  } else if (category === 'dir') {
    toolName = 'list_dir';
  } else if (category === 'git') {
    toolName = 'git_status';
  } else if (category === 'diagnose') {
    toolName = 'diagnostics';
  } else if (category === 'move') {
    toolName = 'move_file';
  } else if (category === 'copy') {
    toolName = 'copy_file';
  } else if (category === 'delete') {
    toolName = 'delete_file';
  } else if (category === 'mkdir') {
    toolName = 'make_dir';
  } else if (category === 'outline') {
    toolName = 'view_outline';
  } else if (category === 'ask') {
    toolName = 'ask_user';
  }

  const statusColor = status === 'success' ? '#4ADE80' : status === 'failure' ? '#F87171' : '#FBBF24';

  return (
    <Box marginLeft={2} marginTop={0} marginBottom={0}>
      <Text color={statusColor} bold>● </Text>
      <Text color="#F59E0B" bold>{toolName} </Text>
      <Text color="#F1F5F9">{target}</Text>
      {metadata && (
        <Text color="#475569">  ·  {metadata}</Text>
      )}
    </Box>
  );
}
