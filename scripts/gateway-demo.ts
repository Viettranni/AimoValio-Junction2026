// Headless demo of the Valio Aimo brief: an EXTERNAL purchasing agent that only talks MCP to the Aimo gateway.
//
//   "I need 1,000 litres of lactose-free milk by Monday. Find an option that meets our requirements
//    based on price and availability."
//
//   npx tsx --env-file-if-exists=.env.local scripts/gateway-demo.ts            # 1,000 l → over the limit → pending approval
//   npx tsx --env-file-if-exists=.env.local scripts/gateway-demo.ts --small    # 100 l → within authority → ordered
//   ... --http [url]   use the remote endpoint (default http://localhost:3100/api/mcp) instead of spawning stdio
//   ... --over         if 1,000 l happens to fit the agent's limit at today's prices, size the order just over it instead
//   ... --event        the widget's event flow over MCP: wedding, 300 guests, chicken & rice, 12 gluten-free →
//                      planEvent → updateDraft → checkoutDraft → listOrders (takes ~30–60 s: menu and product planning use Claude)
//   ... --llm          let Claude drive the same tools (needs ANTHROPIC_API_KEY or AIMO_MODEL + its key)
//
// AIMO_BASE_URL (default http://localhost:3100) is the app for --http and the approval page link.
//
// The deterministic agent below needs no language model: search → price/availability → pick → offer → order.
import { MCPClient } from '@mastra/mcp';

const args = process.argv.slice(2);
const SMALL = args.includes('--small');
const LLM = args.includes('--llm');
const httpIdx = args.indexOf('--http');
const OVER = args.includes('--over');
const EVENT = args.includes('--event');
const BASE_URL = (process.env.AIMO_BASE_URL || 'http://localhost:3100').replace(/\/$/, '');
const HTTP_URL = httpIdx >= 0 ? (args[httpIdx + 1]?.startsWith('http') ? args[httpIdx + 1] : `${BASE_URL}/api/mcp`) : null;
const KEY = process.env.AIMO_AGENT_KEY || 'aimo-demo-agent-key';
let LITRES = SMALL ? 100 : 1000;
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
          AIMO_AGENT_KEY: KEY, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY, AIMO_MODEL: process.env.AIMO_MODEL, AIMO_DB_PATH: process.env.AIMO_DB_PATH, AIMO_AGENT_KEYS: process.env.AIMO_AGENT_KEYS,
          VALIO_API_KEY: process.env.VALIO_API_KEY, VALIO_API_BASE: process.env.VALIO_API_BASE,
        }).filter((e): e is [string, string] => !!e[1])),
      };
  return new MCPClient({ id: `gateway-demo-${process.pid}`, servers: { aimo: server }, timeout: 180_000 });
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
  if (!SMALL && pick.cost <= policy.autoApproveLimitEur) {
    if (OVER) {
      const perLitre = pick.cost / LITRES;
      LITRES = Math.ceil((policy.autoApproveLimitEur * 1.05) / perLitre / pick.q.packSize) * pick.q.packSize;
      pick.packs = Math.ceil(LITRES / pick.q.packSize - 1e-9);
      pick.cost = pick.packs * pick.q.pricing!.pricePerPack!;
      log('Note', `--over: ${LITRES} l (${eur(pick.cost)}) so the order exceeds the ${eur(policy.autoApproveLimitEur)} limit`);
    } else {
      log('Note', `At today's prices 1,000 l costs ${eur(pick.cost)}, within the ${eur(policy.autoApproveLimitEur)} limit, so it will order without sign-off. Use --over to see the approval path.`);
    }
  }
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
      log('getOrderStatus', `${r.approvalId} → ${status.status}. Approve or reject at ${BASE_URL}/approvals`);
    } else {
      log('placeOrder', JSON.stringify(r));
    }
    return;
  }
  throw new Error('Offer kept changing; giving up');
}

/** Next Saturday at least two weeks out (Helsinki), YYYY-MM-DD. */
function weddingDate(): string {
  const d = new Date(Date.now() + 14 * 86_400_000);
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7));
  return d.toISOString().slice(0, 10);
}

interface DraftOut {
  draftId: string; exceptions?: string[];
  lines: Array<{ lineId: string; productName: string; packs: number; packDescription: string; unitPrice: number | null; tags: string[]; history?: { suggestedPacks: number; historyPacks: number; choice: string } }>;
  totals: { low: number; high: number };
}

async function eventFlow(tools: Tools) {
  const deliveryDate = weddingDate();
  const input = { deliveryDate, guests: 300, menu: ['chicken', 'rice'], diets: [{ diet: 'gluten_free', guests: 12 }], eventType: 'wedding', eventName: 'Wedding', budget: 'none', lang: 'en' };
  log('Task', `Wedding on ${deliveryDate}, 300 guests, chicken and rice, 12 gluten-free (the widget's flow, over MCP only)`);
  const show = (d: DraftOut) => {
    for (const l of d.lines) {
      const note = l.history ? `  history: ${l.history.historyPacks} instead of ${l.history.suggestedPacks} packs (${l.history.choice})` : '';
      console.log(`         ${l.lineId.padEnd(5)} ${l.productName.slice(0, 50).padEnd(50)} ${String(l.packs).padStart(4)} × ${l.packDescription.slice(0, 22).padEnd(22)} ${l.unitPrice === null ? '   —' : eur(l.unitPrice)}  ${l.tags.join(', ')}${note}`);
    }
  };
  const planned = await call<DraftOut>(tools, 'planEvent', input);
  log('planEvent', `draft ${planned.draftId}: ${planned.lines.length} lines, ${eur(planned.totals.low)}–${eur(planned.totals.high)} excl. VAT`);
  show(planned);
  for (const e of planned.exceptions ?? []) console.log(`         ! ${e}`);

  const changes: object[] = [];
  const noted = planned.lines.find((l) => l.history?.choice === 'pending');
  if (noted) changes.push({ kind: 'historyChoice', lineId: noted.lineId, choice: 'history' });
  const bump = planned.lines.find((l) => l !== noted && !l.tags.includes('unavailable'));
  if (bump) changes.push({ kind: 'setPacks', lineId: bump.lineId, packs: bump.packs + 1 });
  const updated = await call<DraftOut & { diff: { changedLineIds: string[] } }>(tools, 'updateDraft', { draftId: planned.draftId, changes });
  log('updateDraft', `${noted ? `accepted the history note on ${noted.lineId} (${noted.history!.historyPacks} packs), ` : 'no history note to accept, '}` +
    `${bump ? `${bump.lineId} +1 pack` : ''} → ${eur(updated.totals.low)} excl. VAT`);

  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await call<Record<string, unknown> & { status: string }>(tools, 'checkoutDraft', { draftId: planned.draftId });
    if (r.status === 'requote') {
      log('checkoutDraft', `requote: ${(r.changes as Array<{ message: string }>).map((c) => c.message).join('; ')}`);
      continue;
    }
    if (r.status === 'ordered') {
      const receipt = r.receipt as { orderId: string; total: number; totalWithTax: number };
      log('checkoutDraft', `\x1b[32mORDERED\x1b[0m ${receipt.orderId}: ${eur(receipt.total)} excl. VAT (${eur(receipt.totalWithTax)} incl.), simulated order`);
    } else if (r.status === 'pending_approval') {
      const approver = r.approver as { name: string; role: string };
      log('checkoutDraft', `\x1b[33mPENDING APPROVAL\x1b[0m ${r.approvalId}: waiting for ${approver.name} (${approver.role})`);
      for (const reason of r.reasons as Array<{ message: string }>) console.log(`         · ${reason.message}`);
      console.log(`         → approve or reject at ${BASE_URL}/approvals, then: getOrderStatus("${r.approvalId}")`);
    } else {
      log('checkoutDraft', JSON.stringify(r).slice(0, 400));
    }
    break;
  }
  const list = await call<{ orders: Array<{ orderId: string; eventName: string; eventDate: string; total: number }>; pendingApprovals: Array<{ approvalId: string }> }>(tools, 'listOrders', { limit: 3 });
  log('listOrders', `${list.orders.slice(0, 3).map((o) => `${o.orderId} ${o.eventName} ${o.eventDate} ${eur(o.total)}`).join(' · ')}; ${list.pendingApprovals.length} pending approval(s)`);
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
    else if (EVENT) await eventFlow((await client.listToolsets()).aimo as Tools);
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
