import { Mastra } from '@mastra/core/mastra';
import { allergenAgent } from './agents/allergen';
import { historyAgent } from './agents/history';
import { intakeAgent } from './agents/intake';
import { menuAgent } from './agents/menu';
import { orchestratorAgent } from './agents/orchestrator';
import { orderAgent } from './agents/order';
import { pricingAgent } from './agents/pricing';
import { productAgent } from './agents/product';

export const mastra = new Mastra({
  agents: {
    orchestrator: orchestratorAgent,
    intake: intakeAgent,
    menu: menuAgent,
    product: productAgent,
    allergen: allergenAgent,
    pricing: pricingAgent,
    history: historyAgent,
    order: orderAgent,
  },
});
