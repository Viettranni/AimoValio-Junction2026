import { integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const customers = sqliteTable('customers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
});

export const drafts = sqliteTable('drafts', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  json: text('json').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const orders = sqliteTable('orders', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull(),
  eventName: text('event_name').notNull(),
  eventType: text('event_type').notNull(),
  eventDate: text('event_date').notNull(),
  deliveryDate: text('delivery_date').notNull(),
  guests: integer('guests').notNull(),
  total: real('total').notNull(),
  totalWithTax: real('total_with_tax').notNull(),
  receiptJson: text('receipt_json').notNull(),
  submittedAt: text('submitted_at').notNull(),
  checkInDone: integer('check_in_done', { mode: 'boolean' }).notNull().default(false),
});

export const orderLines = sqliteTable('order_lines', {
  id: text('id').notNull(),
  orderId: text('order_id').notNull(),
  productId: text('product_id').notNull(),
  productName: text('product_name').notNull(),
  category: text('category').notNull(),
  packs: integer('packs').notNull(),
  quantity: real('quantity').notNull(),
  unit: text('unit').notNull(),
  unitPrice: real('unit_price').notNull(),
}, (t) => [primaryKey({ columns: [t.orderId, t.id] })]);

export const leftovers = sqliteTable('leftovers', {
  orderId: text('order_id').notNull(),
  lineId: text('line_id').notNull(),
  productId: text('product_id').notNull(),
  category: text('category').notNull(),
  eventType: text('event_type').notNull(),
  eventName: text('event_name').notNull(),
  eventDate: text('event_date').notNull(),
  orderedQty: real('ordered_qty').notNull(),
  leftoverQty: real('leftover_qty').notNull(),
  unit: text('unit').notNull(),
  recordedAt: text('recorded_at').notNull(),
}, (t) => [primaryKey({ columns: [t.orderId, t.lineId] })]);

export const auditLog = sqliteTable('audit_log', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id').notNull(),
  orderId: text('order_id'),
  at: text('at').notNull(),
  actor: text('actor').notNull(),
  action: text('action').notNull(),
  summary: text('summary').notNull(),
  dataJson: text('data_json'),
});

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

// ── Agent gateway ──

export const gatewayOffers = sqliteTable('gateway_offers', {
  id: text('id').primaryKey(),
  customerId: text('customer_id').notNull(),
  agentId: text('agent_id').notNull(),
  status: text('status').notNull(),
  json: text('json').notNull(),
  createdAt: text('created_at').notNull(),
  validUntil: text('valid_until').notNull(),
});

export const gatewayApprovals = sqliteTable('gateway_approvals', {
  id: text('id').primaryKey(),
  offerId: text('offer_id').notNull(),
  customerId: text('customer_id').notNull(),
  agentId: text('agent_id').notNull(),
  status: text('status').notNull(),
  json: text('json').notNull(),
  createdAt: text('created_at').notNull(),
  decidedAt: text('decided_at'),
});

export const gatewayChats = sqliteTable('gateway_chats', {
  conversationId: text('conversation_id').primaryKey(),
  customerId: text('customer_id').notNull(),
  agentId: text('agent_id').notNull(),
  messagesJson: text('messages_json').notNull(),
  updatedAt: text('updated_at').notNull(),
});

/** Per-line delivered quantities, written once when the simulated delivery reaches "delivered". */
export const deliveries = sqliteTable('deliveries', {
  orderId: text('order_id').notNull(),
  lineId: text('line_id').notNull(),
  orderedQty: real('ordered_qty').notNull(),
  deliveredQty: real('delivered_qty').notNull(),
  unit: text('unit').notNull(),
  reason: text('reason'),
  deliveredAt: text('delivered_at').notNull(),
}, (t) => [primaryKey({ columns: [t.orderId, t.lineId] })]);
