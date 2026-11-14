import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { redact, startMcpProxy } from '../../scripts/mcp-only-proxy';

let upstream: http.Server;
let proxy: http.Server;
const lines: string[] = [];
let base = '';

beforeAll(async () => {
  upstream = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'text/plain' }).end(`${req.method} ${req.url}`)).listen(0);
  await new Promise((r) => upstream.once('listening', r));
  const target = new URL(`http://127.0.0.1:${(upstream.address() as AddressInfo).port}`);
  proxy = startMcpProxy(0, target, (l) => lines.push(l));
  await new Promise((r) => proxy.once('listening', r));
  base = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
});
afterAll(() => { proxy.close(); upstream.close(); });

describe('MCP-only proxy', () => {
  it('forwards the MCP endpoint with the key in the path or query, for any method', async () => {
    expect(await (await fetch(`${base}/api/mcp/secret-key-1`, { method: 'POST', body: '{}' })).text()).toBe('POST /api/mcp/secret-key-1');
    expect(await (await fetch(`${base}/api/mcp?key=k2`)).text()).toBe('GET /api/mcp?key=k2');
    expect((await fetch(`${base}/api/mcp/secret-key-1`, { method: 'HEAD' })).status).toBe(200);
  });

  it('serves nothing else, and never logs the key', async () => {
    expect((await fetch(`${base}/approvals`)).status).toBe(404);
    expect((await fetch(`${base}/api/mcp/a/b`)).status).toBe(404);
    expect(lines.join('\n')).not.toMatch(/secret-key-1|k2/);
    expect(redact('/api/mcp/abc?x=1&key=zz')).toBe('/api/mcp/***?x=1&key=***');
  });
});
