// Streamable HTTP for the agent gateway, from a Fetch Request (Next.js route handler) to a Fetch Response.
// Mastra's MCPServer.startHTTP takes Node req/res; this is the small adapter its docs ask for (no extra dependency):
// a Node-like request carrying the parsed body and the caller's auth, and a Node-like response that streams into a Response.
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { MCPServer } from '@mastra/mcp';
import { AuthError, bearerToken, resolveAgent } from '@/gateway/agents';

const NO_BODY = new Set([101, 204, 205, 304]);

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

  writeHead(status: number, headers?: Record<string, string | string[] | number>) {
    if (this.headersSent) return this;
    this.statusCode = status;
    this.headersSent = true;
    const h = new Headers();
    for (const [k, v] of Object.entries(headers ?? {})) {
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

  setHeader() { return this; }
  flushHeaders() { /* headers go out with the Response */ }
}

/**
 * Handles one MCP request with a bearer agent key. The key's identity becomes the request's authInfo,
 * which the tools read (src/mcp/identity.ts); the customer is never taken from tool input.
 */
export async function handleMcpRequest(request: Request, server: MCPServer): Promise<Response> {
  const token = bearerToken(request.headers.get('authorization'));
  let agent;
  try {
    agent = resolveAgent(token);
  } catch (e) {
    if (!(e instanceof AuthError)) throw e;
    return rpcError(401, -32001, `${e.message}: send Authorization: Bearer <agent key>`, { 'WWW-Authenticate': 'Bearer realm="aimo-gateway"' });
  }

  const url = new URL(request.url);
  const text = request.method === 'POST' ? await request.text() : '';
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
