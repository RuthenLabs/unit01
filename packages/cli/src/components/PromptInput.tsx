import React, { useState, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useStdout, useStdin } from 'ink';
import { themePrimary, themeBorder, themeGold, themeGray } from '../views/theme.js';
import { StatusBar } from './StatusBar.js';
import { CommandPopup } from './CommandPopup.js';

interface PasteBlock {
  id: number;
  start: number;
  end: number;
  lineCount: number;
}

interface PromptInputProps {
  onSubmit: (input: string) => void;
  status: { model: string; contextPct: string; branch: string };
  disabled?: boolean;
}

// Module-level persistence across renders
const inputHistory: string[] = [];
const MAX_HISTORY = 50;

const commands = [
  '/audit', '/autopilot', '/changes', '/clear', '/compact', '/connect',
  '/exit', '/export', '/files', '/help', '/mcp',
  '/models', '/overkill', '/personality', '/preview', '/quit',
  '/reindex', '/reset-password', '/search', '/sessions', '/status',
  '/thinking', '/undo'
];

export function PromptInput({ onSubmit, status, disabled = false }: PromptInputProps) {
  const [value, setValue] = useState('');
  const [cursorPos, setCursorPos] = useState(0);
  const [showPopup, setShowPopup] = useState(true);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [isGold, setIsGold] = useState(true);

  const cursorPosRef = React.useRef(cursorPos);
  useEffect(() => {
    cursorPosRef.current = cursorPos;
  }, [cursorPos]);

  const isPastingRef = React.useRef(false);
  const pasteBlocksRef = React.useRef<PasteBlock[]>([]);
  const nextPasteIdRef = React.useRef(22);

  const { stdout } = useStdout();
  const { stdin } = useStdin();
  const cols = stdout?.columns || 80;

  // Custom bracketed paste handling
  useEffect(() => {
    if (disabled) return;
    if (!stdout) return;
    stdout.write('\x1b[?2004h');
    return () => {
      stdout.write('\x1b[?2004l');
    };
  }, [stdout, disabled]);

  useEffect(() => {
    if (disabled) return;
    let isPasting = false;
    let pasteBuffer = '';

    const onData = (data: Buffer) => {
      const str = data.toString('utf-8');
      
      if (str.includes('\x1b[200~')) {
        isPasting = true;
        isPastingRef.current = true;
        const parts = str.split('\x1b[200~');
        pasteBuffer = parts[1] || '';
        if (pasteBuffer.includes('\x1b[201~')) {
          isPasting = false;
          const pasteContent = pasteBuffer.split('\x1b[201~')[0];
          setValue((prev: string) => {
            const pos = (cursorPosRef.current < 0 || cursorPosRef.current > prev.length) ? prev.length : cursorPosRef.current;
            const before = prev.slice(0, pos);
            const after = prev.slice(pos);
            const lines = pasteContent.split(/\r?\n|\r/);
            const hasNewlines = lines.length > 1;

            if (hasNewlines) {
              const start = before.length;
              const end = before.length + pasteContent.length;
              const lineCount = lines.filter(Boolean).length || 1;
              const newBlock: PasteBlock = {
                id: nextPasteIdRef.current++,
                start,
                end,
                lineCount
              };
              pasteBlocksRef.current = [...pasteBlocksRef.current, newBlock].sort((a, b) => a.start - b.start);
            }

            const newOffset = before.length + pasteContent.length;
            setCursorPos(newOffset);
            return before + pasteContent + after;
          });
          setShowPopup(false);
          pasteBuffer = '';
          setTimeout(() => {
            isPastingRef.current = false;
          }, 50);
        }
        return;
      }
      if (isPasting) {
        if (str.includes('\x1b[201~')) {
          isPasting = false;
          pasteBuffer += str.split('\x1b[201~')[0];
          const pasteContent = pasteBuffer;
          setValue((prev: string) => {
            const pos = (cursorPosRef.current < 0 || cursorPosRef.current > prev.length) ? prev.length : cursorPosRef.current;
            const before = prev.slice(0, pos);
            const after = prev.slice(pos);
            const lines = pasteContent.split(/\r?\n|\r/);
            const hasNewlines = lines.length > 1;

            if (hasNewlines) {
              const start = before.length;
              const end = before.length + pasteContent.length;
              const lineCount = lines.filter(Boolean).length || 1;
              const newBlock: PasteBlock = {
                id: nextPasteIdRef.current++,
                start,
                end,
                lineCount
              };
              pasteBlocksRef.current = [...pasteBlocksRef.current, newBlock].sort((a, b) => a.start - b.start);
            }

            const newOffset = before.length + pasteContent.length;
            setCursorPos(newOffset);
            return before + pasteContent + after;
          });
          setShowPopup(false);
          pasteBuffer = '';
          setTimeout(() => {
            isPastingRef.current = false;
          }, 50);
        } else {
          pasteBuffer += str;
        }
        return;
      }
    };

    stdin.prependListener('data', onData);
    return () => {
      stdin.off('data', onData);
    };
  }, [stdin]);

  // Cursor pulse effect (transitions from gold to violet over 600ms, then stays there)
  useEffect(() => {
    setIsGold(true);
    const timer = setTimeout(() => {
      setIsGold(false);
    }, 600);
    return () => clearTimeout(timer);
  }, []);

  // Command autocomplete matches
  const getMatches = useCallback((): string[] => {
    if (!showPopup || !value.startsWith('/')) return [];
    const query = value.toLowerCase();
    const all = commands.filter(c => c.startsWith(query));
    const filtered: string[] = [];
    let len = 6;
    for (const cmd of all) {
      const cmdLen = cmd.length + 4;
      if (len + cmdLen < cols - 5) {
        filtered.push(cmd);
        len += cmdLen;
      } else break;
    }
    return filtered;
  }, [value, showPopup, cols]);

  useInput(useCallback((input: string, key: any) => {
    if (disabled) return;
    // Intercept bracketed paste markers in useInput in case they arrive here
    if (input && input.includes('\x1b[200~')) {
      isPastingRef.current = true;
      return;
    }
    if (input && input.includes('\x1b[201~')) {
      setTimeout(() => {
        isPastingRef.current = false;
      }, 50);
      return;
    }

    // Ignore typed key events during an active paste to prevent duplicates and event locks
    if (isPastingRef.current) {
      return;
    }

    // Submit
    if (key.return) {
      const trimmed = value.trim();
      if (trimmed && (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== trimmed)) {
        inputHistory.push(trimmed);
        if (inputHistory.length > MAX_HISTORY) inputHistory.shift();
      }
      onSubmit(value);
      setValue('');
      setCursorPos(0);
      setHistoryIndex(-1);
      setShowPopup(true);
      pasteBlocksRef.current = [];
      return;
    }

    // Escape: hide popup
    if (key.escape) { setShowPopup(false); return; }

    // Tab: autocomplete first match
    if (key.tab) {
      const matches = getMatches();
      if (matches.length > 0) {
        setValue(matches[0]);
        setCursorPos(matches[0].length);
        pasteBlocksRef.current = [];
      }
      return;
    }

    // History: Up
    if (key.upArrow) {
      // Only navigate history when cursor is on the first line
      const firstNewline = value.indexOf('\n');
      const onFirstLine = firstNewline === -1 || cursorPos <= firstNewline;
      if (onFirstLine && inputHistory.length > 0 && historyIndex < inputHistory.length - 1) {
        const newIdx = historyIndex + 1;
        const entry = inputHistory[inputHistory.length - 1 - newIdx];
        setHistoryIndex(newIdx);
        setValue(entry);
        setCursorPos(entry.length);
        setShowPopup(false);
        pasteBlocksRef.current = [];
      }
      return;
    }

    // History: Down
    if (key.downArrow) {
      if (historyIndex > 0) {
        const newIdx = historyIndex - 1;
        const entry = inputHistory[inputHistory.length - 1 - newIdx];
        setHistoryIndex(newIdx);
        setValue(entry);
        setCursorPos(entry.length);
        setShowPopup(false);
        pasteBlocksRef.current = [];
      } else if (historyIndex === 0) {
        setHistoryIndex(-1);
        setValue('');
        setCursorPos(0);
        setShowPopup(true);
        pasteBlocksRef.current = [];
      }
      return;
    }

    const isLineDelete = key.ctrl && (input === 'u' || input.charCodeAt(0) === 21);

    if (isLineDelete) {
      if (value.length > 0) {
        setValue((v: string) => {
          const pos = (cursorPos <= 0 || cursorPos > v.length) ? v.length : cursorPos;
          const newText = v.slice(pos);

          // Filter out paste blocks overlapping the deleted range [0, pos]
          const remainingBlocks = pasteBlocksRef.current.filter(b => {
            const overlaps = !(b.end <= 0 || b.start >= pos);
            return !overlaps;
          });

          // Shift remaining blocks
          for (const b of remainingBlocks) {
            b.start -= pos;
            b.end -= pos;
          }

          pasteBlocksRef.current = remainingBlocks;
          setCursorPos(0);
          return newText;
        });
      }
      return;
    }

    const isBackspace = key.backspace || key.delete || (input && (input.charCodeAt(0) === 127 || input.charCodeAt(0) === 8));
    const isWordDelete = (isBackspace && key.meta) || (key.ctrl && (input === 'w' || input.charCodeAt(0) === 23));

    if (isWordDelete) {
      if (value.length > 0) {
        setValue((v: string) => {
          const pos = (cursorPos <= 0 || cursorPos > v.length) ? v.length : cursorPos;
          const { text: newText, newPos } = deletePreviousWord(v, pos);
          const deleteLength = pos - newPos;

          // Filter out paste blocks overlapping the deleted range
          const remainingBlocks = pasteBlocksRef.current.filter(b => {
            const overlaps = !(b.end <= newPos || b.start >= pos);
            return !overlaps;
          });

          // Shift remaining blocks
          for (const b of remainingBlocks) {
            if (b.start >= pos) {
              b.start -= deleteLength;
              b.end -= deleteLength;
            }
          }

          pasteBlocksRef.current = remainingBlocks;
          setCursorPos(newPos);
          return newText;
        });
      }
      return;
    }

    if (isBackspace) {
      if (value.length > 0) {
        setValue((v: string) => {
          const pos = (cursorPos <= 0 || cursorPos > v.length) ? v.length : cursorPos;
          
          // Check if cursor is exactly at the end of ANY paste block
          const targetBlockIdx = pasteBlocksRef.current.findIndex(b => pos === b.end);
          if (targetBlockIdx !== -1) {
            const block = pasteBlocksRef.current[targetBlockIdx];
            const deleteLength = block.end - block.start;
            const before = v.slice(0, block.start);
            const after = v.slice(block.end);
            
            // Remove target block from registry
            pasteBlocksRef.current.splice(targetBlockIdx, 1);
            
            // Shift all subsequent blocks to the left by deleteLength
            for (const b of pasteBlocksRef.current) {
              if (b.start >= block.end) {
                b.start -= deleteLength;
                b.end -= deleteLength;
              }
            }
            
            setCursorPos(before.length);
            return before + after;
          }

          const before = v.slice(0, pos - 1);
          const after = v.slice(pos);
          setCursorPos(before.length);
          
          // Shift all blocks starting at or after pos to the left by 1
          for (const b of pasteBlocksRef.current) {
            if (b.start >= pos) {
              b.start -= 1;
              b.end -= 1;
            }
          }
          return before + after;
        });
      }
      return;
    }

    // Left/Right
    if (key.leftArrow) { setCursorPos((p: number) => Math.max(0, p - 1)); return; }
    if (key.rightArrow) { setCursorPos((p: number) => Math.min(value.length, p + 1)); return; }

    // Regular character input (excluding control codes, backspace, and modifiers)
    if (input && input.length === 1 && input.charCodeAt(0) >= 32 && input.charCodeAt(0) !== 127 && input.charCodeAt(0) !== 8 && !key.ctrl && !key.meta) {
      setValue((v: string) => {
        const pos = (cursorPos < 0 || cursorPos > v.length) ? v.length : cursorPos;
        const before = v.slice(0, pos);
        const after = v.slice(pos);
        setCursorPos(before.length + 1);
        
        // Shift any paste blocks that start at or after pos
        for (const block of pasteBlocksRef.current) {
          if (block.start >= pos) {
            block.start += 1;
            block.end += 1;
          }
        }
        return before + input + after;
      });
      setShowPopup(true);
    }
  }, [value, cursorPos, historyIndex, onSubmit, getMatches]));

  const matches = getMatches();
  const promptChar = isGold ? themeGold('❯') : themePrimary('❯');
  const border = themeBorder('─'.repeat(Math.max(10, cols - 4)));

  const renderInputLines = () => {
    if (disabled) {
      return (
        <Text color="#64748B">
          {`  ❯ Thinking...`}
        </Text>
      );
    }
    const blocks = [...pasteBlocksRef.current].sort((a, b) => a.start - b.start);
    
    if (blocks.length === 0) {
      const before = value.slice(0, cursorPos);
      const cursorChar = value[cursorPos] || ' ';
      const after = value.slice(cursorPos + 1);
      const cursorElement = themeGold.inverse(cursorChar);
      
      return (
        <Text>
          {`${promptChar} `}
          {themePrimary(before)}
          {cursorElement}
          {themePrimary(after)}
        </Text>
      );
    }

    const elements: React.ReactNode[] = [];
    let lastIdx = 0;
    let cursorRendered = false;

    const renderSegmentWithCursor = (text: string, startOffset: number) => {
      if (cursorPos >= startOffset && cursorPos <= startOffset + text.length) {
        const localPos = cursorPos - startOffset;
        const before = text.slice(0, localPos);
        const cursorChar = text[localPos] || ' ';
        const after = text.slice(localPos + 1);
        cursorRendered = true;
        return (
          <Text key={startOffset}>
            {themePrimary(before)}
            {themeGold.inverse(cursorChar)}
            {themePrimary(after)}
          </Text>
        );
      }
      return <Text key={startOffset}>{themePrimary(text)}</Text>;
    };

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      
      if (block.start > lastIdx) {
        const segment = value.slice(lastIdx, block.start);
        elements.push(renderSegmentWithCursor(segment, lastIdx));
      }

      // Styled placeholder token format: [Pasted text #ID +N lines]
      const tokenText = `[Pasted text #${block.id} +${block.lineCount - 1} lines]`;
      const isCursorAtTokenEnd = cursorPos === block.end;
      
      if (isCursorAtTokenEnd) {
        const before = tokenText.slice(0, -1);
        const lastChar = tokenText.slice(-1);
        cursorRendered = true;
        elements.push(
          <Text key={`b-${block.id}`}>
            <Text color="#38BDF8" backgroundColor="#1E293B">{before}</Text>
            <Text color="#1E293B" backgroundColor="#38BDF8">{lastChar}</Text>
          </Text>
        );
      } else {
        elements.push(
          <Text key={`b-${block.id}`} color="#38BDF8" backgroundColor="#1E293B">
            {tokenText}
          </Text>
        );
      }

      lastIdx = block.end;
    }

    if (lastIdx < value.length) {
      const segment = value.slice(lastIdx);
      elements.push(renderSegmentWithCursor(segment, lastIdx));
    }

    if (!cursorRendered) {
      elements.push(themeGold.inverse(' '));
    }

    return (
      <Text>
        {`${promptChar} `}
        {elements}
      </Text>
    );
  };

  return (
    <Box flexDirection="column">
      {matches.length > 0 && (
        <CommandPopup matches={matches} currentInput={value} />
      )}
      <Text>{border}</Text>
      <Box 
        flexDirection="column"
      >
        {renderInputLines()}
      </Box>
      <Text>{border}</Text>
      <StatusBar
        model={status.model}
        contextPct={status.contextPct}
        branch={status.branch}
      />
    </Box>
  );
}

function deletePreviousWord(text: string, pos: number): { text: string; newPos: number } {
  if (pos <= 0) return { text, newPos: 0 };
  
  let idx = pos - 1;
  while (idx >= 0 && /\s/.test(text[idx])) {
    idx--;
  }
  while (idx >= 0 && !/\s/.test(text[idx])) {
    idx--;
  }
  
  const newPos = idx + 1;
  const before = text.slice(0, newPos);
  const after = text.slice(pos);
  
  return { text: before + after, newPos };
}
