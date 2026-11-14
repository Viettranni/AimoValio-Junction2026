// Inquiry → commitment: a binding quote at fixed catalogue prices.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { requestOffer } from '@/gateway/offers';
import { agentFor } from '../identity';
import { isoDate, requirementsSchema } from './requirements';

export const requestOfferTool = createTool({
  id: 'requestOffer',
  description:
    'Turn a shopping list into a binding offer at fixed Valio catalogue prices for one delivery date. Quantities round up to whole packs ' +
    '(unit "packs" = sales units, or "kg" / "l" / "pcs" = net amount). Lines that cannot be delivered in full stay in the offer with available:false, ' +
    'a reason and same-kind alternatives (never swapped in for you; request a new offer with substituteFor set to use one). ' +
    'The offer holds its prices until validUntil (15 min, never past the order cut-off). There is no price input: prices are not negotiable.',
  inputSchema: z.object({
    deliveryDate: isoDate,
    lines: z.array(z.object({
      productId: z.string(),
      quantity: z.number().positive(),
      unit: z.enum(['packs', 'kg', 'l', 'pcs']).optional().describe('Default "packs"'),
      substituteFor: z.string().optional().describe('Product id this line replaces (e.g. a suggested alternative)'),
    })).min(1).max(100),
    requirements: requirementsSchema.optional(),
  }),
  mcp: { annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true } },
  execute: async (input, context) => requestOffer(input, { agent: agentFor(context) }),
});

export const offerTools = [requestOfferTool];
