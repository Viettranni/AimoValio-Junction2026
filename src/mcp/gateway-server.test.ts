import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

vi.mock('@/catalog/load', async () => {
  const { products } = await import('@/mastra/fixtures.test-util');
  return { loadCatalog: () => products };
});

import { agentFor } from './identity';
import { handleMcpRequest } from './http';
import { registryTools, TOOL_GROUPS } from './registry';
import { aimoGatewayServer } from './server';

const KEYS = {
  'key-helsinki-1': { agentId: 'bot-h', customerId: 'helsinki-juhlapalvelu', displayName: 'Helsinki bot' },
  'key-other-0001': { agentId: 'bot-o', customerId: 'other-customer', displayName: 'Other bot' },
};

beforeEach(() => vi.stubEnv('AIMO_AGENT_KEYS', JSON.stringify(KEYS)));
afterEach(() => vi.unstubAllEnvs());

const rpc = (method: string, params: unknown, key?: string) => handleMcpRequest(new Request('http://localhost/api/mcp', {
  method: 'POST',
  headers: {
    'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-06-18',
    ...(key ? { authorization: `Bearer ${key}` } : {}),
  },
  body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
}), aimoGatewayServer);

async function result(res: Response) {
  const text = await res.text();
  const data = text.startsWith('{') ? text : text.split('\n').find((l) => l.startsWith('data: '))!.slice(6);
  return JSON.parse(data) as { result?: Record<string, unknown>; error?: { message: string } };
}

describe('tool registry', () => {
  it('keeps the catalogue tool names and adds the gateway tools, grouped', () => {
    expect(Object.keys(registryTools())).toEqual([
      'searchProducts', 'getProduct', 'getAlternatives', 'getIngredients', 'checkAllergens',
      'getPriceAndAvailability', 'requestOffer', 'placeOrder', 'getOrderStatus', 'getAuthorityPolicy', 'chatWithAimo',
    ]);
    expect(TOOL_GROUPS.map((g) => g.group)).toEqual(['catalog', 'pricing', 'offers', 'orders', 'policy', 'assistant']);
  });

  it('has no tool that approves, and no price input anywhere', () => {
    const tools = Object.entries(registryTools());
    expect(tools.map(([name]) => name).filter((n) => /approv|decide/i.test(n))).toEqual([]);
    const json = JSON.stringify(tools.map(([, t]) => z.toJSONSchema(t.inputSchema as z.ZodType)));
    expect(json).toContain('"deliveryDate"');
    expect(json).not.toMatch(/"(unitPrice|price|discount)"/);
  });
});

describe('identity', () => {
  it('stdio callers are identified by AIMO_AGENT_KEY, HTTP callers by the bearer key', () => {
    vi.stubEnv('AIMO_AGENT_KEY', 'key-other-0001');
    expect(agentFor({}).customerId).toBe('other-customer');
    expect(agentFor({ mcp: { extra: { authInfo: { token: 'key-helsinki-1' } } } }).agentId).toBe('bot-h');
    vi.stubEnv('AIMO_AGENT_KEY', '');
    expect(() => agentFor({})).toThrow(/Missing agent API key/);
  });
});

describe('Streamable HTTP', () => {
  it('rejects requests without a valid bearer key', async () => {
    const res = await rpc('initialize', {});
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
    expect((await rpc('initialize', {}, 'wrong-key')).status).toBe(401);
  });

  it('initializes, lists tools and scopes the policy to the key\'s customer', async () => {
    const init = await result(await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } }, 'key-helsinki-1'));
    expect(init.result).toMatchObject({ serverInfo: { name: 'aimo-gateway' } });
    const list = await result(await rpc('tools/list', {}, 'key-helsinki-1'));
    expect((list.result!.tools as Array<{ name: string }>).map((t) => t.name)).toContain('placeOrder');

    const policy = async (key: string) => {
      const r = await result(await rpc('tools/call', { name: 'getAuthorityPolicy', arguments: {} }, key));
      return JSON.parse((r.result!.content as Array<{ text: string }>)[0].text) as { customerId: string; approver: { name: string } };
    };
    expect(await policy('key-helsinki-1')).toMatchObject({ customerId: 'helsinki-juhlapalvelu', approver: { name: 'Anna Virtanen' } });
    expect(await policy('key-other-0001')).toMatchObject({ customerId: 'other-customer' });

    const playbook = await result(await rpc('resources/read', { uri: 'aimo://playbook' }, 'key-helsinki-1'));
    expect((playbook.result!.contents as Array<{ text: string }>)[0].text).toContain('requestOffer');
  });
});
