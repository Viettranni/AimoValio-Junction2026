// Forwards ONLY /api/mcp to the app, so a public tunnel never exposes /approvals or the other /api routes
// (which have no login in this prototype). `npm run dev` runs it in front of its tunnel; standalone:
//   npx tsx scripts/mcp-only-proxy.ts          # listens on :3200, forwards to AIMO_BASE_URL (default http://localhost:3100)
//   cloudflared tunnel --url http://localhost:3200
import http from 'node:http';
import { pathToFileURL } from 'node:url';

/** Starts the proxy on `port`, forwarding /api/mcp (with its query, e.g. ?key=) to `target`. */
export function startMcpProxy(port: number, target: URL): http.Server {
  return http.createServer((req, res) => {
    const path = (req.url ?? '').split('?')[0];
    if (path !== '/api/mcp' || !['POST', 'GET', 'DELETE'].includes(req.method ?? '')) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Only /api/mcp is served here\n');
      return;
    }
    const headers = { ...req.headers, host: target.host };
    const upstream = http.request({ hostname: target.hostname, port: target.port, path: req.url, method: req.method, headers }, (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) res.writeHead(502).end('Upstream unavailable\n'); });
    req.pipe(upstream);
  }).listen(port);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const PORT = Number(process.env.PORT ?? 3200);
  const TARGET = new URL(process.env.AIMO_BASE_URL ?? 'http://localhost:3100');
  startMcpProxy(PORT, TARGET).on('listening', () => console.log(`MCP-only proxy on http://localhost:${PORT}/api/mcp → ${TARGET.origin}/api/mcp`));
}
