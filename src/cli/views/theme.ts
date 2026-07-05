import chalk from 'chalk';
import { execSync } from 'child_process';

let cachedCols: number | null = null;

export function getCols(): number {
  if (cachedCols !== null) return cachedCols;
  
  if (process.stdout.columns) {
    cachedCols = process.stdout.columns;
    return cachedCols;
  }
  if (process.stderr.columns) {
    cachedCols = process.stderr.columns;
    return cachedCols;
  }
  
  try {
    const sizeStr = execSync('stty size < /dev/tty 2>/dev/null').toString().trim();
    const parts = sizeStr.split(/\s+/);
    if (parts.length === 2) {
      const cols = parseInt(parts[1], 10);
      if (!isNaN(cols) && cols > 0) {
        cachedCols = cols;
        return cachedCols;
      }
    }
  } catch (e) {}

  try {
    const colsStr = execSync('tput cols < /dev/tty 2>/dev/null').toString().trim();
    const cols = parseInt(colsStr, 10);
    if (!isNaN(cols) && cols > 0) {
      cachedCols = cols;
      return cachedCols;
    }
  } catch (e) {}
  
  return 80;
}

if (typeof process.stdout.on === 'function') {
  process.stdout.on('resize', () => {
    cachedCols = process.stdout.columns || null;
  });
}


export const hexPrimary     = '#F8FAFC';
export const hexBorder      = '#334155';
export const hexAccent      = '#4ADE80';
export const hexAccentLight = '#38BDF8';
export const hexGray        = '#64748B';
export const hexRed         = '#FB7171';

export const themePrimary     = chalk.hex(hexPrimary); // Primary Text
export const themeBorder      = chalk.hex(hexBorder); // Section Dividers & borders
export const themeGold        = chalk.hex(hexAccentLight); // Sky Blue Accent
export const themeOrange      = chalk.hex(hexAccentLight); // backward compat alias
export const themeAccent      = chalk.hex(hexAccent); // Tool success / status messages
export const themeAccentLight = chalk.hex(hexAccentLight); // Inline code / Light accent
export const themeGray        = chalk.hex(hexGray); // Secondary text
export const themeRed         = chalk.hex(hexRed); // Errors / failures
export const themeBg          = '#1E293B';            // Base Slate
export const themeBgDeep      = '#0F172A';            // Dark Slate

export const syntaxHighlightTheme: any = {
  keyword: chalk.hex('#D946EF').bold,    // Vibrant Magenta
  built_in: chalk.hex('#818CF8'),       // Soft Indigo
  string: chalk.hex('#4ADE80'),         // Mint Green
  number: chalk.hex('#FB923C'),         // Soft Orange
  comment: chalk.hex('#64748B').dim,     // Muted Slate Gray
  function: chalk.hex('#38BDF8').bold,   // Sky Blue
  class: chalk.hex('#60A5FA').bold,      // Light Blue
  type: chalk.hex('#38BDF8'),            // Sky Blue
  literal: chalk.hex('#FB923C'),         // Soft Orange
  default: chalk.hex('#F8FAFC')          // Slate White
};


export const isGui = process.argv.includes('--gui');

export function guiEmit(event: any) {
  console.log(`__GUI_EVENT__:${JSON.stringify(event)}`);
}

export function stripAnsi(str: string): string {
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '');
}

export function countVisualLines(text: string, cols: number): number {
  const lines = text.split('\n');
  let totalLines = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].replace(/\t/g, '    ');
    const clean = stripAnsi(line);
    const len = clean.length;
    if (len === 0) {
      totalLines += 1;
    } else {
      totalLines += Math.ceil(len / cols);
    }
  }
  return totalLines;
}

export function truncateAnsiString(str: string, maxLength: number): string {
  const visualLen = stripAnsi(str).length;
  if (visualLen <= maxLength) {
    return str;
  }
  
  const limit = maxLength - 1;
  let currentVisualLen = 0;
  let result = '';
  let i = 0;
  while (i < str.length) {
    if (str[i] === '\u001b') {
      let j = i + 1;
      while (j < str.length && str[j] !== 'm') {
        j++;
      }
      result += str.substring(i, j + 1);
      i = j + 1;
    } else {
      if (currentVisualLen < limit) {
        result += str[i];
        currentVisualLen++;
      }
      i++;
    }
  }
  return result + chalk.dim('…');
}
