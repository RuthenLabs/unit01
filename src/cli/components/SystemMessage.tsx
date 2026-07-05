import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { themePrimary, isGui, guiEmit } from '../views/theme.js';

type MessageType = 'error' | 'warn' | 'guard' | 'info' | 'stop';

const TYPE_COLORS: Record<MessageType, string> = {
  error: '#F87171',
  stop: '#F87171',
  warn: '#FBBF24',
  guard: '#FBBF24',
  info: '#F59E0B',
};

interface SystemMessageProps {
  type: MessageType;
  message: string;
}

export function SystemMessage({ type, message }: SystemMessageProps) {
  if (isGui) {
    guiEmit({ type: 'system-message', status: type, message });
    return null;
  }

  const color = TYPE_COLORS[type];

  return (
    <Box marginLeft={2}>
      <Text color={color}>◈ {type}  ·  {message}</Text>
    </Box>
  );
}
