// Persistence for offers, approvals and MCP chat transcripts (SQLite via src/db).
import { randomBytes } from 'node:crypto';
import type BetterSqlite from 'better-sqlite3';
import { and, desc, eq } from 'drizzle-orm';
import { GATEWAY_DDL, getDb, type Db } from '@/db/client';
import { gatewayApprovals, gatewayChats, gatewayOffers } from '@/db/schema';
import type { Approval, ApprovalStatus, Offer } from './types';

const prepared = new WeakSet<Db>();

/** The gateway tables, created on first use too (a long-running dev server may predate them). */
export function gatewayDb(db: Db = getDb()): Db {
  // Transactions have no $client; their outer connection was prepared before the transaction started.
  const client = (db as unknown as { $client?: BetterSqlite.Database }).$client;
  if (client && !prepared.has(db)) {
    client.exec(GATEWAY_DDL);
    prepared.add(db);
  }
  return db;
}

export const newId = (prefix: string) => `${prefix}-${randomBytes(4).toString('hex').toUpperCase()}`;

export function saveOffer(o: Offer, db?: Db): void {
  const row = { id: o.offerId, customerId: o.customerId, agentId: o.agentId, status: o.status, json: JSON.stringify(o), createdAt: o.createdAt, validUntil: o.validUntil };
  gatewayDb(db).insert(gatewayOffers).values(row).onConflictDoUpdate({ target: gatewayOffers.id, set: row }).run();
}

export function getOffer(offerId: string, db?: Db): Offer | null {
  const row = gatewayDb(db).select().from(gatewayOffers).where(eq(gatewayOffers.id, offerId)).get();
  return row ? (JSON.parse(row.json) as Offer) : null;
}

/** All offers of a customer (newest first), for the split-order guard and listings. */
export function listOffers(customerId: string, db?: Db): Offer[] {
  return gatewayDb(db).select().from(gatewayOffers).where(eq(gatewayOffers.customerId, customerId))
    .orderBy(desc(gatewayOffers.createdAt)).all().map((r) => JSON.parse(r.json) as Offer);
}

/** The offer of this draft that waits for a human approver, if any: the draft must not change meanwhile. */
export function pendingOfferFor(draft: { id: string; customerId: string }, db?: Db): Offer | undefined {
  return listOffers(draft.customerId, db).find((o) => o.draftId === draft.id && o.status === 'pending_approval');
}

export function saveApproval(a: Approval, db?: Db): void {
  const row = {
    id: a.approvalId, offerId: a.offerId, customerId: a.customerId, agentId: a.agentId, status: a.status,
    json: JSON.stringify(a), createdAt: a.createdAt, decidedAt: a.decidedAt ?? null,
  };
  gatewayDb(db).insert(gatewayApprovals).values(row).onConflictDoUpdate({ target: gatewayApprovals.id, set: row }).run();
}

export function getApproval(approvalId: string, db?: Db): Approval | null {
  const row = gatewayDb(db).select().from(gatewayApprovals).where(eq(gatewayApprovals.id, approvalId)).get();
  return row ? (JSON.parse(row.json) as Approval) : null;
}

export function listApprovalRows(filter: { status?: ApprovalStatus; customerId?: string } = {}, db?: Db): Approval[] {
  const conds = [];
  if (filter.status) conds.push(eq(gatewayApprovals.status, filter.status));
  if (filter.customerId) conds.push(eq(gatewayApprovals.customerId, filter.customerId));
  return gatewayDb(db).select().from(gatewayApprovals).where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(gatewayApprovals.createdAt)).limit(100).all()
    .map((r) => JSON.parse(r.json) as Approval);
}

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

export function getChat(conversationId: string, db?: Db): { customerId: string; agentId: string; messages: ChatMessage[] } | null {
  const row = gatewayDb(db).select().from(gatewayChats).where(eq(gatewayChats.conversationId, conversationId)).get();
  return row ? { customerId: row.customerId, agentId: row.agentId, messages: JSON.parse(row.messagesJson) as ChatMessage[] } : null;
}

export function saveChat(conversationId: string, chat: { customerId: string; agentId: string; messages: ChatMessage[] }, updatedAt: string, db?: Db): void {
  const row = { conversationId, customerId: chat.customerId, agentId: chat.agentId, messagesJson: JSON.stringify(chat.messages), updatedAt };
  gatewayDb(db).insert(gatewayChats).values(row).onConflictDoUpdate({ target: gatewayChats.conversationId, set: row }).run();
}
