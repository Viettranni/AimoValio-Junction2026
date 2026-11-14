// The agent gateway: the service layer behind the MCP tools (src/mcp/tools/*) and the approval page.
export { AuthError, DEMO_AGENT_KEY, PRESET_CONNECT_KEY, agentKeys, bearerToken, connectKey, requestKey, resolveAgent } from './agents';
export { decideApproval, listApprovals, type DecisionResult } from './approvals';
export { getPriceAndAvailability, getProductDetails, searchCatalog, type ProductQuote } from './lookup';
export { GatewayError, getOwnOffer, requestOffer } from './offers';
export { getOrderStatus, placeOrder } from './orders';
export { POLICIES, POLICY_RULES, policyFor, type AuthorityPolicy } from './policies';
export { describePolicy, evaluatePolicy } from './policy';
export type * from './types';
