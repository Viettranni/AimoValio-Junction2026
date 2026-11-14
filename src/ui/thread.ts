import type { CheckInEvent, ChoicesEvent, ConnectEvent, ProgressEvent } from '@/contracts';

export interface ChoiceAnswer {
  ids: string[];
  freeText?: string;
}

/** One entry in the chat column. Assistant prose stays short; structured content gets its own kind. */
export type ThreadItem =
  | { id: string; kind: 'greeting' }
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string }
  | { id: string; kind: 'choices'; event: ChoicesEvent; answer?: ChoiceAnswer }
  | { id: string; kind: 'progress'; events: ProgressEvent[] }
  | { id: string; kind: 'checkin'; event: CheckInEvent; answer?: string; confirmed?: boolean }
  /** The copy-paste MCP link for Claude. */
  | { id: string; kind: 'connect'; event: ConnectEvent }
  /** A calm inline failure; `retry` offers to resend the last request. */
  | { id: string; kind: 'error'; text: string; retry?: boolean };

export type WidgetView = 'chat' | 'review' | 'receipt' | 'orders';

/** What the iframe asks the host script to do with its size. */
export type ResizeState = 'bubble' | 'chat' | 'expanded' | 'closed';

// ───────────── Live thread derivation ─────────────

/** The parts of a chat message the thread reads; structurally compatible with AI SDK UI messages. */
export interface ThreadPart {
  type: string;
  text?: string;
  data?: unknown;
}
export interface ThreadMessage {
  id: string;
  role: 'system' | 'user' | 'assistant';
  parts: ThreadPart[];
}

/** A local entry (notice, fast-forward check-in) placed after the message count it arrived at. */
export interface LocalItem {
  afterCount: number;
  item: ThreadItem;
}

/** Transient progress events, keyed by the 1-based user turn they belong to. */
export type ProgressRuns = Record<number, ProgressEvent[]>;

export interface ThreadInput {
  messages: ThreadMessage[];
  progress: ProgressRuns;
  local: LocalItem[];
  /** Choice answers by ChoicesEvent id. */
  answers: Record<string, ChoiceAnswer>;
  /** Check-in card state by thread item id. */
  checkins: Record<string, { answer?: string; confirmed?: boolean }>;
  /** Text of a chat failure to show last, with Retry. */
  errorText?: string;
}

export const messageText = (m: ThreadMessage) =>
  m.parts.map((p) => (p.type === 'text' ? (p.text ?? '') : '')).join('').trim();

/** The chat message a choice answer is sent as: the chosen labels, then any typed text. */
export function answerText(event: ChoicesEvent, answer: ChoiceAnswer): string {
  const labels = event.options.filter((o) => answer.ids.includes(o.id)).map((o) => o.label);
  return [...labels, answer.freeText?.trim()].filter(Boolean).join(', ');
}

/** Turns chat messages plus local UI state into the items the chat column renders. */
export function deriveThread({ messages, progress, local, answers, checkins, errorText }: ThreadInput): ThreadItem[] {
  const items: ThreadItem[] = [{ id: 'greet', kind: 'greeting' }];
  const withState = (item: ThreadItem): ThreadItem => (item.kind === 'checkin' ? { ...item, ...checkins[item.id] } : item);
  const pushLocal = (count: number) =>
    local.filter((l) => l.afterCount === count).forEach((l) => items.push(withState(l.item)));
  const lastAssistant = messages.findLastIndex((m) => m.role === 'assistant');
  let users = 0;
  // The answered choice card already shows the reply, so the user message that carries it is not repeated.
  let answeredText: string | null = null;

  pushLocal(0);
  messages.forEach((m, index) => {
    if (m.role === 'user') {
      users++;
      const text = messageText(m);
      if (text !== answeredText) items.push({ id: m.id, kind: 'user', text });
      answeredText = null;
      const run = progress[users];
      if (run?.length) items.push({ id: `${m.id}-progress`, kind: 'progress', events: run });
    } else if (m.role === 'assistant') {
      // Tools emit their parts before the closing text; show the words first, then the buttons or table they refer to.
      const structured: ThreadItem[] = [];
      m.parts.forEach((part, i) => {
        const id = `${m.id}-${i}`;
        if (part.type === 'text' && part.text?.trim()) items.push({ id, kind: 'assistant', text: part.text.trim() });
        else if (part.type === 'data-checkin') {
          structured.push({ id, kind: 'checkin', event: part.data as CheckInEvent, ...checkins[id] });
        } else if (part.type === 'data-connect') {
          structured.push({ id, kind: 'connect', event: part.data as ConnectEvent });
        } else if (part.type === 'data-choices') {
          const event = part.data as ChoicesEvent;
          const answer = answers[event.id];
          // Questions the buyer moved past by typing are dropped rather than left open.
          if (answer || index === lastAssistant) structured.push({ id, kind: 'choices', event, answer });
          if (answer) answeredText = answerText(event, answer);
        }
      });
      items.push(...structured);
    }
    pushLocal(index + 1);
  });
  // Local items can only refer to message counts that exist; anything newer goes last.
  local.filter((l) => l.afterCount > messages.length).forEach((l) => items.push(withState(l.item)));
  if (errorText) items.push({ id: 'chat-error', kind: 'error', text: errorText, retry: true });
  return items;
}
