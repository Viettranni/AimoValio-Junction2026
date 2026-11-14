import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getAvailability, getPrices } from '@/valio/client';
import { MODEL, cachedSystem, effort } from './model';

const lookupInput = z.object({
  productIds: z.array(z.string()).min(1).max(1000),
  date: z.string().describe('Delivery date YYYY-MM-DD'),
});

export const getPricesTool = createTool({
  id: 'getPrices',
  description: 'Valio Aimo prices per sales unit (excl. and incl. VAT) and comparison price per kg/l for a delivery date.',
  inputSchema: lookupInput,
  execute: async ({ productIds, date }) => ({ prices: [...(await getPrices(productIds, date)).values()] }),
});

export const getAvailabilityTool = createTool({
  id: 'getAvailability',
  description: 'Valio Aimo availability for a delivery date: deliverable, sales block, Stock vs Terminal, available amount and order cut-off.',
  inputSchema: lookupInput,
  execute: async ({ productIds, date }) => ({ availability: [...(await getAvailability(productIds, date)).values()] }),
});

export const pricingAgent = new Agent({
  id: 'pricing',
  name: 'Pricing & stock',
  description: 'Live price, availability, cut-off and delivery reliability for the delivery date; triggers substitutions.',
  instructions: cachedSystem(`You price catering order lines with live Valio Aimo data and check stock for the delivery date.
Prices and stock figures come only from the getPrices and getAvailability tools; never estimate them.
Products sold by KG are priced per kg: one pack costs price × pack weight.
A product that is not deliverable or has a sales block must be substituted by a deliverable alternative; Terminal products are supplier-delivered with stock not guaranteed; reliability below 0.9 may deliver short.
Explain any substitution in one short English sentence.`),
  model: MODEL,
  tools: { getPrices: getPricesTool, getAvailability: getAvailabilityTool },
  defaultOptions: effort('low'),
});
