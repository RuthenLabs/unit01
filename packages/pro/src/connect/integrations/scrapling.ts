import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { SearchResult } from './search.js';

const VENV_PYTHON = path.join(os.homedir(), '.unit01', 'venv', 'bin', 'python');
const VENV_PIP = path.join(os.homedir(), '.unit01', 'venv', 'bin', 'pip');

/**
 * Returns the best available Python executable with Scrapling installed.
 */
export async function getScraplingPythonPath(): Promise<string | null> {
  if (fs.existsSync(VENV_PYTHON)) {
    const works = await testPythonScrapling(VENV_PYTHON);
    if (works) return VENV_PYTHON;
  }

  // Check system python3
  const systemWorks = await testPythonScrapling('python3');
  if (systemWorks) return 'python3';

  return null;
}

/**
 * Test if a given python binary has scrapling installed.
 */
function testPythonScrapling(pythonBin: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(pythonBin, ['-c', 'import scrapling; from scrapling import Fetcher'], {
      stdio: 'ignore'
    });
    child.on('close', (code) => {
      resolve(code === 0);
    });
    child.on('error', () => {
      resolve(false);
    });
  });
}

/**
 * Check if Scrapling is installed and ready to use.
 */
export async function isScraplingAvailable(): Promise<boolean> {
  const bin = await getScraplingPythonPath();
  return bin !== null;
}

/**
 * Automatically provision Scrapling in ~/.unit01/venv if not present.
 */
export async function autoProvisionScrapling(): Promise<boolean> {
  const venvDir = path.join(os.homedir(), '.unit01', 'venv');
  
  return new Promise((resolve) => {
    const createVenv = () => {
      const venvProcess = spawn('python3', ['-m', 'venv', venvDir], { stdio: 'pipe' });
      venvProcess.on('close', (code) => {
        if (code !== 0) return resolve(false);
        const pipProcess = spawn(VENV_PIP, ['install', 'scrapling[fetchers]', 'markdownify'], { stdio: 'pipe' });
        pipProcess.on('close', (pipCode) => {
          resolve(pipCode === 0);
        });
        pipProcess.on('error', () => resolve(false));
      });
      venvProcess.on('error', () => resolve(false));
    };

    if (!fs.existsSync(venvDir)) {
      createVenv();
    } else {
      const pipProcess = spawn(VENV_PIP, ['install', 'scrapling[fetchers]', 'markdownify'], { stdio: 'pipe' });
      pipProcess.on('close', (pipCode) => {
        resolve(pipCode === 0);
      });
      pipProcess.on('error', () => resolve(false));
    }
  });
}

/**
 * Execute web search via Scrapling stealth TLS engine.
 */
export async function executeScraplingSearch(query: string, limit = 5): Promise<SearchResult[]> {
  const pythonBin = await getScraplingPythonPath();
  if (!pythonBin) {
    throw new Error('Scrapling Python environment is not available.');
  }

  const script = `
import json, sys
try:
    from scrapling import Fetcher
    response = Fetcher.post('https://lite.duckduckgo.com/lite/', data={'q': sys.argv[1]}, timeout=15)
    results = []
    titles = response.css('a.result-link')
    snippets = response.css('td.result-snippet')
    max_count = int(sys.argv[2])
    
    for i in range(min(len(titles), max_count * 2)):
        url = titles[i].attrib.get('href', '')
        title = titles[i].get_all_text().strip()
        snippet = snippets[i].get_all_text().strip() if i < len(snippets) else ''
        if url.startswith('http'):
            results.append({'title': title, 'url': url, 'snippet': snippet})
            if len(results) >= max_count:
                break
    print(json.dumps(results))
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
`;

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, ['-c', script, query, String(limit)], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Scrapling search failed: ${stderr || 'Unknown error'}`));
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (err: any) {
        reject(new Error(`Failed to parse Scrapling output: ${err.message}`));
      }
    });

    child.on('error', (err) => reject(err));
  });
}

/**
 * Execute webpage fetch and clean markdown extraction via Scrapling.
 */
export async function executeScraplingFetch(url: string): Promise<string> {
  const pythonBin = await getScraplingPythonPath();
  if (!pythonBin) {
    throw new Error('Scrapling Python environment is not available.');
  }

  const script = `
import sys, json
try:
    from scrapling import Fetcher
    response = Fetcher.get(sys.argv[1], timeout=20)
    if response.status != 200:
        sys.stderr.write(f"HTTP {response.status}")
        sys.exit(1)
        
    try:
        md = response.markdown() if callable(getattr(response, 'markdown', None)) else response.text
    except Exception:
        md = response.text or response.get_all_text()
        
    # Truncate if exceeds token limits
    if len(md) > 20000:
        md = md[:20000] + "\\n\\n[Content truncated to 20,000 characters]"
        
    sys.stdout.write(md)
except Exception as e:
    sys.stderr.write(str(e))
    sys.exit(1)
`;

  return new Promise((resolve, reject) => {
    const child = spawn(pythonBin, ['-c', script, url], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    child.on('close', (code) => {
      if (code !== 0) {
        return reject(new Error(`Scrapling fetch failed: ${stderr || 'Unknown error'}`));
      }
      resolve(stdout.trim());
    });

    child.on('error', (err) => reject(err));
  });
}
