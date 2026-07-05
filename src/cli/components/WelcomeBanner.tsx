import React from 'react';
import { Box, Text } from 'ink';
import { isGui, guiEmit } from '../views/theme.js';

interface WelcomeBannerProps {
  workspaceRoot: string;
  modelName: string;
  contextLimit: number;
  fileCount: number;
  gitBranch: string;
  projectType: string | null;
  latestSession: { relTime: string; label: string } | null;
}

const jfGrid = [
  [0, 0, 0, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0], // Row 0 (Light Cyan)
  [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0], // Row 1 (Light Cyan)
  [2, 2, 2, 0, 0, 2, 2, 2, 2, 0, 0, 2, 2, 2], // Row 2 (Dark Cyan Eyes)
  [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], // Row 3 (Light Cyan)
  [0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0], // Row 4 (Dark Cyan Neck)
  [0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0], // Row 5 (Light Cyan Legs)
  [0, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0]  // Row 6 (Light Cyan Legs)
];

export function WelcomeBanner({
  workspaceRoot,
  modelName,
  contextLimit,
  fileCount,
  latestSession
}: WelcomeBannerProps) {
  if (isGui) {
    guiEmit({ type: 'init', workspaceRoot, modelName, contextLimit, fileCount });
    return null;
  }

  const padding = '';

  return (
    <Box flexDirection="column" marginBottom={1} marginTop={1}>
      {[0, 1, 2, 3, 4, 5, 6].map((i) => {
        // Build the jellyfish segment elements for this row
        const jellyfishElements: React.ReactNode[] = [];
        for (let col = 0; col < 14; col++) {
          const type = jfGrid[i][col];
          if (type === 1) {
            jellyfishElements.push(<Text key={col} bold color="#22D3EE">█</Text>);
          } else if (type === 2) {
            jellyfishElements.push(<Text key={col} bold color="#0891B2">█</Text>);
          } else {
            jellyfishElements.push(<Text key={col}> </Text>);
          }
        }

        return (
          <Box key={i}>
            <Text>{padding}</Text>
            {jellyfishElements}
          </Box>
        );
      })}
      
      <Box marginTop={1}>
        <Text>{padding}</Text>
        <Text bold color="#F1F5F9">unit01</Text>
      </Box>
      <Box>
        <Text>{padding}</Text>
        <Text color="#475569">local-first coding agent, zero cloud calls</Text>
      </Box>

      <Box marginTop={1}>
        <Text>{padding}</Text>
        <Text bold color="#22D3EE">$ </Text>
        <Text color="#F1F5F9">unit01 ~ booting local engine... </Text>
        <Text bold color="#22D3EE">ready.</Text>
      </Box>

      {latestSession && (
        <Box marginTop={1}>
          <Text>
            {'  '}
            <Text color="#475569">
              ⤿ Last session {latestSession.relTime} · "{latestSession.label}"
            </Text>
          </Text>
        </Box>
      )}
    </Box>
  );
}
