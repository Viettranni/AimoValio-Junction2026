// The stdio entry must serve 2025-era clients (an `initialize` opening), which Mastra's own startStdio rejects.
// It relies on a Mastra internal (see src/mcp/stdio.ts); this test catches a @mastra/mcp upgrade that breaks it.
import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

function rpc(lines: object[], timeoutMs = 25_000): Promise<Array<{ id?: number; result?: Record<string, unknown>; error?: unknown }>> {
  return new Promise((resolve, reject) => {
    const child = spawn('npx', ['tsx', 'src/mcp/stdio.ts'], { cwd: process.cwd(), env: { ...process.env, AIMO_AGENT_KEY: 'aimo-demo-agent-key' } });
    const out: Array<{ id?: number }> = [];
    let buf = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error(`no answer: ${buf}`)); }, timeoutMs);
    child.stdout.on('data', (d: Buffer) => {
      buf += d.toString();
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        out.push(JSON.parse(line));
        if (out.filter((m) => m.id !== undefined).length === lines.filter((l) => 'id' in l).length) {
          clearTimeout(timer);
          child.kill();
          resolve(out as never);
        }
      }
    });
    for (const l of lines) child.stdin.write(`${JSON.stringify(l)}\n`);
  });
}

describe('stdio entry', () => {
  it('answers a 2025-era initialize and lists the gateway tools', async () => {
    const msgs = await rpc([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    ]);
    const init = msgs.find((m) => m.id === 1);
    expect(init?.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'aimo-gateway' } });
    const tools = (msgs.find((m) => m.id === 2)?.result?.tools as Array<{ name: string }>).map((t) => t.name);
    expect(tools).toEqual(expect.arrayContaining(['placeOrder', 'checkAllergens']));
  }, 30_000);
});
