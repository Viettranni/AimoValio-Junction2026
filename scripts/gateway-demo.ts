// Headless demo of the Valio Aimo brief: an EXTERNAL purchasing agent that only talks MCP to the Aimo gateway.
//
//   "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements
//    based on price and availability."
//
//   npx tsx --env-file-if-exists=.env.local scripts/gateway-demo.ts            # 1,000 l → over the limit → pending approval
//   npx tsx --env-file-if-exists=.env.local scripts/gateway-demo.ts --small    # 100 l → within authority → ordered
//   ... --http [url]   use the remote endpoint (default http://localhost:3100/api/mcp) instead of spawning stdio
//   ... --llm          let Claude drive the same tools (needs ANTHROPIC_API_KEY or AIMO_MODEL + its key)
//
// The deterministic agent below needs no language model: search → price/availability → pick → offer → order.
import { MCPClient } from '@mastra/mcp';

const args = process.argv.slice(2);
const SMALL = args.includes('--small');
const LLM = args.includes('--llm');
const httpIdx = args.indexOf('--http');
const HTTP_URL = httpIdx >= 0 ? (args[httpIdx + 1]?.startsWith('http') ? args[httpIdx + 1] : 'http://localhost:3100/api/mcp') : null;
const KEY = process.env.AIMO_AGENT_KEY || 'aimo-demo-agent-key';
const LITRES = SMALL ? 100 : 1000;
const NEED = `I need ${LITRES.toLocaleString('en-GB')} litres of lactose-free milk by Monday. Find an option that meets our requirements based on price and availability.`;

// Plain milk only: the deterministic agent's reading of "lactose-free milk".
const NOT_PLAIN_MILK = /coffee|kahvi|sour|piimä|cocoa|kaakao|chocolate|protein|condensed|portion|annos|kefir|yog|powder|jauhe|cream|kerma|quark|rahka|oat|kaura|play|plus|gefilus|smoothie|ruoka|cooking|fermented/i;

const t0 = Date.now();
const log = (step: string, text = '') => console.log(`\x1b[2m${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s\x1b[0m  \x1b[1m${step}\x1b[0m ${text}`);
const eur = (n: number) => `€${n.toFixed(2)}`;

/** Next Monday after today (Helsinki), YYYY-MM-DD. */
function nextMonday(): string {
  const today = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Helsinki' }));
  const d = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));
  d.setUTCDate(d.getUTCDate() + (((8 - d.getUTCDay()) % 7) || 7));
  return d.toISOString().slice(0, 10);
}

function connect() {
  const server = HTTP_URL
    ? { url: new URL(HTTP_URL), requestInit: { headers: { Authorization: `Bearer ${KEY}` } } }
    : {
        command: 'npx', args: ['tsx', 'src/mcp/stdio.ts'], cwd: process.cwd(),
        env: Object.fromEntries(Object.entries({
          AIMO_AGENT_KEY: KEY, AIMO_DB_PATH: process.env.AIMO_DB_PATH, AIMO_AGENT_KEYS: process.env.AIMO_AGENT_KEYS,
          VALIO_API_KEY: process.env.VALIO_API_KEY, VALIO_API_BASE: process.env.VALIO_API_BASE,
        }).filter((e): e is [string, string] => !!e[1])),
      };
  return new MCPClient({ id: `gateway-demo-${process.pid}`, servers: { aimo: server }, timeout: 60_000 });
}

type Tools = Record<string, { execute?: (input: unknown, ctx: unknown) => Promise<unknown> }>;

/** Calls an MCP tool and returns its JSON result (structured content, or the JSON text block). */
async function call<T>(tools: Tools, name: string, input: unknown): Promise<T> {
  const out = (await tools[name].execute!(input, {})) as { content?: Array<{ type: string; text?: string }>; isError?: boolean } | T;
  const content = (out as { content?: Array<{ type: string; text?: string }> }).content;
  if (Array.isArray(content)) {
    const text = content.find((c) => c.type === 'text')?.text ?? '';
    if ((out as { isError?: boolean }).isError) throw new Error(`${name}: ${text}`);
    try { return JSON.parse(text) as T; } catch { return text as T; }
  }
  return out as T;
}

interface Hit { product: { id: string; nameEn: string; packSize: number; packUnit: string; packDescription: string } }
interface Quote {
  productId: string; name: string; packSize: number; reliability: number | null;
  pricing: { pricePerPack: number | null; comparisonPrice: number | null; comparisonUnit: string | null } | null;
  availability: { deliverableOnDate: boolean; availablePacks: number | null; cutoff: string | null; reason?: string } | null;
  allergenCheck?: { verdict: string };
}

async function deterministic(tools: Tools) {
  const deliveryDate = nextMonday();
  const requirements = { requireDiet: ['lactose_free'] };
  log('Task', NEED);
  log('Plan', `deliver by ${deliveryDate} (next Monday), requirement lactose_free, ${LITRES} l`);

  const policy = await call<{ autoApproveLimitEur: number; approver: { name: string; role: string } }>(tools, 'getAuthorityPolicy', {});
  log('getAuthorityPolicy', `limit ${eur(policy.autoApproveLimitEur)} excl. VAT, approver ${policy.approver.name} (${policy.approver.role})`);

  const { hits } = await call<{ hits: Hit[] }>(tools, 'searchProducts', { query: 'lactose free milk', requireDiet: ['lactose_free'], limit: 30 });
  const candidates = hits.filter((h) => h.product.packUnit === 'l' && /milk|maito/i.test(h.product.nameEn) && !NOT_PLAIN_MILK.test(h.product.nameEn));
  log('searchProducts', `${hits.length} lactose-free hits, ${candidates.length} plain milks sold by the litre`);

  const { quotes } = await call<{ quotes: Quote[] }>(tools, 'getPriceAndAvailability', { productIds: candidates.map((h) => h.product.id), deliveryDate, requirements });
  const scored = quotes.map((q) => {
    const packs = Math.ceil(LITRES / q.packSize - 1e-9);
    const why = !q.pricing?.pricePerPack ? 'no price'
      : q.allergenCheck?.verdict !== 'pass' ? `allergen check ${q.allergenCheck?.verdict}`
      : !q.availability?.deliverableOnDate ? (q.availability?.reason ?? 'not deliverable')
      : q.availability.availablePacks !== null && q.availability.availablePacks < packs ? `only ${q.availability.availablePacks} packs in stock`
      : null;
    return { q, packs, cost: q.pricing?.pricePerPack ? packs * q.pricing.pricePerPack : Infinity, why };
  });
  for (const s of [...scored].sort((a, b) => a.cost - b.cost)) {
    console.log(`         ${s.why ? '✗' : '✓'} ${s.q.name.padEnd(62).slice(0, 62)} ${s.q.pricing?.comparisonPrice != null ? `${s.q.pricing.comparisonPrice.toFixed(2)} €/l` : '   —   '}  ${s.why ?? `${s.packs} packs = ${eur(s.cost)}`}`);
  }
  const ok = scored.filter((s) => !s.why).sort((a, b) => a.cost - b.cost || (b.q.reliability ?? 0) - (a.q.reliability ?? 0));
  if (!ok.length) throw new Error('No product meets the requirements on that date');
  const pick = ok[0];
  log('Pick', `${pick.q.name}: cheapest that is lactose-free, deliverable ${deliveryDate} and in stock (${eur(pick.cost)} excl. VAT)`);

  let offer = await call<{ offerId: string; totals: { total: number; totalWithTax: number }; validUntil: string; cutoff: string | null; lines: Array<{ packs: number; unitPrice: number; available: boolean; reason?: string }> }>(
    tools, 'requestOffer', { deliveryDate, lines: [{ productId: pick.q.productId, quantity: LITRES, unit: 'l' }], requirements });
  log('requestOffer', `${offer.offerId}: ${offer.lines[0].packs} packs × ${eur(offer.lines[0].unitPrice)} = ${eur(offer.totals.total)} excl. VAT (${eur(offer.totals.totalWithTax)} incl.), valid until ${offer.validUntil}, cut-off ${offer.cutoff}`);

  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await call<Record<string, unknown> & { status: string }>(tools, 'placeOrder', { offerId: offer.offerId, preferences: { latestDeliveryDate: deliveryDate } });
    if (r.status === 'requote') {
      log('placeOrder', `requote: ${(r.changes as Array<{ message: string }>).map((c) => c.message).join('; ')}`);
      offer = r.newOffer as typeof offer;
      continue;
    }
    if (r.status === 'ordered') {
      const receipt = r.receipt as { orderId: string; total: number; totalWithTax: number; deliveryDate: string };
      log('placeOrder', `\x1b[32mORDERED\x1b[0m within authority: ${receipt.orderId}, ${eur(receipt.total)} excl. VAT (${eur(receipt.totalWithTax)} incl.), delivery ${receipt.deliveryDate} (simulated order)`);
    } else if (r.status === 'pending_approval') {
      const approver = r.approver as { name: string; role: string };
      log('placeOrder', `\x1b[33mPENDING APPROVAL\x1b[0m ${r.approvalId}: waiting for ${approver.name} (${approver.role})`);
      for (const reason of r.reasons as Array<{ message: string }>) console.log(`         · ${reason.message}`);
      const status = await call<{ status: string }>(tools, 'getOrderStatus', { id: r.approvalId });
      log('getOrderStatus', `${r.approvalId} → ${status.status}. Approve or reject at http://localhost:3100/approvals`);
    } else {
      log('placeOrder', JSON.stringify(r));
    }
    return;
  }
  throw new Error('Offer kept changing; giving up');
}

async function withLlm(client: MCPClient) {
  const { Agent } = await import('@mastra/core/agent');
  const { MODEL } = await import('../src/mastra/agents/model');
  const tools = await client.listTools();
  const allowed = Object.fromEntries(Object.entries(tools).filter(([name]) => !name.endsWith('chatWithAimo')));
  const playbook = await client.resources.read('aimo', 'aimo://playbook');
  const agent = new Agent({
    id: 'external-purchasing-agent', name: 'External purchasing agent',
    instructions: `You are a purchasing agent for a catering company. Today is ${new Date().toISOString().slice(0, 10)}. Use only the Aimo tools.\n\n${(playbook.contents[0] as { text?: string }).text ?? ''}\nWhen done, report in 3 short lines: product, total, and the order or approval status.`,
    model: MODEL, tools: allowed,
  });
  log('Task (Claude drives)', NEED);
  const result = await agent.generate(NEED, {
    maxSteps: 14,
    onStepFinish: (step: { toolCalls?: Array<{ payload?: { toolName?: string; args?: unknown } }> }) => {
      for (const c of step.toolCalls ?? []) log(`→ ${c.payload?.toolName}`, JSON.stringify(c.payload?.args).slice(0, 160));
    },
  });
  log('Agent', result.text);
}

async function main() {
  const client = connect();
  try {
    log('Connect', HTTP_URL ? `MCP over Streamable HTTP ${HTTP_URL}` : 'MCP over stdio (npx tsx src/mcp/stdio.ts)');
    if (LLM) await withLlm(client);
    else await deterministic((await client.listToolsets()).aimo as Tools);
  } finally {
    await client.disconnect().catch(() => {});
  }
  log('Done', `${((Date.now() - t0) / 1000).toFixed(1)} s`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
