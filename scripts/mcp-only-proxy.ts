// Forwards ONLY the MCP endpoint (/api/mcp and /api/mcp/<key>) to the app, so a public tunnel never exposes /approvals
// or the other /api routes (which have no login in this prototype). `npm run dev` runs it in front of its tunnel and
// logs every request (key redacted) to the terminal and data/mcp-access.log, to see what a connector actually sends.
//   npx tsx scripts/mcp-only-proxy.ts          # listens on :3200, forwards to AIMO_BASE_URL (default http://localhost:3100)
//   cloudflared tunnel --url http://localhost:3200
import { appendFileSync } from 'node:fs';
import http from 'node:http';
import { pathToFileURL } from 'node:url';

const MCP_PATH = /^\/api\/mcp(\/[^/?]+)?\/?$/;
export const ACCESS_LOG = 'data/mcp-access.log';

/** The request line without secrets: the path key and ?key= become "***". */
export const redact = (url: string) => url.replace(/^(\/api\/mcp\/)[^/?]+/, '$1***').replace(/([?&]key=)[^&]+/, '$1***');

/** Starts the proxy on `port`, forwarding the MCP endpoint (with its path and query) to `target`. */
export function startMcpProxy(port: number, target: URL, log: (line: string) => void = () => {}): http.Server {
  return http.createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    const started = Date.now();
    const note = (status: number | string) => log(
      `${new Date().toISOString()} ${req.method} ${redact(req.url ?? '')} → ${status} ${Date.now() - started}ms`
      + ` origin=${req.headers.origin ?? '-'} ua=${(req.headers['user-agent'] ?? '-').slice(0, 60)}`,
    );
    if (!MCP_PATH.test(path)) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Only /api/mcp is served here\n');
      note(404);
      return;
    }
    const headers = { ...req.headers, host: target.host };
    const upstream = http.request({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
      note(up.statusCode ?? '?');
    });
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502).end('Upstream unavailable\n');
      note('502 upstream unavailable');
    });
    req.pipe(upstream);
  }).listen(port);
}

/** Logs to the terminal and appends to data/mcp-access.log. */
export function accessLogger(prefix = '[mcp]'): (line: string) => void {
  return (line) => {
    console.log(`\x1b[2m${prefix} ${line}\x1b[0m`);
    try { appendFileSync(ACCESS_LOG, `${line}\n`); } catch { /* data/ missing: terminal only */ }
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const PORT = Number(process.env.PORT ?? 3200);
  const TARGET = new URL(process.env.AIMO_BASE_URL ?? 'http://localhost:3100');
  startMcpProxy(PORT, TARGET, accessLogger()).on('listening', () => console.log(`MCP-only proxy on http://localhost:${PORT}/api/mcp → ${TARGET.origin}/api/mcp`));
}
