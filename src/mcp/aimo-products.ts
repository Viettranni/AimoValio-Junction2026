// The catalogue-only MCP server (the original aimo-products). The full agent gateway is src/mcp/server.ts;
// these tools are defined in src/mcp/tools/catalog.ts and are part of it.
import { MCPServer } from '@mastra/mcp';
import {
  checkAllergensTool, getAlternativesTool, getIngredientsTool, getProductTool, searchProductsTool,
} from './tools/catalog';

export { checkAllergensTool, getAlternativesTool, getIngredientsTool, getProductTool, searchProductsTool };

export const aimoProductTools = {
  searchProducts: searchProductsTool,
  getProduct: getProductTool,
  getAlternatives: getAlternativesTool,
  getIngredients: getIngredientsTool,
  checkAllergens: checkAllergensTool,
};

export const aimoProductsServer = new MCPServer({
  id: 'aimo-products',
  name: 'aimo-products',
  version: '1.0.0',
  description: 'Valio Aimo catalogue: product search, details, alternatives, ingredients and allergen checks.',
  tools: aimoProductTools,
});
