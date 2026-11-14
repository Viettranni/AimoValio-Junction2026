'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage } from 'ai';
import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  AuditEntry, CheckInEvent, ChoicesEvent, Draft, DraftChange, DraftDiff, DraftEvent, Intake, IntakeSlot,
  OrderSummary, ProgressEvent, Receipt, ReceiptEvent, SlotsEvent,
} from '@/contracts';
import { describeEdit } from './editNote';
import { t, uiLangFor, type UiKey } from './i18n';
import type { ApproveResult, OrderDetails, WidgetSession } from './session';
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
  const [slowTurn, setSlowTurn] = useState('');
  const [attempt, setAttempt] = useState(0);
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
    api<OrderSummary[]>(`/api/orders?customerId=${encodeURIComponent(customerId)}`).then(setOrders, () => {});

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
    api<OrderSummary[]>(`/api/orders?customerId=${encodeURIComponent(customerId)}`).then(setOrders, () => {});
    return () => cancelAnimationFrame(frame);
    // setMessages is stable per chat; the restore runs once per conversation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, customerId]);

  useEffect(() => {
    if (status === 'ready' && messages.length) saveChat(conversationId, { messages, answers });
  }, [status, messages, answers, conversationId]);

  // The typing dots wait 600 ms on every attempt, including a retry of the same turn.
  const turnKey = `${userCount}:${attempt}`;
  useEffect(() => {
    if (!busy) return;
    const id = setTimeout(() => setSlowTurn(turnKey), TYPING_DELAY_MS);
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
  const typing =
    busy && slowTurn === turnKey && !progress[userCount]?.length && (last?.role !== 'assistant' || !messageText(last));

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
      }
    });
  };

  const approve = async (confirmedUnknownLineIds: string[]): Promise<ApproveResult> => {
    const result = await api<ApproveResult>('/api/order/approve', { method: 'POST', body: { conversationId, confirmedUnknownLineIds } });
    if (result.receipt) {
      const sent = result.receipt;
      setReceipt(sent);
      if (draftRef.current) commitDraft({ ...draftRef.current, status: 'submitted' });
      say('notice.sent', { id: sent.orderId });
      void refreshOrders();
    }
    return result;
  };

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
    items, typing, busy, lang, intake, missing, draft, diff, receipt, orders,
    send, choose, change, approve, fastForward, reset, retry, submitCheckIn, confirmCheckIn, openOrder, getAudit,
  };
}
