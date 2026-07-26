import React from 'react';
import { Box, Text } from 'ink';

interface StatusBarProps {
  model: string;
  contextPct: string;
  branch: string;
}

export function StatusBar({ model }: StatusBarProps) {
  if (!model) return null;
  const cwd = process.cwd();

  return (
    <Box width="100%" justifyContent="space-between">
      <Text color="#64748B">◈ {model}</Text>
      <Text color="#64748B">{cwd}</Text>
    </Box>
  );
}
