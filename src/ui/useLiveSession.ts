'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AuditEntry, CheckInEvent, ChoicesEvent, Draft, DraftChange, DraftDiff, DraftEvent, Intake, IntakeSlot,
  OrderSummary, ProgressEvent, Receipt, ReceiptEvent, SlotsEvent,
} from '@/contracts';
import { describeEdit } from './editNote';
import { showShelfCard, toolRunning } from './shelf';
import { t, uiLangFor, type UiKey } from './i18n';
import type { DeliveryStatus } from '@/gateway/delivery';
import type { WidgetOffer, WidgetPlaceResult, WidgetStatus } from '@/gateway/widget';
import type { Checkout, OrderDetails, WidgetSession } from './session';
import { answerText, deriveThread, messageText, type ChoiceAnswer, type LocalItem, type ProgressRuns, type ThreadItem } from './thread';

type AimoData = {
  progress: ProgressEvent;
  choices: ChoicesEvent;
  slots: SlotsEvent;
  draft: DraftEvent;
  receipt: ReceiptEvent;
  checkin: CheckInEvent;
};
type AimoMessage = UIMessage<unknown, AimoData>;

const TYPING_DELAY_MS = 600;
/** How often a pending approval is checked. */
const APPROVAL_POLL_MS = 3000;
/** Saved transcripts are trimmed to stay well inside sessionStorage limits. */
const MAX_SAVED_MESSAGES = 60;
const MAX_SAVED_CHARS = 400_000;

function newConversationId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const storageKey = (customerId: string) => `aimo:conversation:${customerId}`;

function storedConversationId(customerId: string): string | null {
  try {
    return sessionStorage.getItem(storageKey(customerId));
  } catch {
    return null;
  }
}

function storeConversationId(customerId: string, id: string) {
  try {
    sessionStorage.setItem(storageKey(customerId), id);
  } catch {
    // Storage can be blocked inside third-party iframes; the conversation then lasts for this page view.
  }
}

interface SavedChat {
  messages: AimoMessage[];
  answers: Record<string, ChoiceAnswer>;
}

const chatKey = (conversationId: string) => `aimo:chat:${conversationId}`;

function loadChat(conversationId: string): SavedChat | null {
  try {
    const raw = sessionStorage.getItem(chatKey(conversationId));
    return raw ? (JSON.parse(raw) as SavedChat) : null;
  } catch {
    return null;
  }
}

function saveChat(conversationId: string, chat: SavedChat) {
  try {
    const raw = JSON.stringify({ ...chat, messages: chat.messages.slice(-MAX_SAVED_MESSAGES) });
    if (raw.length <= MAX_SAVED_CHARS) sessionStorage.setItem(chatKey(conversationId), raw);
  } catch {
    // Blocked or full storage only costs the transcript after a reload.
  }
}

/** The latest slots part in the transcript, so restored chats get their slot chips back. */
function lastSlots(messages: AimoMessage[]): SlotsEvent | null {
  for (const m of [...messages].reverse()) {
    const part = [...m.parts].reverse().find((p) => p.type === 'data-slots');
    if (part?.type === 'data-slots') return part.data;
  }
  return null;
}

async function api<T>(url: string, init?: { method: 'POST'; body: unknown }): Promise<T> {
  const res = await fetch(url, init && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(init.body) });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw Object.assign(new Error(json?.error ?? `Request failed (${res.status})`), { status: res.status });
  return json as T;
}

/** The conversation backed by /api/chat and the REST routes. */
export function useLiveSession({
  initialConversationId,
  customerId,
  fallbackLang,
}: {
  initialConversationId: string;
  customerId: string;
  fallbackLang: string;
}): WidgetSession {
  const [conversationId, setConversationId] = useState(() => {
    const stored = storedConversationId(customerId);
    if (stored) return stored;
    storeConversationId(customerId, initialConversationId);
    return initialConversationId;
  });

  const [intake, setIntake] = useState<Intake | null>(null);
  const [missing, setMissing] = useState<IntakeSlot[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [diff, setDiff] = useState<DraftDiff | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [progress, setProgress] = useState<ProgressRuns>({});
  const [local, setLocal] = useState<LocalItem[]>([]);
  const [answers, setAnswers] = useState<Record<string, ChoiceAnswer>>({});
  const [checkins, setCheckins] = useState<Record<string, { answer?: string; confirmed?: boolean }>>({});
  const [quietKey, setQuietKey] = useState('');
  const [pendingEdits, setPendingEdits] = useState<string[]>([]);
  const [attempt, setAttempt] = useState(0);
  const [checkout, setCheckout] = useState<Checkout>({ kind: 'idle' });
  const localId = useRef(0);
  // Draft edits run one at a time, each against the draft the previous one returned.
  const editQueue = useRef<Promise<void>>(Promise.resolve());
  const draftRef = useRef<Draft | null>(null);
  const conversationRef = useRef(conversationId);
  const commitDraft = (next: Draft | null) => {
    draftRef.current = next;
    setDraft(next);
  };

  const transport = useMemo(
    // A new conversation id also gives useChat a new chat, which picks up this transport.
    () => new DefaultChatTransport<AimoMessage>({ api: '/api/chat', body: { conversationId, customerId } }),
    [conversationId, customerId],
  );

  const userCountRef = useRef(0);
  const { messages, setMessages, sendMessage, status, error, regenerate, clearError } = useChat<AimoMessage>({
    id: conversationId,
    transport,
    onData: (part) => {
      if (part.type === 'data-progress') {
        const turn = userCountRef.current;
        setProgress((runs) => ({ ...runs, [turn]: [...(runs[turn] ?? []), part.data] }));
      } else if (part.type === 'data-slots') {
        setIntake(part.data.intake);
        setMissing(part.data.missing);
      } else if (part.type === 'data-draft') {
        commitDraft(part.data.draft);
        setDiff(part.data.diff ?? null);
      } else if (part.type === 'data-receipt') {
        setReceipt(part.data.receipt);
      }
    },
  });

  const userCount = messages.filter((m) => m.role === 'user').length;
  const messageCountRef = useRef(0);
  useEffect(() => {
    userCountRef.current = userCount;
    messageCountRef.current = messages.length;
    conversationRef.current = conversationId;
  }, [userCount, messages.length, conversationId]);
  const lang = intake?.lang;
  const uiLang = uiLangFor(lang ?? fallbackLang);
  const busy = status === 'submitted' || status === 'streaming';

  const refreshOrders = () =>
    api<OrderSummary[]>('/api/orders').then(setOrders, () => {});

  // A reload keeps the conversation id, so bring back its transcript, draft and the order list.
  useEffect(() => {
    // Restored after the first paint so the server-rendered markup and hydration agree.
    const frame = requestAnimationFrame(() => {
      const saved = loadChat(conversationId);
      if (!saved?.messages.length) return;
      setMessages(saved.messages);
      setAnswers(saved.answers ?? {});
      const slots = lastSlots(saved.messages);
      if (slots) {
        setIntake(slots.intake);
        setMissing(slots.missing);
      }
    });
    api<Draft | null>(`/api/draft?conversationId=${encodeURIComponent(conversationId)}`)
      .then((d) => d && commitDraft(d), () => {});
    api<OrderSummary[]>('/api/orders').then(setOrders, () => {});
    return () => cancelAnimationFrame(frame);
    // setMessages is stable per chat; the restore runs once per conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, customerId]);

  useEffect(() => {
    if (status === 'ready' && messages.length) saveChat(conversationId, { messages, answers });
  }, [status, messages, answers, conversationId]);

  // The shelf card waits until the turn has been quiet for 600 ms: every attempt (a retry of the same turn
  // too) and every new progress event restarts the wait.
  const run = progress[userCount] ?? [];
  const turnKey = `${userCount}:${attempt}:${run.length}`;
  useEffect(() => {
    if (!busy) return;
    const id = setTimeout(() => setQuietKey(turnKey), TYPING_DELAY_MS);
    return () => clearTimeout(id);
  }, [busy, turnKey]);

  const notify = (make: (id: string) => ThreadItem) => {
    const item = make(`local-${++localId.current}`);
    setLocal((list) => [...list, { afterCount: messageCountRef.current, item }]);
  };
  const say = (key: UiKey, vars?: Record<string, string | number>) =>
    notify((id) => ({ id, kind: 'assistant', text: t(key, uiLang, vars) }));
  const fail = (key: UiKey) => notify((id) => ({ id, kind: 'error', text: t(key, uiLang) }));

  // ───── Thread ─────

  const items = deriveThread({
    messages, progress, local, answers, checkins,
    errorText: error ? t('chat.error', uiLang) : undefined,
  });

  const last = messages.at(-1);
  const replyText = last?.role === 'assistant' ? messageText(last) : '';
  const typing = busy && quietKey === turnKey && showShelfCard({ events: run, replyText });
  const planning = busy && run.length > 0 && !draft;
  const chatEditing = busy && last?.role === 'assistant' && toolRunning(last.parts, 'editDraft');
  const editing = chatEditing ? [] : pendingEdits.length ? pendingEdits : null;

  // ───── Actions ─────

  const send = (text: string) => {
    if (busy) return;
    if (error) clearError();
    void sendMessage({ text });
  };

  const choose = (itemId: string, ids: string[], freeText?: string) => {
    const item = items.find((i) => i.id === itemId);
    if (item?.kind !== 'choices' || item.answer || busy) return;
    const answer = { ids, freeText: freeText?.trim() || undefined };
    const text = answerText(item.event, answer);
    if (!text) return;
    setAnswers((a) => ({ ...a, [item.event.id]: answer }));
    send(text);
  };

  const change = (c: DraftChange) => {
    if (!draft || draft.status === 'submitted' || busy) return;
    const forConversation = conversationId;
    const touched = 'lineId' in c ? c.lineId : '';
    setPendingEdits((list) => [...list, touched]);
    editQueue.current = editQueue.current.then(async () => {
      try {
        const res = await api<{ draft: Draft; diff: DraftDiff }>('/api/draft', { method: 'POST', body: { conversationId: forConversation, change: c } });
        // A reset while this edit was in flight makes its answer stale.
        if (conversationRef.current !== forConversation) return;
        const before = draftRef.current;
        commitDraft(res.draft);
        setDiff(res.diff);
        // Clicks on the sheet are echoed in chat as a local note; the model does not see it.
        const note = before && describeEdit(before, res.draft, res.diff, uiLang);
        if (note) notify((id) => ({ id, kind: 'assistant', text: note }));
      } catch {
        if (conversationRef.current === forConversation) fail('chat.editFailed');
      } finally {
        setPendingEdits((list) => {
          const i = list.indexOf(touched);
          return i < 0 ? list : [...list.slice(0, i), ...list.slice(i + 1)];
        });
      }
    });
  };

  // ───── Checkout: Review = a gateway offer, Approve = the gateway's placeOrder ─────

  const ordered = (sent: Receipt, approvedBy?: string) => {
    setReceipt(sent);
    if (draftRef.current) commitDraft({ ...draftRef.current, status: 'submitted' });
    setCheckout({ kind: 'idle' });
    // The chat's words after checkout come from the gateway's answer, never from the model.
    if (approvedBy) say('notice.approved', { name: approvedBy, id: sent.orderId });
    else say('notice.sent', { id: sent.orderId });
    void refreshOrders();
  };

  const skewOf = (now: string) => Date.parse(now) - Date.now();

  const requestOffer = () => {
    const forConversation = conversationId;
    if (checkout.kind !== 'pending') setCheckout({ kind: 'quoting' });
    api<WidgetOffer>('/api/order/offer', { method: 'POST', body: { conversationId } }).then(
      (r) => {
        if (conversationRef.current !== forConversation) return;
        if (r.status === 'offer') {
          if (r.changes.length) commitDraft(r.draft);
          setCheckout({ kind: 'offer', offer: r.offer, changes: r.changes, limitEur: r.limitEur, skewMs: skewOf(r.now) });
        } else if (r.status === 'pending_approval') {
          setCheckout({ kind: 'pending', offerId: r.offerId, approvalId: r.approvalId, approver: r.approver, reasons: r.reasons, total: r.total, limitEur: r.limitEur });
        } else {
          setReceipt(r.receipt);
          if (draftRef.current) commitDraft({ ...draftRef.current, status: 'submitted' });
          setCheckout({ kind: 'idle' });
        }
      },
      () => conversationRef.current === forConversation && setCheckout({ kind: 'error' }),
    );
  };

  const placeOrder = (allergenLineIds: string[]) => {
    if (checkout.kind !== 'offer' || checkout.placing) return;
    const current = checkout;
    setCheckout({ ...current, placing: true });
    api<WidgetPlaceResult>('/api/order/place', { method: 'POST', body: { conversationId, offerId: current.offer.offerId, allergenLineIds } }).then(
      (r) => {
        if (r.status === 'ordered') return ordered(r.receipt);
        if (r.status === 'pending_approval') {
          setCheckout({ kind: 'pending', offerId: r.offerId, approvalId: r.approvalId, approver: r.approver, reasons: r.reasons, total: r.total, limitEur: r.limitEur });
          say('notice.pending', { name: r.approver.name });
        } else if (r.status === 'requote') {
          setCheckout({ kind: 'offer', offer: r.newOffer, changes: r.changes, limitEur: r.limitEur, skewMs: skewOf(r.now), requoted: true });
        } else if (r.status === 'not_orderable') {
          setCheckout({ kind: 'not_orderable', reasons: r.reasons });
        } else {
          setCheckout({ kind: 'rejected', message: r.message });
        }
      },
      () => setCheckout({ ...current, placing: false }),
    );
  };

  // A pending approval is polled until it settles; the approver decides on /approvals.
  const pendingId = checkout.kind === 'pending' ? checkout.approvalId : null;
  const approverName = checkout.kind === 'pending' ? checkout.approver.name : '';
  const settleRef = useRef<(s: WidgetStatus) => void>(() => {});
  useEffect(() => {
    settleRef.current = (s: WidgetStatus) => {
      if (s.status === 'ordered') ordered(s.receipt, approverName);
      else if (s.status === 'rejected') {
        setCheckout({ kind: 'rejected', decidedBy: s.decidedBy ?? approverName, note: s.note });
        say('notice.rejected', { name: s.decidedBy ?? approverName });
      } else if (s.status === 'requote') {
        // Approved, but Valio's prices or stock moved meanwhile: the gateway re-quoted; show the new offer.
        requestOffer();
      }
    };
  });
  useEffect(() => {
    if (!pendingId) return;
    let stopped = false;
    const tick = () => api<WidgetStatus>(`/api/order/status?id=${encodeURIComponent(pendingId)}`).then(
      (s) => { if (!stopped && s.status !== 'pending_approval' && s.status !== 'unknown') { stopped = true; settleRef.current(s); } },
      () => {},
    );
    const id = setInterval(tick, APPROVAL_POLL_MS);
    return () => { stopped = true; clearInterval(id); };
  }, [pendingId]);

  const clearCheckout = () => setCheckout({ kind: 'idle' });

  const getDelivery = (orderId: string) =>
    api<DeliveryStatus>(`/api/orders/${encodeURIComponent(orderId)}/delivery`).catch(() => null);

  const nextDeliveryStep = () =>
    api<{ orderId: string; delivery: DeliveryStatus }>('/api/demo', { method: 'POST', body: { action: 'nextDeliveryStep', conversationId } }).then(
      (r) => { void refreshOrders(); return r; },
      (e: { status?: number }) => { if (e.status === 404) say('notice.noOrder'); else fail('chat.error'); return null; },
    );

  const fastForward = () => {
    api<CheckInEvent>('/api/demo', { method: 'POST', body: { action: 'fastForward', conversationId } }).then(
      (event) => notify((id) => ({ id, kind: 'checkin', event })),
      (e: { status?: number }) => (e.status === 404 ? say('notice.noOrder') : fail('chat.error')),
    );
  };

  const reset = () => {
    api('/api/demo', { method: 'POST', body: { action: 'reset' } }).then(
      () => {
        const id = newConversationId();
        storeConversationId(customerId, id);
        setConversationId(id); // a new chat id gives useChat an empty conversation
        setIntake(null);
        setMissing([]);
        commitDraft(null);
        setDiff(null);
        setReceipt(null);
        setCheckout({ kind: 'idle' });
        setProgress({});
        setLocal([]);
        setAnswers({});
        setCheckins({});
        void refreshOrders();
      },
      () => fail('chat.error'),
    );
  };

  const retry = () => {
    clearError();
    setAttempt((a) => a + 1);
    void regenerate();
  };

  const submitCheckIn = (itemId: string, text: string) => {
    const item = items.find((i) => i.id === itemId);
    if (item?.kind !== 'checkin' || busy) return;
    setCheckins((c) => ({ ...c, [itemId]: { ...c[itemId], answer: text } }));
    // Name the order so the assistant routes the reply to its check-in tool.
    send(t('checkin.message', uiLang, { event: item.event.eventName, id: item.event.orderId, text }));
  };

  const confirmCheckIn = async (itemId: string, entries: Array<{ lineId: string; leftoverQty: number }>) => {
    const item = items.find((i) => i.id === itemId);
    if (item?.kind !== 'checkin') return;
    await api('/api/checkin', { method: 'POST', body: { orderId: item.event.orderId, entries } });
    setCheckins((c) => ({ ...c, [itemId]: { ...c[itemId], confirmed: true } }));
    say('checkin.saved');
    void refreshOrders();
  };

  const openOrder = (orderId: string) =>
    api<OrderDetails>(`/api/orders/${encodeURIComponent(orderId)}`).catch(() => null);

  const getAudit = (orderId?: string) =>
    api<AuditEntry[]>(
      orderId && orderId !== receipt?.orderId
        ? `/api/audit?orderId=${encodeURIComponent(orderId)}`
        : `/api/audit?conversationId=${encodeURIComponent(conversationId)}`,
    ).catch(() => []);

  return {
    items, typing, busy, planning, editing, lang, intake, missing, draft, diff, receipt, orders, refreshOrders,
    send, choose, change, fastForward, reset, retry, submitCheckIn, confirmCheckIn, openOrder, getAudit,
    checkout, requestOffer, placeOrder, clearCheckout, getDelivery, nextDeliveryStep,
  };
}
