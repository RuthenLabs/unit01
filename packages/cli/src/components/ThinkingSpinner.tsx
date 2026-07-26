import React, { useState, useEffect } from 'react';
import { Box, Text } from 'ink';
import { getRandomGoofyVerb } from './tech_words.js';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

interface ThinkingSpinnerProps {
  active: boolean;
  showText?: boolean;
}

export function ThinkingSpinner({ active, showText = false }: ThinkingSpinnerProps) {
  const [frameIndex, setFrameIndex] = useState(0);
  const [goofyVerb, setGoofyVerb] = useState('');

  useEffect(() => {
    if (!active) {
      setFrameIndex(0);
      return;
    }

    setGoofyVerb(getRandomGoofyVerb());

    const spinnerInterval = setInterval(() => {
      setFrameIndex((prev) => (prev + 1) % SPINNER_FRAMES.length);
    }, 80);

    const verbInterval = setInterval(() => {
      setGoofyVerb(getRandomGoofyVerb());
    }, 1500);

    return () => {
      clearInterval(spinnerInterval);
      clearInterval(verbInterval);
    };
  }, [active]);

  if (!active) return null;

  return (
    <Box flexDirection="row" alignItems="center">
      <Text color="#38BDF8" bold>{SPINNER_FRAMES[frameIndex]}</Text>
      {showText && goofyVerb && (
        <Text color="#38BDF8"> {goofyVerb}</Text>
      )}
    </Box>
  );
}
