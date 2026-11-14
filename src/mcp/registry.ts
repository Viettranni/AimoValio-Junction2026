// One place that assembles every MCP tool, by group. Used by the MCP server and by the docs.
import { catalogTools } from './tools/catalog';
import { chatTools } from './tools/chat';
import { draftTools } from './tools/drafts';
import { offerTools } from './tools/offers';
import { orderTools } from './tools/orders';
import { policyTools } from './tools/policy';
import { pricingTools } from './tools/pricing';
import { safe } from './tools/safe';

export const TOOL_GROUPS = [
  { group: 'catalog', label: 'Catalogue: search, details, alternatives, ingredients, allergen checks', tools: catalogTools },
  { group: 'pricing', label: 'Live price and availability for a delivery date', tools: pricingTools },
  { group: 'offers', label: 'Inquiry → binding offer at fixed catalogue prices', tools: offerTools },
  { group: 'drafts', label: 'Event planning like the widget: plan, edit, check out', tools: draftTools },
  { group: 'orders', label: 'Place within authority or route to a human; status, orders, leftovers', tools: orderTools },
  { group: 'policy', label: "The customer's authority policy", tools: policyTools },
  { group: 'assistant', label: 'Chat with the Aimo planning assistant', tools: chatTools },
] as const;

export type ToolGroup = (typeof TOOL_GROUPS)[number]['group'];

type AnyTool = (typeof TOOL_GROUPS)[number]['tools'][number];
const wrapped = new WeakSet<object>();

/** Every tool's execute goes through safe(): gateway errors keep their message, internals never leak. */
function guarded(t: AnyTool): AnyTool {
  if (!wrapped.has(t) && t.execute) {
    const run = t.execute.bind(t) as (i: unknown, c: unknown) => Promise<unknown>;
    (t as { execute: unknown }).execute = safe(t.id, run);
    wrapped.add(t);
  }
  return t;
}

/** name → tool, for MCPServer. Names are the tool ids. */
export function registryTools() {
  const out: Record<string, AnyTool> = {};
  for (const g of TOOL_GROUPS) {
    for (const t of g.tools) {
      if (out[t.id]) throw new Error(`Duplicate MCP tool ${t.id}`);
      out[t.id] = guarded(t);
    }
  }
  return out;
}

/** name → group, for docs and listings. */
export function toolIndex(): Array<{ name: string; group: ToolGroup; description: string }> {
  return TOOL_GROUPS.flatMap((g) => g.tools.map((t) => ({ name: t.id, group: g.group, description: t.description ?? '' })));
}
