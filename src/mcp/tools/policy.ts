// The customer's authority policy, as data: what the agent may order alone, who signs off the rest.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { describePolicy } from '@/gateway/policy';
import { agentFor } from '../identity';

export const getAuthorityPolicyTool = createTool({
  id: 'getAuthorityPolicy',
  description: "Your customer's authority policy: auto-approve limit (EUR excl. VAT), approver, rules that need a human sign-off, offer validity. Also at resource aimo://policy.",
  inputSchema: z.object({}),
  mcp: { annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false } },
  execute: async (_input, context) => {
    const agent = agentFor(context);
    return { agent: { agentId: agent.agentId, displayName: agent.displayName }, ...describePolicy(agent.customerId) };
  },
});

export const policyTools = [getAuthorityPolicyTool];
