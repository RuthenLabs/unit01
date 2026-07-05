import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { themePrimary, themeGold } from '../views/theme.js';

interface InteractiveInputProps {
  title: string;
  placeholder?: string;
  onSubmit: (value: string) => void;
}

export function InteractiveInput({ title, placeholder = '', onSubmit }: InteractiveInputProps) {
  const [value, setValue] = useState('');

  useInput((input, key) => {
    if (key.return) {
      onSubmit(value);
      return;
    }
    if (key.escape) {
      onSubmit('');
      return;
    }
    if (key.backspace || key.delete) {
      setValue(prev => prev.slice(0, -1));
      return;
    }
    if (input) {
      // Strip bracketed paste markers and newlines
      const cleaned = input
        .replace(/\x1b\[200~/g, '')
        .replace(/\x1b\[201~/g, '')
        .replace(/[\r\n]+/g, '');
      
      if (cleaned.length > 0) {
        // Keep only printable characters
        const printable = Array.from(cleaned)
          .filter(char => char.charCodeAt(0) >= 32)
          .join('');
        setValue(prev => prev + printable);
      }
    }
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="#38BDF8">{title}</Text>
      <Box>
        <Text>{`❯ `}</Text>
        {value ? (
          <Text>{value}</Text>
        ) : (
          <Text color="gray">{placeholder}</Text>
        )}
        <Text>{themeGold.inverse(' ')}</Text>
      </Box>
    </Box>
  );
}
