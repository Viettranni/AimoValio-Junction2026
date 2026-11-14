// Runs the aimo-products MCP server over stdio: `npx tsx src/mcp/stdio.ts` from the project root.
// Stdout carries the protocol, so nothing else may print to it.
import { aimoProductsServer } from './aimo-products';

aimoProductsServer.startStdio().catch((err: unknown) => {
  console.error('aimo-products MCP server failed to start', err);
  process.exit(1);
});
