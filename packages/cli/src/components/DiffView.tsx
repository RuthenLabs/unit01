import React, { useMemo, useEffect } from 'react';
import { Box, Text, useStdout } from 'ink';
import * as path from 'path';
import chalk from 'chalk';
import { highlight as highlightCli } from 'cli-highlight';
import {
  themePrimary,
  themeBorder,
  themeAccentLight,
  themeGray,
  syntaxHighlightTheme,
  hexPrimary,
  hexBorder,
  hexAccent,
  hexGray,
  hexRed,
} from '../views/theme.js';

interface DiffViewProps {
  original: string | null;
  modified: string;
  language: string;
  filePath: string;
  onTruncated?: (title: string, content: string) => void;
}

interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
}

interface Hunk {
  startLine: number;
  endLine: number;
  lines: DiffLine[];
  originalLinesOffset: number;
  newLinesOffset: number;
}

// Optimized Myers Diff Algorithm (O(ND) time/space)
function diffLines(oldLines: string[], newLines: string[]): DiffLine[] {
  const N = oldLines.length;
  const M = newLines.length;
  
  if (N === 0) return newLines.map(l => ({ type: 'added', text: l }));
  if (M === 0) return oldLines.map(l => ({ type: 'removed', text: l }));

  const max = N + M;
  const v: Record<number, number> = { 1: 0 };
  const trace: Record<number, number>[] = [];

  let x = 0;
  let y = 0;
  let found = false;

  for (let d = 0; d <= max; d++) {
    trace.push({ ...v });
    for (let k = -d; k <= d; k += 2) {
      if (k === -d || (k !== d && (v[k - 1] ?? 0) < (v[k + 1] ?? 0))) {
        x = v[k + 1] ?? 0;
      } else {
        x = (v[k - 1] ?? 0) + 1;
      }
      y = x - k;
      while (x < N && y < M && oldLines[x] === newLines[y]) {
        x++;
        y++;
      }
      v[k] = x;
      if (x >= N && y >= M) {
        found = true;
        break;
      }
    }
    if (found) break;
  }

  const diff: DiffLine[] = [];
  x = N;
  y = M;
  for (let d = trace.length - 1; d >= 0; d--) {
    const vPrev = trace[d];
    const k = x - y;
    let prevK = k;
    if (k === -d || (k !== d && (vPrev[k - 1] ?? 0) < (vPrev[k + 1] ?? 0))) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = vPrev[prevK] ?? 0;
    const prevY = prevX - prevK;

    while (x > prevX && y > prevY) {
      diff.unshift({ type: 'unchanged', text: oldLines[x - 1] });
      x--;
      y--;
    }
    if (d > 0) {
      if (x > prevX) {
        diff.unshift({ type: 'removed', text: oldLines[x - 1] });
        x--;
      } else if (y > prevY) {
        diff.unshift({ type: 'added', text: newLines[y - 1] });
        y--;
      }
    }
  }

  return diff;
}

// Group contiguous diff modifications with 3 lines of surrounding context
function buildHunks(diff: DiffLine[]): Hunk[] {
  const contextSize = 3;
  const visible = new Set<number>();

  for (let i = 0; i < diff.length; i++) {
    if (diff[i].type === 'added' || diff[i].type === 'removed') {
      for (let j = Math.max(0, i - contextSize); j <= Math.min(diff.length - 1, i + contextSize); j++) {
        visible.add(j);
      }
    }
  }

  const hunks: Hunk[] = [];
  let currentHunk: Hunk | null = null;
  let oldLineCounter = 0;
  let newLineCounter = 0;

  for (let i = 0; i < diff.length; i++) {
    const line = diff[i];
    const oldNum = oldLineCounter + (line.type !== 'added' ? 1 : 0);
    const newNum = newLineCounter + (line.type !== 'removed' ? 1 : 0);

    if (visible.has(i)) {
      if (!currentHunk) {
        currentHunk = {
          startLine: Math.max(oldNum, newNum),
          endLine: 0,
          lines: [],
          originalLinesOffset: oldLineCounter,
          newLinesOffset: newLineCounter
        };
        hunks.push(currentHunk);
      }
      currentHunk.lines.push(line);
    } else {
      currentHunk = null;
    }

    if (line.type !== 'added') oldLineCounter++;
    if (line.type !== 'removed') newLineCounter++;
  }

  for (const hunk of hunks) {
    let oldOffset = hunk.originalLinesOffset;
    let newOffset = hunk.newLinesOffset;
    for (const line of hunk.lines) {
      if (line.type !== 'added') oldOffset++;
      if (line.type !== 'removed') newOffset++;
    }
    hunk.endLine = Math.max(oldOffset, newOffset);
  }

  return hunks;
}

function ModifiedFileView({
  filePath,
  original,
  modified,
  width,
  onTruncated,
}: {
  filePath: string;
  original: string;
  modified: string;
  width: number;
  onTruncated?: (title: string, content: string) => void;
}): React.ReactElement {
  const diff = useMemo(
    () => diffLines(original.split('\n'), modified.split('\n')),
    [original, modified]
  );

  const hunks = useMemo(() => buildHunks(diff), [diff]);
  const baseName = path.basename(filePath);

  const renderedLines = useMemo(() => {
    const linesList: { type: 'header' | 'line'; text: string; ansiText?: string }[] = [];
    hunks.forEach((hunk, hunkIdx) => {
      if (hunkIdx > 0) {
        linesList.push({ type: 'header', text: '  ···' });
      }
      linesList.push({ type: 'header', text: `  @@ L${hunk.startLine}-${hunk.endLine} @@` });

      let oldLineNum = hunk.originalLinesOffset;
      let newLineNum = hunk.newLinesOffset;

      hunk.lines.forEach((line) => {
        if (line.type === 'removed') {
          oldLineNum++;
          const ln = String(oldLineNum).padStart(4);
          const raw = `${ln} - ${line.text}`;
          const ansi = `${chalk.hex(hexGray)(ln)} ${chalk.hex(hexRed)(`- ${line.text}`)}`;
          linesList.push({ type: 'line', text: raw, ansiText: ansi });
        } else if (line.type === 'added') {
          newLineNum++;
          const ln = String(newLineNum).padStart(4);
          const raw = `${ln} + ${line.text}`;
          const ansi = `${chalk.hex(hexGray)(ln)} ${chalk.hex(hexAccent)(`+ ${line.text}`)}`;
          linesList.push({ type: 'line', text: raw, ansiText: ansi });
        } else {
          oldLineNum++;
          newLineNum++;
          const ln = String(newLineNum).padStart(4);
          const raw = `${ln}   ${line.text}`;
          const ansi = `${chalk.hex(hexGray)(ln)}   ${line.text}`;
          linesList.push({ type: 'line', text: raw, ansiText: ansi });
        }
      });
    });
    return linesList;
  }, [hunks]);

  const isTruncated = renderedLines.length > 40;
  const displayLines = isTruncated ? renderedLines.slice(0, 25) : renderedLines;

  useEffect(() => {
    if (isTruncated && onTruncated) {
      const fullContent = renderedLines.map(l => l.ansiText || l.text).join('\n');
      onTruncated(`Diff: ${baseName}`, fullContent);
    }
  }, [isTruncated, renderedLines, onTruncated, baseName]);

  const ruleWidth = Math.max(width - 4, 40);
  const rule = '─'.repeat(ruleWidth);

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={hexPrimary} bold>{baseName}</Text>
        <Text color={hexGray}> · modified</Text>
      </Text>
      <Text color={hexBorder}>{rule}</Text>
      {hunks.length === 0 ? (
        <Text color={hexGray}>  No visible changes.</Text>
      ) : (
        displayLines.map((line, idx) => {
          if (line.type === 'header') {
            return <Text key={idx} color={hexBorder}>{line.text}</Text>;
          }
          return <Text key={idx}>{line.ansiText || line.text}</Text>;
        })
      )}
      {isTruncated && (
        <Text color={hexGray} italic>
          {"  "}... ({renderedLines.length - 25} lines truncated) · Press Ctrl+O to view full diff
        </Text>
      )}
      <Text color={hexBorder}>{rule}</Text>
    </Box>
  );
}

function NewFileView({
  filePath,
  modified,
  width,
  onTruncated,
}: {
  filePath: string;
  modified: string;
  width: number;
  onTruncated?: (title: string, content: string) => void;
}): React.ReactElement {
  const ruleWidth = Math.max(width - 4, 40);
  const rule = '─'.repeat(ruleWidth);
  const baseName = path.basename(filePath);

  const lines = modified.split('\n');
  const isTruncated = lines.length > 40;
  const displayLines = isTruncated ? lines.slice(0, 20) : lines;

  useEffect(() => {
    if (isTruncated && onTruncated) {
      const fullContent = lines.map((line, i) => {
        const ln = String(i + 1).padStart(4);
        return `${chalk.hex(hexGray)(ln)} ${chalk.hex(hexAccent)(line)}`;
      }).join('\n');
      onTruncated(`New File: ${baseName}`, fullContent);
    }
  }, [isTruncated, lines, onTruncated, baseName]);

  return (
    <Box flexDirection="column">
      <Text>
        <Text color={hexPrimary} bold>{baseName}</Text>
        <Text color={hexGray}> · new file</Text>
      </Text>
      <Text color={hexBorder}>{rule}</Text>
      {displayLines.map((line, i) => {
        const ln = String(i + 1).padStart(4);
        return (
          <Text key={`n${i}`}>
            <Text color={hexGray}>{ln} </Text>
            <Text color={hexAccent}>{line}</Text>
          </Text>
        );
      })}
      {isTruncated && (
        <Text color={hexGray} italic>
          {"  "}... ({lines.length - 20} lines truncated) · Press Ctrl+O to view full file
        </Text>
      )}
      <Text color={hexBorder}>{rule}</Text>
    </Box>
  );
}

export function DiffView({ original, modified, filePath, onTruncated }: DiffViewProps): React.ReactElement {
  const { stdout } = useStdout();
  const width = stdout?.columns ?? 80;

  if (original !== null) {
    return (
      <ModifiedFileView
        filePath={filePath}
        original={original}
        modified={modified}
        width={width}
        onTruncated={onTruncated}
      />
    );
  }

  return (
    <NewFileView
      filePath={filePath}
      modified={modified}
      width={width}
      onTruncated={onTruncated}
    />
  );
}
