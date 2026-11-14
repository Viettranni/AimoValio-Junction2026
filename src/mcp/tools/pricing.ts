// Pricing and availability for a delivery date, from the live Valio API.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { getPriceAndAvailability } from '@/gateway/lookup';
import { agentFor } from '../identity';
import { isoDate, requirementsSchema } from './requirements';

export const getPriceAndAvailabilityTool = createTool({
  id: 'getPriceAndAvailability',
  description:
    'Live Valio price and availability for up to 50 products on a delivery date. Per product: price per pack excl./incl. VAT ' +
    '(products sold by the kg also per kg; pricing.basis says which Valio uses), comparison price per kg/l, whether it can be delivered on the date, ' +
    'available amount, earliest date, the order cut-off for that date, delivery reliability, CO2 per kg, allergens and diet flags. ' +
    'Prices are fixed catalogue prices: there is nothing to negotiate.',
  inputSchema: z.object({
    productIds: z.array(z.string()).min(1).max(50),
    deliveryDate: isoDate,
    requirements: requirementsSchema.optional(),
  }),
  mcp: { annotations: { readOnlyHint: true, openWorldHint: true } },
  execute: async ({ productIds, deliveryDate, requirements }, context) => {
    agentFor(context);
    return getPriceAndAvailability(productIds, deliveryDate, { requirements });
  },
});

export const pricingTools = [getPriceAndAvailabilityTool];
