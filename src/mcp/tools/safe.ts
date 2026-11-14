// Every MCP tool runs through safe(): expected errors keep their message; anything else is logged
// server-side and the caller gets a generic message (no stack traces or internals over MCP).
import { AuthError } from '@/gateway/agents';
import { GatewayError } from '@/gateway/offers';
import { ValioUnavailableError } from '@/valio/client';

export class ToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ToolError';
  }
}

export function safe<I, C, O>(tool: string, fn: (input: I, context: C) => Promise<O>): (input: I, context: C) => Promise<O> {
  return async (input, context) => {
    try {
      return await fn(input, context);
    } catch (err) {
      if (err instanceof GatewayError || err instanceof AuthError || err instanceof ToolError) throw new ToolError(err.message);
      if (err instanceof ValioUnavailableError) throw new ToolError('Valio prices and stock can’t be reached right now. Nothing was changed; try again in a moment.');
      console.error(`[aimo-gateway] ${tool} failed`, err);
      throw new ToolError(`${tool} failed because of an internal error in the Aimo gateway. Try again; if it keeps failing, contact Valio Aimo.`);
    }
  };
}
