// Live smoke test of the orchestrator: npx tsx --env-file=.env.local scripts/agent-smoke.ts
// Plays a short wedding conversation, prints every tool call and data part, then the draft totals.
// Writes a draft and audit rows for a fresh "smoke-…" conversation into the local database.
import { RequestContext } from '@mastra/core/request-context';
import { getDraftByConversation } from '@/db/repo';
import { mastra } from '@/mastra';

const CUSTOMER = 'helsinki-juhlapalvelu';
const TURNS = [
  'We have a wedding on 6 December, 300 guests, chicken and rice. Budget about 4000 euros. 12 guests are gluten-free.',
  'No add-ons, thanks. Please plan it.',
  'Yes, go ahead and build the draft.',
];

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY is not set. Add it to .env.local and run: npx tsx --env-file=.env.local scripts/agent-smoke.ts');
    process.exit(1);
  }
  const conversationId = `smoke-${Date.now()}`;
  const requestContext = new RequestContext();
  requestContext.set('conversationId', conversationId);
  requestContext.set('customerId', CUSTOMER);
  const agent = mastra.getAgent('orchestrator');
  const messages: Array<{ role: 'user'; content: string } | { role: 'assistant'; content: string }> = [];
  const toolSequence: string[] = [];

  for (const turn of TURNS) {
    if (getDraftByConversation(conversationId)?.status === 'ready') break;
    console.log(`\n> ${turn}`);
    messages.push({ role: 'user', content: turn });
    const started = Date.now();
    const stream = await agent.stream(messages, { requestContext });
    let text = '';
    for await (const chunk of stream.fullStream) {
      const c = chunk as { type: string; payload?: { toolName?: string; args?: unknown; textDelta?: string; text?: string }; data?: unknown };
      if (c.type === 'tool-call') {
        toolSequence.push(c.payload?.toolName ?? '?');
        console.log(`  [tool] ${c.payload?.toolName} ${JSON.stringify(c.payload?.args)}`);
      } else if (c.type === 'tool-result') {
        console.log(`  [result] ${c.payload?.toolName} ${JSON.stringify((c.payload as { result?: unknown })?.result).slice(0, 400)}`);
      } else if (c.type === 'tool-error') {
        console.log(`  [error] ${c.payload?.toolName} ${JSON.stringify(c.payload).slice(0, 400)}`);
      } else if (c.type.startsWith('data-')) {
        const d = c.data as { step?: string; status?: string; count?: number };
        console.log(`  [${c.type}] ${c.type === 'data-progress' ? `${d.step} ${d.status}${d.count !== undefined ? ` (${d.count})` : ''}` : ''}`);
      } else if (c.type === 'text-delta') {
        text += c.payload?.text ?? c.payload?.textDelta ?? '';
      }
    }
    console.log(`< ${text.trim()}  (${((Date.now() - started) / 1000).toFixed(1)} s)`);
    messages.push({ role: 'assistant', content: text });
  }

  console.log(`\nTool sequence: ${toolSequence.join(' → ')}`);
  const draft = getDraftByConversation(conversationId);
  if (!draft || draft.status !== 'ready') {
    console.error(`No ready draft (status: ${draft?.status ?? 'none'}).`);
    process.exit(1);
  }
  const t = draft.totals;
  console.log(`Draft: ${draft.lines.length} lines, €${t.low.toFixed(2)}–€${t.high.toFixed(2)} excl. VAT (€${t.lowWithTax.toFixed(2)}–€${t.highWithTax.toFixed(2)} incl.), over budget: ${t.overBudget}, cut-off: ${draft.cutoff}`);
  for (const l of draft.lines) {
    console.log(`  ${l.id} ${l.productName} · ${l.packs} × ${l.packDescription} · ${l.unitPrice ?? '—'} €/pack · ${l.tags.join(', ')}${l.history ? ` · history ${l.history.historyPacks}/${l.history.suggestedPacks}` : ''}`);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
