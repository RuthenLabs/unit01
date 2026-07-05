import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput } from 'ink';
import { themePrimary, themeBorder, themeGold, themeGray, isGui, guiEmit } from '../views/theme.js';

type Choice = 'y' | 'n' | 'p';

interface ConfirmWriteProps {
  filePath: string;
  lineCount: number;
  actionVerb: 'write' | 'create' | 'modify' | 'delete';
  onChoice: (choice: Choice) => void;
}

const CHOICES: { key: Choice; label: string }[] = [
  { key: 'y', label: 'yes' },
  { key: 'n', label: 'no' },
  { key: 'p', label: 'preview diff' },
];

export function ConfirmWrite({ filePath, lineCount, actionVerb, onChoice }: ConfirmWriteProps) {
  const [selected, setSelected] = useState(0);

  useInput(useCallback((input, key) => {
    if (key.return) {
      onChoice(CHOICES[selected].key);
      return;
    }
    if (key.escape) {
      onChoice('n');
      return;
    }
    if (key.leftArrow) {
      setSelected(i => (i > 0 ? i - 1 : CHOICES.length - 1));
      return;
    }
    if (key.rightArrow) {
      setSelected(i => (i < CHOICES.length - 1 ? i + 1 : 0));
      return;
    }
    // Hotkeys
    const ch = input.toLowerCase();
    if (ch === 'y' || ch === 'n' || ch === 'p') {
      onChoice(ch as Choice);
    }
  }, [selected, onChoice]));

  // GUI mode
  useEffect(() => {
    if (!isGui) return;
    guiEmit({ type: 'confirm_write', filePath, lineCount, actionVerb });

    const onData = (data: Buffer) => {
      const str = data.toString().trim().toLowerCase();
      if (str === 'y' || str === 'n' || str === 'p') {
        onChoice(str as Choice);
      }
    };
    process.stdin.on('data', onData);
    return () => { process.stdin.removeListener('data', onData); };
  }, [filePath, lineCount, actionVerb, onChoice]);

  return (
    <Box flexDirection="column">
      <Text>
        {'  '}{themePrimary.bold(actionVerb)}{'  '}{themePrimary(filePath)}
        {'  '}{themeGray('·')}{'  '}{themePrimary(`${lineCount} lines`)}
      </Text>
      <Box>
        <Text>{'  '}</Text>
        {CHOICES.map((c, i) => {
          const isSel = i === selected;
          const bracket = isSel ? themeGold : themeGray;
          const label = isSel ? themePrimary.bold(c.label) : themeGray(c.label);
          return (
            <Text key={c.key}>
              {bracket('[')}
              {isSel ? themeGold(c.key) : themeGray(c.key)}
              {bracket(']')}
              {' '}{label}{'    '}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
