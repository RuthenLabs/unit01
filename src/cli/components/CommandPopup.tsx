import React from 'react';
import { Box, Text } from 'ink';
import { themeGold, themePrimary, themeBorder } from '../views/theme.js';

interface CommandPopupProps {
  matches: string[];
  currentInput: string;
}

export function CommandPopup({ matches, currentInput }: CommandPopupProps) {
  if (matches.length === 0) return null;

  const typedLen = currentInput.length;

  return (
    <Box>
      <Text>
        {'  '}{themeBorder('│')}{' '}
        {matches.map((match, i) => {
          const typed = themeGold.bold(match.slice(0, typedLen));
          const rest = themePrimary(match.slice(typedLen));
          return (i > 0 ? '    ' : '') + typed + rest;
        }).join('')}
      </Text>
    </Box>
  );
}
