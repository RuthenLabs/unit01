import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const siblingFree = path.resolve(__dirname, '../../unit01');
const nestedFree = path.resolve(__dirname, '../../unit01/unit01');
let freeRoot = siblingFree;

if (fs.existsSync(nestedFree) && fs.existsSync(path.join(nestedFree, 'src'))) {
  freeRoot = nestedFree;
} else if (fs.existsSync(siblingFree) && fs.existsSync(path.join(siblingFree, 'src'))) {
  freeRoot = siblingFree;
} else {
  // Try sibling unit01 but default fallback is still standard error message
  freeRoot = fs.existsSync(nestedFree) ? nestedFree : siblingFree;
}

const proRoot = path.resolve(__dirname, '../');

if (!fs.existsSync(freeRoot) || !fs.existsSync(path.join(freeRoot, 'src'))) {
  console.error(`Error: Free repository not found at expected path: ${freeRoot}`);
  process.exit(1);
}

console.log('🔄 Syncing core and shared CLI logic from free repository...');

// Helper: copy directory recursively
function copyDirRecursive(src, dest, excludeNames = []) {
  if (!fs.existsSync(dest)) {
    fs.mkdirSync(dest, { recursive: true });
  }

  const srcEntries = fs.readdirSync(src, { withFileTypes: true });
  const srcNames = new Set(srcEntries.map(e => e.name));

  for (const entry of srcEntries) {
    if (excludeNames.includes(entry.name)) {
      continue;
    }
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, excludeNames);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }

  // Clean up stale files in dest
  const destEntries = fs.readdirSync(dest, { withFileTypes: true });
  for (const entry of destEntries) {
    if (excludeNames.includes(entry.name)) {
      continue;
    }
    if (!srcNames.has(entry.name)) {
      const destPath = path.join(dest, entry.name);
      fs.rmSync(destPath, { recursive: true, force: true });
    }
  }
}

// 1. Sync src/core/ entirely (excluding tier.ts)
console.log('  - Syncing src/core/ (excluding tier.ts) ...');
copyDirRecursive(path.join(freeRoot, 'src/core'), path.join(proRoot, 'src/core'), ['tier.ts']);

// 2. Sync src/types.d.ts
console.log('  - Syncing src/types.d.ts ...');
fs.copyFileSync(path.join(freeRoot, 'src/types.d.ts'), path.join(proRoot, 'src/types.d.ts'));

// 3. Sync shared CLI folders
console.log('  - Syncing src/cli/components/ ...');
copyDirRecursive(path.join(freeRoot, 'src/cli/components'), path.join(proRoot, 'src/cli/components'));

console.log('  - Syncing src/cli/views/ ...');
copyDirRecursive(path.join(freeRoot, 'src/cli/views'), path.join(proRoot, 'src/cli/views'));

// 4. Sync specific shared CLI files (app.tsx, parser.ts, types.ts)
const sharedCliFiles = ['app.tsx', 'parser.ts', 'types.ts'];
for (const file of sharedCliFiles) {
  console.log(`  - Syncing src/cli/${file} ...`);
  const srcFilePath = path.join(freeRoot, 'src/cli', file);
  const destFilePath = path.join(proRoot, 'src/cli', file);
  if (fs.existsSync(srcFilePath)) {
    fs.copyFileSync(srcFilePath, destFilePath);
  }
}

console.log('✅ Sync completed successfully!');
