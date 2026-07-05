import * as http from 'http';
import * as net from 'net';
import * as url from 'url';
import * as fs from 'fs';
import * as path from 'path';

export const TIER1_DOMAINS = new Set([
  'registry.npmjs.org',
  'pypi.org',
  'files.pythonhosted.org',
  'crates.io',
  'static.crates.io',
  'index.crates.io',
  'proxy.golang.org',
  'sum.golang.org',
  'github.com',
  'raw.githubusercontent.com',
  'api.github.com',
  'jsr.io'
]);

/**
 * Automatically scan package-lock.json (Tier 2) to extract registry domains.
 */
export function detectTier2Domains(workspaceRoot: string): Set<string> {
  const domains = new Set<string>();
  const packageLockPath = path.join(workspaceRoot, 'package-lock.json');
  
  if (fs.existsSync(packageLockPath)) {
    try {
      const content = fs.readFileSync(packageLockPath, 'utf-8');
      // Simple regex to extract hostnames from all "resolved" npm URLs
      const resolvedRegex = /"resolved":\s*"https?:\/\/([^/]+)/g;
      let match;
      while ((match = resolvedRegex.exec(content)) !== null) {
        domains.add(match[1]);
      }
    } catch (e) {
      console.error('[Directive AI Egress] Failed to parse package-lock.json for Tier 2 domains:', e);
    }
  }

  // Support yarn.lock if exists
  const yarnLockPath = path.join(workspaceRoot, 'yarn.lock');
  if (fs.existsSync(yarnLockPath)) {
    try {
      const content = fs.readFileSync(yarnLockPath, 'utf-8');
      const resolvedRegex = /resolved\s+"https?:\/\/([^/"]+)/g;
      let match;
      while ((match = resolvedRegex.exec(content)) !== null) {
        domains.add(match[1]);
      }
    } catch (e) {
      console.error('[Directive AI Egress] Failed to parse yarn.lock for Tier 2 domains:', e);
    }
  }

  return domains;
}

export class EgressProxy {
  private server: http.Server | null = null;
  private port: number = 0;
  private allowedDomains: Set<string>;

  constructor(allowedDomains: Set<string>) {
    this.allowedDomains = allowedDomains;
  }

  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // Handle HTTP requests
        const reqUrl = req.url ? url.parse(req.url) : null;
        const host = reqUrl?.host || req.headers.host;

        if (!host) {
          res.writeHead(400);
          res.end('Bad Request');
          return;
        }

        if (!this.isAllowed(host)) {
          console.warn(`[Directive AI Egress] Blocked HTTP connection to: ${host}`);
          res.writeHead(403);
          res.end('Forbidden by Directive AI Egress Policy');
          return;
        }

        const options = {
          hostname: reqUrl?.hostname || host.split(':')[0],
          port: reqUrl?.port ? parseInt(reqUrl.port) : 80,
          path: reqUrl?.path || req.url,
          method: req.method,
          headers: req.headers
        };

        const proxyReq = http.request(options, (proxyRes) => {
          res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
          proxyRes.pipe(res);
        });

        proxyReq.on('error', (err) => {
          res.writeHead(502);
          res.end(`Bad Gateway: ${err.message}`);
        });

        req.pipe(proxyReq);
      });

      // Handle HTTPS CONNECT requests
      this.server.on('connect', (req, clientSocket, head) => {
        const host = req.url;
        if (!host) {
          clientSocket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
          clientSocket.end();
          return;
        }

        if (!this.isAllowed(host)) {
          console.warn(`[Directive AI Egress] Blocked HTTPS connection to: ${host}`);
          clientSocket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
          clientSocket.end();
          return;
        }

        const [hostname, portStr] = host.split(':');
        const port = portStr ? parseInt(portStr) : 443;

        const serverSocket = net.createConnection(port, hostname, () => {
          clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
          serverSocket.write(head);
          clientSocket.pipe(serverSocket);
          serverSocket.pipe(clientSocket);
        });

        serverSocket.on('error', () => {
          clientSocket.write('HTTP/1.1 502 Bad Gateway\r\n\r\n');
          clientSocket.end();
        });

        clientSocket.on('error', () => {
          serverSocket.end();
        });
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server?.address();
        if (addr && typeof addr === 'object') {
          this.port = addr.port;
          resolve(this.port);
        } else {
          reject(new Error('Failed to get proxy server address'));
        }
      });
    });
  }

  public stop() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  private isAllowed(host: string): boolean {
    const hostname = host.split(':')[0].toLowerCase();
    
    if (this.allowedDomains.has(hostname)) {
      return true;
    }

    for (const domain of this.allowedDomains) {
      if (domain.startsWith('*.')) {
        const suffix = domain.slice(1);
        if (hostname.endsWith(suffix)) {
          return true;
        }
      }
    }
    return false;
  }
}
