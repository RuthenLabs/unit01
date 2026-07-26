import React, { useState } from 'react';
import { Box, Text, useInput, useStdout } from 'ink';

interface FullscreenOverlayProps {
  title: string;
  content: string;
  onClose: () => void;
}

export function FullscreenOverlay({ title, content, onClose }: FullscreenOverlayProps): React.ReactElement {
  const { stdout } = useStdout();
  const rows = stdout?.rows || 24;
  const cols = stdout?.columns || 80;

  const lines = content.split('\n');
  const [scrollOffset, setScrollOffset] = useState(0);

  // We leave 6 rows of margin for the header and footer borders/text
  const maxScroll = Math.max(0, lines.length - (rows - 6));

  useInput((input, key) => {
    if (key.escape || (key.ctrl && input === 'o')) {
      onClose();
      return;
    }
    if (key.upArrow) {
      setScrollOffset(prev => Math.max(0, prev - 1));
    } else if (key.downArrow) {
      setScrollOffset(prev => Math.min(maxScroll, prev + 1));
    } else if (key.pageUp) {
      setScrollOffset(prev => Math.max(0, prev - (rows - 8)));
    } else if (key.pageDown) {
      setScrollOffset(prev => Math.min(maxScroll, prev + (rows - 8)));
    }
  });

  const visibleLines = lines.slice(scrollOffset, scrollOffset + (rows - 6));

  const headerText = ` ◈ ${title} (Line ${scrollOffset + 1}-${Math.min(lines.length, scrollOffset + (rows - 6))} of ${lines.length}) `;
  const footerText = ` [Up/Down/PgUp/PgDn] Scroll  ·  [Esc/Ctrl+O] Close Overlay `;

  const borderLine = '─'.repeat(Math.max(10, cols - 2));

  return (
    <Box flexDirection="column" width={cols} height={rows} paddingX={1}>
      <Box flexDirection="column" marginY={1}>
        <Text color="#38BDF8" bold>{headerText}</Text>
        <Text color="#475569">{borderLine}</Text>
      </Box>
      <Box flexDirection="column" flexGrow={1} height={rows - 6}>
        {visibleLines.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text color="#475569">{borderLine}</Text>
        <Text color="#64748B">{footerText}</Text>
      </Box>
    </Box>
  );
}
