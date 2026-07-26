import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { stripAnsi } from '../views/theme.js';

interface ToolProgressProps {
  active: boolean;
  details: string;
}

const STAR_COLORS = ['#475569', '#FFFFFF'];

function parseToolProgress(text: string): { toolName: string; remaining: string } {
  const clean = stripAnsi(text).trim();
  
  if (clean.startsWith('delete ')) {
    return { toolName: 'delete_file', remaining: clean.substring(7) };
  }
  if (clean.startsWith('mkdir ')) {
    return { toolName: 'make_dir', remaining: clean.substring(6) };
  }
  if (clean.startsWith('copy ')) {
    return { toolName: 'copy_file', remaining: clean.substring(5) };
  }
  if (clean.startsWith('outline ')) {
    return { toolName: 'view_outline', remaining: clean.substring(8) };
  }
  if (clean.startsWith('run ')) {
    return { toolName: 'run_command', remaining: clean.substring(4) };
  }
  if (clean.startsWith('read ')) {
    return { toolName: 'read_file', remaining: clean.substring(5) };
  }
  if (clean.startsWith('patch ')) {
    return { toolName: 'patch_file', remaining: clean.substring(6) };
  }
  if (clean.startsWith('patch_blocks ')) {
    return { toolName: 'patch_file_blocks', remaining: clean.substring(13) };
  }
  if (clean.startsWith('list_dir ')) {
    return { toolName: 'list_dir', remaining: clean.substring(9) };
  }
  if (clean.startsWith('git_status')) {
    return { toolName: 'git_status', remaining: clean.substring(10) };
  }
  if (clean.startsWith('move ')) {
    return { toolName: 'move_file', remaining: clean.substring(5) };
  }
  if (clean.startsWith('Writing ')) {
    return { toolName: 'write_file', remaining: clean.substring(8) };
  }
  if (clean.startsWith('Patching ')) {
    const tool = text.includes('patch_file_blocks') ? 'patch_file_blocks' : 'patch_file';
    return { toolName: tool, remaining: clean.substring(9) };
  }
  if (clean.startsWith('Creating directory ')) {
    return { toolName: 'make_dir', remaining: clean.substring(19) };
  }

  const firstSpaceIdx = clean.indexOf(' ');
  if (firstSpaceIdx !== -1) {
    const firstWord = clean.substring(0, firstSpaceIdx);
    return { toolName: firstWord, remaining: clean.substring(firstSpaceIdx + 1) };
  }

  return { toolName: 'tool', remaining: clean };
}

export function ToolProgress({ active, details }: ToolProgressProps) {
  const [colorIndex, setColorIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setColorIndex(0);
      return;
    }

    const interval = setInterval(() => {
      setColorIndex((i) => (i + 1) % STAR_COLORS.length);
    }, 250);

    return () => clearInterval(interval);
  }, [active]);

  if (!active) return null;

  const starColor = STAR_COLORS[colorIndex];
  const { toolName, remaining } = parseToolProgress(details);

  return (
    <Box marginLeft={2}>
      <Text color={starColor} bold>● </Text>
      <Text color="#F59E0B" bold>{toolName} </Text>
      <Text color="#F1F5F9">{remaining}</Text>
    </Box>
  );
}
