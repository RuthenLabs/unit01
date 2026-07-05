import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { themePrimary, themeBorder, themeGold, themeGray, isGui, guiEmit } from '../views/theme.js';

interface SelectMenuProps {
  title: string;
  options: string[];
  onSelect: (index: number) => void;
}

export function SelectMenu({ title, options, onSelect }: SelectMenuProps) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useInput(useCallback((input, key) => {
    if (key.escape) {
      onSelect(-1);
      return;
    }
    if (key.return) {
      onSelect(selectedIndex);
      return;
    }
    if (key.upArrow) {
      setSelectedIndex(i => (i > 0 ? i - 1 : options.length - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex(i => (i < options.length - 1 ? i + 1 : 0));
      return;
    }
  }, [selectedIndex, options.length, onSelect]));

  // GUI mode: emit event and listen for numeric response on stdin
  useEffect(() => {
    if (!isGui) return;
    guiEmit({ type: 'select_menu', title, options });

    const onData = (data: Buffer) => {
      const str = data.toString().trim();
      const num = parseInt(str, 10);
      if (!isNaN(num) && num >= -1 && num < options.length) {
        onSelect(num);
      }
    };
    process.stdin.on('data', onData);
    return () => { process.stdin.removeListener('data', onData); };
  }, [title, options, onSelect]);

  const MAX_VISIBLE = 8;
  let startIndex = 0;
  let endIndex = options.length;

  if (options.length > MAX_VISIBLE) {
    const half = Math.floor(MAX_VISIBLE / 2);
    startIndex = selectedIndex - half;
    if (startIndex < 0) {
      startIndex = 0;
    }
    endIndex = startIndex + MAX_VISIBLE;
    if (endIndex > options.length) {
      endIndex = options.length;
      startIndex = Math.max(0, endIndex - MAX_VISIBLE);
    }
  }

  const visibleOptions = options.slice(startIndex, endIndex);
  const hasMoreAbove = startIndex > 0;
  const hasMoreBelow = endIndex < options.length;

  return (
    <Box flexDirection="column">
      <Text>{' '}</Text>
      <Text bold color="#F1F5F9">{themePrimary.bold(title)}</Text>
      <Text>{themeBorder('─'.repeat(40))}</Text>
      
      {hasMoreAbove && (
        <Text color="#475569">    ▲ ... more options above ...</Text>
      )}

      {visibleOptions.map((opt, i) => {
        const actualIndex = startIndex + i;
        const isSelected = actualIndex === selectedIndex;
        return (
          <Box key={actualIndex}>
            <Text>
              {isSelected
                ? `  ${themeGold('❯')} ${themePrimary.bold(opt)}`
                : `    ${themeGray(opt)}`
              }
            </Text>
          </Box>
        );
      })}

      {hasMoreBelow && (
        <Text color="#475569">    ▼ ... more options below ...</Text>
      )}

      <Text>{themeBorder('─'.repeat(40))}</Text>
      <Text color="#64748B">  [Position: {selectedIndex + 1} / {options.length}]</Text>
    </Box>
  );
}
