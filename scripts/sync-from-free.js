import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const freeRoot = path.resolve(__dirname, '../../unit01');
const proRoot = path.resolve(__dirname, '../');

if (!fs.existsSync(freeRoot)) {
  console.error(`Error: Free repository not found at expected sibling path: ${freeRoot}`);
  process.exit(1);
}

console.log('🔄 Syncing core and shared CLI logic from free repository...');

// Helper: copy directory recursively
function copyDirRecursive(src, dest) {
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.mkdirSync(dest, { recursive: true });
  const entries = fs.readdirSync(src, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// 1. Sync src/core/ entirely
console.log('  - Syncing src/core/ ...');
copyDirRecursive(path.join(freeRoot, 'src/core'), path.join(proRoot, 'src/core'));

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
