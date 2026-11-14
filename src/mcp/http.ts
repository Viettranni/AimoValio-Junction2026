// Streamable HTTP for the agent gateway, from a Fetch Request (Next.js route handler) to a Fetch Response.
// Mastra's MCPServer.startHTTP takes Node req/res; this is the small adapter its docs ask for (no extra dependency):
// a Node-like request carrying the parsed body and the caller's auth, and a Node-like response that streams into a Response.
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { MCPServer } from '@mastra/mcp';
import { AuthError, requestKey, resolveAgent } from '@/gateway/agents';

const NO_BODY = new Set([101, 204, 205, 304]);
/** Largest JSON-RPC body accepted (an offer of 100 lines is a few kB). */
export const MAX_BODY_BYTES = 1_000_000;

const rpcError = (status: number, code: number, message: string, headers: Record<string, string> = {}) =>
  Response.json({ jsonrpc: '2.0', error: { code, message }, id: null }, { status, headers });

/** The subset of ServerResponse that the MCP SDK's Node adapter uses, written into a web ReadableStream. */
class StreamingResponse extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  destroyed = false;
  writableEnded = false;
  readonly response: Promise<Response>;
  private resolve!: (r: Response) => void;
  private controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  constructor(signal: AbortSignal) {
    super();
    this.response = new Promise((r) => { this.resolve = r; });
    signal.addEventListener('abort', () => this.close(), { once: true });
  }

  private close() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit('close');
  }

  private pending: Record<string, string | string[] | number> = {};

  setHeader(name: string, value: string | string[] | number) {
    this.pending[name.toLowerCase()] = value;
    return this;
  }

  getHeader(name: string) {
    return this.pending[name.toLowerCase()];
  }

  removeHeader(name: string) {
    delete this.pending[name.toLowerCase()];
  }

  writeHead(status: number, headers?: Record<string, string | string[] | number>) {
    if (this.headersSent) return this;
    this.statusCode = status;
    this.headersSent = true;
    const h = new Headers();
    for (const [k, v] of Object.entries({ ...this.pending, ...(headers ?? {}) })) {
      if (Array.isArray(v)) v.forEach((x) => h.append(k, x));
      else h.set(k, String(v));
    }
    const body = NO_BODY.has(status) ? null : new ReadableStream<Uint8Array>({
      start: (c) => { this.controller = c; },
      cancel: () => this.close(),
    });
    this.resolve(new Response(body, { status, headers: h }));
    return this;
  }

  write(chunk: string | Uint8Array): boolean {
    if (!this.headersSent) this.writeHead(this.statusCode);
    try { this.controller?.enqueue(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk); } catch { /* reader gone */ }
    return true;
  }

  end(chunk?: string | Uint8Array) {
    if (chunk !== undefined && chunk !== '') this.write(chunk);
    else if (!this.headersSent) this.writeHead(this.statusCode);
    this.writableEnded = true;
    try { this.controller?.close(); } catch { /* already closed */ }
    this.emit('finish');
    this.emit('close');
    return this;
  }

  flushHeaders() { /* headers go out with the Response */ }
}

/**
 * Handles one MCP request with an agent key (bearer header, or `?key=` for URL-only clients such as Claude connectors). The key's identity becomes the request's authInfo,
 * which the tools read (src/mcp/identity.ts); the customer is never taken from tool input.
 */
/**
 * Browsers always send Origin; MCP clients that aren't browsers usually don't. A browser page on another site
 * must not drive the gateway with a key it got hold of (DNS rebinding, CSRF-style calls), so only the endpoint's
 * own origin, localhost, Claude's own apps (claude.ai / claude.com, whose connectors call from there), and
 * AIMO_ALLOWED_ORIGINS (comma-separated) are accepted when Origin is present. The agent key is still required.
 */
/** Claude's web and desktop apps; Anthropic's connector docs warn that strict Origin checks break custom connectors. */
const CLAUDE_HOSTS = ['claude.ai', 'claude.com'];

export function originAllowed(origin: string | null, requestUrl: string, env: Record<string, string | undefined> = process.env): boolean {
  if (!origin) return true;
  let host: string;
  try { host = new URL(origin).hostname; } catch { return false; }
  const own = new URL(requestUrl).hostname;
  if (CLAUDE_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  const allowed = new Set([own, 'localhost', '127.0.0.1', '[::1]', ...(env.AIMO_ALLOWED_ORIGINS ?? '').split(',').map((o) => {
    try { return new URL(o.trim()).hostname; } catch { return o.trim(); }
  }).filter(Boolean)]);
  return allowed.has(host);
}

export async function handleMcpRequest(request: Request, server: MCPServer): Promise<Response> {
  if (!originAllowed(request.headers.get('origin'), request.url)) {
    return rpcError(403, -32003, 'Forbidden origin: browser pages on other sites may not call the Aimo gateway');
  }
  const token = requestKey(request.headers.get('authorization'), request.url);
  let agent;
  try {
    agent = resolveAgent(token);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    return rpcError(401, -32001, `${e.message}: send Authorization: Bearer <agent key> or ?key=<agent key>`, { 'WWW-Authenticate': 'Bearer realm="aimo-gateway"' });
  }

  const url = new URL(request.url);
  if (Number(request.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return rpcError(413, -32000, `Payload too large: at most ${MAX_BODY_BYTES} bytes`);
  }
  const text = request.method === 'POST' ? await request.text() : '';
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) return rpcError(413, -32000, `Payload too large: at most ${MAX_BODY_BYTES} bytes`);
  let body: unknown;
  if (text) {
    try { body = JSON.parse(text); } catch { return rpcError(400, -32700, 'Parse error: body must be JSON-RPC'); }
  }
  const headers: Record<string, string> = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  const req = Object.assign(Readable.from(text ? [Buffer.from(text)] : []), {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers,
    body,
    auth: { token: token!, clientId: agent.agentId, scopes: [], extra: { sub: agent.agentId, agentId: agent.agentId, customerId: agent.customerId } },
  });
  const res = new StreamingResponse(request.signal);
  const done = server.startHTTP({
    url, httpPath: url.pathname, req: req as unknown as IncomingMessage, res: res as unknown as ServerResponse<IncomingMessage>,
  }).catch((err: unknown) => {
    console.error('[aimo-gateway] MCP HTTP request failed', err);
  }).finally(() => {
    if (!res.headersSent) res.writeHead(500, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal error' }, id: null }));
  });
  void done;
  return res.response;
}
