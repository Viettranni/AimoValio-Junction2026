import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PRESET_CONNECT_KEY, requestKey, resolveAgent } from './agents';
import { HOSTED_BASE_URL, connectInfo } from './connect';

const missing = path.join(tmpdir(), 'no-such-connect.json');

describe('connect link', () => {
  it('uses the preset key and the hosted demo URL without a tunnel', () => {
    const info = connectInfo('http://localhost:3100', {}, missing);
    expect(info).toEqual({
      key: PRESET_CONNECT_KEY,
      isPublic: true,
      mcpUrl: `${HOSTED_BASE_URL}/api/mcp/${PRESET_CONNECT_KEY}`,
      localMcpUrl: `http://localhost:3100/api/mcp/${PRESET_CONNECT_KEY}`,
    });
  });

  it('prefers the tunnel URL that npm run dev wrote', () => {
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'aimo-')), 'connect.json');
    writeFileSync(file, JSON.stringify({ publicBaseUrl: 'https://abc.trycloudflare.com/' }));
    const info = connectInfo('http://localhost:3100', { AIMO_CONNECT_KEY: 'custom-key-123' }, file);
    expect(info.isPublic).toBe(true);
    expect(info.mcpUrl).toBe('https://abc.trycloudflare.com/api/mcp/custom-key-123');
    expect(info.localMcpUrl).toBe('http://localhost:3100/api/mcp/custom-key-123');
  });

  it('the preset key resolves to the demo customer, from the header or ?key=', () => {
    expect(resolveAgent(PRESET_CONNECT_KEY, {}).customerId).toBe('helsinki-juhlapalvelu');
    expect(requestKey(null, `http://x/api/mcp/${PRESET_CONNECT_KEY}`)).toBe(PRESET_CONNECT_KEY);
    expect(requestKey('Bearer abc-header', 'http://x/api/mcp?key=other')).toBe('abc-header');
    expect(requestKey(null, 'http://x/api/mcp')).toBeNull();
    expect(requestKey(null, `http://x/api/mcp/${PRESET_CONNECT_KEY}`)).toBe(PRESET_CONNECT_KEY);
    expect(requestKey(null, 'http://x/api/mcp/abc/extra')).toBeNull();
  });

  it('AIMO_AGENT_KEYS replaces the preset key (fails closed)', () => {
    const keys = JSON.stringify({ 'only-this-key': { agentId: 'a', customerId: 'c', displayName: 'd' } });
    expect(() => resolveAgent(PRESET_CONNECT_KEY, { AIMO_AGENT_KEYS: keys })).toThrow();
  });
});
