import React, { useMemo } from 'react';
import { Box, Text, useStdout } from 'ink';
import chalk from 'chalk';
import { marked, Marked } from 'marked';
import TerminalRenderer from 'marked-terminal';
import { highlight as highlightCli } from 'cli-highlight';
import { syntaxHighlightTheme, stripAnsi, getCols } from '../views/theme.js';

import { ThinkingSpinner } from './ThinkingSpinner.js';

interface ChatStreamProps {
  text: string;
  isStreaming: boolean;
  thinkingEnabled: boolean;
  showThinking: boolean;
  onTruncated?: (title: string, content: string) => void;
}



interface ParsedMessage {
  prose: string;
  thinkContent: string;
}

function parseMessageContent(text: string): ParsedMessage {
  // Strip after tool tag
  let processable = text;
  const TOOL_TAGS = [
    '<run_command', '<read_file', '<search_code', '<write_file',
    '<patch_file', '<patch_file_blocks', '<list_dir', '<git_status',
    '<diagnostics', '<move_file', '<question', '<path_question',
    '<sandbox_exec', '<view_outline', '<ask_user', '<delete_file', '<web_search',
    '<make_dir', '<copy_file'
  ];
  for (const tag of TOOL_TAGS) {
    const idx = processable.indexOf(tag);
    if (idx !== -1) {
      processable = processable.substring(0, idx);
      break;
    }
  }

  // Parse think blocks
  const thinkPattern = /<think>([\s\S]*?)(?:<\/think>|$)/g;
  let match;
  let remainingText = '';
  let thinkContent = '';
  let lastIdx = 0;

  while ((match = thinkPattern.exec(processable)) !== null) {
    if (match.index > lastIdx) {
      remainingText += processable.substring(lastIdx, match.index);
    }
    thinkContent += (thinkContent ? '\n' : '') + match[1].trim();
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < processable.length) {
    remainingText += processable.substring(lastIdx);
  }

  return {
    prose: remainingText.trim(),
    thinkContent
  };
}

export function ChatStream({ text, isStreaming, thinkingEnabled, showThinking, onTruncated }: ChatStreamProps): React.ReactElement | null {
  const { stdout } = useStdout();
  const cols = stdout?.columns || 80;
  const cardWidth = Math.max(40, cols - 8);

  const { prose, thinkContent } = useMemo(() => {
    return parseMessageContent(text);
  }, [text]);

  const renderedProse = useMemo(() => {
    if (!prose.trim()) return '';
    try {
      const renderer = new TerminalRenderer({
        width: cardWidth - 8,
        codespan: chalk.hex('#38BDF8').bgHex('#1E293B'),
        firstHeading: chalk.hex('#F1F5F9').bold,
        heading: chalk.hex('#F1F5F9').bold,
        tableOptions: {
          chars: {
            'top': '─', 'top-mid': '┬', 'top-left': '╭', 'top-right': '╮',
            'bottom': '─', 'bottom-mid': '┴', 'bottom-left': '╰', 'bottom-right': '╯',
            'left': '│', 'left-mid': '├', 'mid': '─', 'mid-mid': '┼',
            'right': '│', 'right-mid': '┤', 'middle': '│'
          },
          style: {
            head: ['blue', 'bold'],
            border: ['gray']
          }
        }
      });

      const rendererKeys = [
        'blockquote', 'html', 'heading', 'hr', 'list', 'listitem', 'checkbox',
        'paragraph', 'table', 'tablerow', 'tablecell', 'strong', 'em', 'codespan',
        'br', 'del', 'link', 'image', 'text'
      ];

      const plainRenderer: any = {};
      for (const key of rendererKeys) {
        if (typeof (renderer as any)[key] === 'function') {
          plainRenderer[key] = (renderer as any)[key].bind(renderer);
        }
      }

      // Override the code block renderer directly to work with Marked v12 token layout
      plainRenderer.code = (codeToken: any, lang?: string, escaped?: boolean) => {
        const codeText = typeof codeToken === 'object' ? codeToken.text : codeToken;
        const codeLang = typeof codeToken === 'object' ? codeToken.lang : lang;

        let highlighted = codeText;
        try {
          highlighted = highlightCli(codeText, { language: codeLang || 'text', theme: syntaxHighlightTheme });
        } catch {
          highlighted = chalk.hex('#38BDF8')(codeText);
        }

        const lines = highlighted.split('\n');
        if (lines.length > 0 && lines[lines.length - 1].trim() === '') {
          lines.pop();
        }

        const codeWidth = Math.max(30, cardWidth - 8);

        const paddedCodeLines = lines.map((l: string) => {
          const lineContent = '  ' + l;
          const visualLen = stripAnsi(lineContent).length;
          const paddingNeeded = Math.max(0, codeWidth - visualLen);
          return chalk.bgHex('#1E293B')(lineContent + ' '.repeat(paddingNeeded));
        });

        const isTruncated = lines.length > 20;
        const displayLines = isTruncated ? paddedCodeLines.slice(0, 10) : paddedCodeLines;

        if (isTruncated && onTruncated) {
          const fullBlock = paddedCodeLines.join('\n');
          onTruncated(`Code Block (${codeLang || 'code'})`, fullBlock);
        }

        let outputStr = displayLines.join('\n');
        if (isTruncated) {
          const truncMsg = `  ... (${lines.length - 10} lines truncated) · Press Ctrl+O to view full code`;
          outputStr += '\n' + chalk.hex('#64748B').italic(truncMsg);
        }

        return `\n${outputStr}\n`;
      };

      const markedInstance = new Marked({ renderer: plainRenderer });
      return markedInstance.parse(prose) as string;
    } catch {
      return prose;
    }
  }, [prose, cardWidth, onTruncated]);

  const hasActiveTool = /<(write_file|patch_file_blocks|patch_file|make_dir)/.test(text);

  if (!(renderedProse as string).trim() && !thinkContent.trim() && !isStreaming) {
    return null;
  }

  // 1. Spinner only during early streaming, hidden if tool is running
  const isSpinnerOnly = isStreaming && !(renderedProse as string).trim() && !thinkContent.trim() && !hasActiveTool;

  return (
    <Box flexDirection="column" marginTop={1} marginBottom={0} marginLeft={2}>
      {isSpinnerOnly && (
        <Box flexDirection="row" alignItems="center" marginBottom={0}>
          <ThinkingSpinner active={true} showText={true} />
        </Box>
      )}

      {/* Model Thought block */}
      {thinkingEnabled && thinkContent.trim().length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Box flexDirection="row">
            <Text color="#475569" bold>Thinking: </Text>
            {showThinking ? (
              <Text color="#64748B" italic>(Press Ctrl+T to collapse)</Text>
            ) : (
              <Text color="#64748B" italic>[Collapsed · Press Ctrl+T to expand]</Text>
            )}
          </Box>
          {showThinking && (
            <Box
              marginTop={1}
              borderStyle="single"
              borderLeft={true}
              borderRight={false}
              borderTop={false}
              borderBottom={false}
              borderColor="#475569"
              paddingLeft={1}
            >
              <Text color="#64748B" italic>
                {thinkContent}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {(renderedProse as string).trim().length > 0 && <Text>{renderedProse as string}</Text>}
    </Box>
  );
}
