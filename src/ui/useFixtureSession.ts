'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  Actor,
  AuditEntry,
  DietNeed,
  Draft,
  DraftChange,
  DraftDiff,
  Intake,
  IntakeSlot,
  Lang,
  OrderSummary,
  ProgressEvent,
  ProgressStepId,
  Receipt,
} from '@/contracts';
import {
  ADDON_CHOICES,
  BUDGET_CHOICES,
  DIET_CHOICES,
  TICKER_NAMES,
  WEDDING_INTAKE,
  applyFixtureChange,
  basmatiSwap,
  buildFixtureDraft,
  computeFixtureTotals,
  detectFixtureLang,
  dietsFromChoice,
  fixturePastOrders,
  fixtureReceipt,
  nextFixtureOrderId,
  parseFixtureAnswer,
  parseFixtureCheckIn,
  parseFixtureEdit,
  planningScript,
} from './fixtures';
import { formatMoney, formatNumber, formatQtyDelta } from './format';
import type { ThreadItem } from './thread';

/** Scales every scripted delay in fast mode. */
const FAST_FACTOR = 0.35;

type Phase = 'greeting' | 'intake' | 'addons' | 'planning' | 'draft' | 'sent';
export interface OrderRecord {
  summary: OrderSummary;
  receipt: Receipt;
}

class Cancelled extends Error {}

const STEP_ACTOR: Record<ProgressStepId, Actor> = {
  understand: 'intake',
  ingredients: 'menu',
  search: 'product',
  allergens: 'allergen',
  prices: 'pricing',
  history: 'history',
  draft: 'orchestrator',
};

const ADDON_WORDS: Array<[string, RegExp]> = [
  ['salad', /salad|salaatti|sallad/i],
  ['bread', /bread|leipä|bröd/i],
  ['dessert', /dessert|cake|jälki|kakku|efterrätt|tårta/i],
  ['coffee', /coffee|tea|kahvi|tee|kaffe/i],
  ['gravy', /gravy|kastike|sås/i],
];

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function dietSummary(diets: DietNeed[] | 'none'): string {
  if (diets === 'none') return 'no allergies';
  const names: Record<string, string> = { gluten_free: 'gluten-free', lactose_free: 'lactose-free', nuts: 'nut-free' };
  const parts = diets.map((d) => `${d.guests} ${names[d.diet] ?? d.diet}`);
  return `${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]} guests`;
}

function rangeText(draft: Draft): string {
  const { low, high, collapsed } = draft.totals;
  return collapsed
    ? formatMoney(high, 'en')
    : `${formatMoney(low, 'en')}–${formatMoney(high, 'en')}`;
}

/** Plays the scripted wedding demo and keeps a local draft. Same surface a live session will offer. */
export function useFixtureSession({ conversationId, customerId, live }: { conversationId: string; customerId: string; live: boolean }) {
  const [items, setItems] = useState<ThreadItem[]>([{ id: 'greet', kind: 'greeting' }]);
  const [typing, setTyping] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState<Lang | undefined>();
  const [intake, setIntake] = useState<Intake | null>(null);
  const [missing, setMissing] = useState<IntakeSlot[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [diff, setDiff] = useState<DraftDiff | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [orders, setOrders] = useState<OrderRecord[]>(() => fixturePastOrders(customerId));
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [fast, setFastState] = useState(false);

  const itemsRef = useRef(items);
  const draftRef = useRef(draft);
  const intakeRef = useRef(intake);
  const missingRef = useRef(missing);
  const ordersRef = useRef(orders);
  const phaseRef = useRef<Phase>('greeting');
  const fastRef = useRef(false);
  const genRef = useRef(0);
  const idRef = useRef(0);

  useEffect(() => {
    const gen = genRef;
    return () => {
      gen.current++; // cancels any running script on unmount
    };
  }, []);

  const nextId = () => `i-${++idRef.current}`;
  const commitItems = (fn: (items: ThreadItem[]) => ThreadItem[]) => {
    itemsRef.current = fn(itemsRef.current);
    setItems(itemsRef.current);
  };
  const push = (item: ThreadItem) => commitItems((list) => [...list, item]);
  const say = (text: string) => push({ id: nextId(), kind: 'assistant', text });
  const commitDraft = (next: Draft | null) => {
    draftRef.current = next;
    setDraft(next);
  };
  const commitIntake = (next: Intake, nextMissing: IntakeSlot[]) => {
    intakeRef.current = next;
    missingRef.current = nextMissing;
    setIntake(next);
    setMissing(nextMissing);
  };
  const commitOrders = (fn: (list: OrderRecord[]) => OrderRecord[]) => {
    ordersRef.current = fn(ordersRef.current);
    setOrders(ordersRef.current);
  };
  const log = (actor: Actor, action: string, summary: string, orderId?: string) =>
    setAudit((list) => [
      ...list,
      { id: `a-${list.length + 1}`, conversationId, orderId, at: new Date().toISOString(), actor, action, summary },
    ]);

  const wait = async (ms: number) => {
    const gen = genRef.current;
    await new Promise((resolve) => setTimeout(resolve, ms * (fastRef.current ? FAST_FACTOR : 1)));
    if (gen !== genRef.current) throw new Cancelled();
  };
  const run = (flow: () => Promise<void>) => {
    flow().catch((error) => {
      if (!(error instanceof Cancelled)) throw error;
    });
  };
  const think = async (ms: number) => {
    setTyping(true);
    try {
      await wait(ms);
    } finally {
      setTyping(false);
    }
  };

  // ───── Intake ─────

  const answerSlot = (slot: 'budget' | 'diets', value: Intake['budget'] | Intake['diets']) => {
    const next = { ...intakeRef.current!, [slot]: value };
    commitIntake(next, missingRef.current.filter((s) => s !== slot));
    log('buyer', 'answerSlot', slot === 'budget'
      ? `Budget: ${value === 'none' ? 'no limit' : formatMoney(value as number, 'en')}`
      : `Diets: ${dietSummary(value as DietNeed[] | 'none')}`);
  };

  const markChoice = (eventId: string, answer: { ids: string[]; freeText?: string }) =>
    commitItems((list) =>
      list.map((i) => (i.kind === 'choices' && i.event.id === eventId && !i.answer ? { ...i, answer } : i)),
    );

  const askAddons = async () => {
    phaseRef.current = 'addons';
    const { budget, diets } = intakeRef.current!;
    await think(600);
    say(`Noted: ${dietSummary(diets!)}, budget ${budget === 'none' ? 'no limit' : formatMoney(budget as number, 'en')}. Anything on the side? I only add what you pick.`);
    await wait(250);
    push({ id: nextId(), kind: 'choices', event: ADDON_CHOICES });
  };

  const intakeFlow = async (text: string) => {
    phaseRef.current = 'intake';
    setLang(detectFixtureLang(text));
    log('buyer', 'message', `Asked: “${text}”`);
    await think(750);

    const guests = Number(text.match(/(\d{2,5})\s*(?:guests|pax|people|vierasta|hengelle|gäster)/i)?.[1] ?? 300);
    const parsed = parseFixtureAnswer(text);
    const next: Intake = { ...WEDDING_INTAKE, guests, lang: detectFixtureLang(text), budget: parsed.budget, diets: parsed.diets };
    const stillMissing = (['budget', 'diets'] as const).filter((s) => next[s] === undefined);
    commitIntake(next, [...stillMissing]);
    log('intake', 'extractSlots', `Read Sun 6 Dec, ${guests} guests, chicken & rice${stillMissing.length ? `; still needed: ${stillMissing.join(', ')}` : ''}`);

    if (!stillMissing.length) return askAddons();
    say(`A wedding for ${guests} on Sun 6 Dec, lovely. ${stillMissing.length === 2 ? 'Two quick things' : 'One quick thing'} before I plan:`);
    for (const slot of stillMissing) {
      await wait(220);
      push({ id: nextId(), kind: 'choices', event: slot === 'budget' ? BUDGET_CHOICES : DIET_CHOICES });
    }
  };

  const afterSlotAnswered = () => {
    if (phaseRef.current === 'intake' && missingRef.current.length === 0) run(askAddons);
  };

  // ───── Planning ─────

  const revealDraft = async (full: Draft) => {
    const budget = full.totals.budget;
    const building = (n: number): Draft => {
      const lines = full.lines.slice(0, n);
      return { ...full, lines, status: 'building', totals: computeFixtureTotals(lines, budget) };
    };
    commitDraft(building(0));
    await wait(520); // let the panel spring open first
    for (let n = 1; n <= full.lines.length; n++) {
      commitDraft(building(n));
      await wait(150);
    }
    await wait(300);
    commitDraft(full);
  };

  const planningFlow = async (addons: string[]) => {
    phaseRef.current = 'planning';
    setBusy(true);
    const current = intakeRef.current!;
    const full = buildFixtureDraft(current, addons, conversationId, customerId);
    const dietGuests = current.diets === 'none' || !current.diets ? 0 : current.diets.reduce((s, d) => s + d.guests, 0);
    const gfGuests = current.diets === 'none' ? 0 : (current.diets?.find((d) => d.diet === 'gluten_free')?.guests ?? 0);
    const n = full.lines.length;
    const auditFor: Record<ProgressStepId, string> = {
      understand: `Wedding on Sun 6 Dec for ${current.guests} guests; menu: chicken, rice`,
      ingredients: `Split the menu into ${n} components, ${full.lines.filter((l) => l.tags.includes('needed_for_cooking')).length} of them needed for cooking`,
      search: 'Matched Kariniemen Chicken breast fillet 4.4 kg for chicken and Jasmine rice 5 kg for rice',
      allergens: gfGuests
        ? `Wheat flour contains gluten: added Semper gluten-free flour mix for ${gfGuests} guests`
        : 'Checked every line against the diets',
      prices: `Priced ${n} lines for Sun 6 Dec; all deliverable, order by Fri 4 Dec 14:00`,
      history: 'Chicken: 11% left over across 3 past events. Rice: 2 kg short at the last wedding',
      draft: `Draft ready: ${n} lines, ${rangeText(full)}`,
    };

    const progressId = nextId();
    push({ id: progressId, kind: 'progress', events: [] });
    const emit = (event: ProgressEvent) =>
      commitItems((list) =>
        list.map((i) => (i.id === progressId && i.kind === 'progress' ? { ...i, events: [...i.events, event] } : i)),
      );

    try {
      for (const step of planningScript(current.guests ?? 0, dietGuests, n)) {
        emit({ step: step.step, status: 'start', label: step.step, ticker: step.ticker ? TICKER_NAMES : undefined });
        if (step.step === 'draft') await revealDraft(full);
        else await wait(step.ms);
        emit({ step: step.step, status: 'done', label: step.result, count: step.count });
        log(STEP_ACTOR[step.step], step.step, auditFor[step.step]);
      }
    } finally {
      setBusy(false);
    }
    phaseRef.current = 'draft';
    await wait(300);
    say(`Your draft is ready: ${n} lines, ${rangeText(full)} excl. VAT. Chicken and rice have a note from your past events.`);
  };

  // ───── Editing ─────

  const applyChange = (change: DraftChange) => {
    const before = draftRef.current!;
    const result = applyFixtureChange(before, change);
    commitDraft(result.draft);
    setDiff(result.diff);
    return { before, ...result };
  };

  const describeDelta = (before: Draft, after: Draft, changed: string[]) =>
    changed
      .map((id, index) => {
        const a = after.lines.find((l) => l.id === id);
        const b = before.lines.find((l) => l.id === id);
        if (!a || !b) return null;
        const label = after.components.find((c) => c.id === a.componentId)?.label ?? a.productName;
        return `${index === 0 ? label : label.toLowerCase()} ${formatQtyDelta(a.quantity - b.quantity, a.unit, 'en')}`;
      })
      .filter(Boolean)
      .reduce((text, part, index, parts) => {
        // Keep the chat short; the sheet shows every changed row.
        if (index < 3) return index === 0 ? part! : `${text}, ${part}`;
        return index === 3 ? `${text} and ${parts.length - 3} more` : text;
      }, '');

  const editFlow = async (text: string) => {
    const current = draftRef.current!;
    const edit = parseFixtureEdit(text, current);
    await think(650);
    switch (edit.kind) {
      case 'scale': {
        const { before, draft: after, diff: d } = applyChange({ kind: 'scaleGuests', guests: edit.guests });
        const delta = describeDelta(before, after, d.changedLineIds);
        say(`Done for ${edit.guests} guests.${delta ? ` ${delta}.` : ' The packs already cover it.'}`);
        log('order', 'scaleGuests', `Scaled the draft from ${before.intake.guests} to ${edit.guests} guests${delta ? `: ${delta}` : ''}`);
        return;
      }
      case 'swapRice': {
        const rice = current.lines.find((l) => l.componentId === 'c-rice');
        if (!rice) return say('There’s no rice line left to swap.');
        const { draft: after } = applyChange(basmatiSwap(rice.id));
        const swapped = after.lines.find((l) => l.id === rice.id)!;
        const extra = (swapped.unitPrice ?? 0) * swapped.packs - (rice.unitPrice ?? 0) * rice.packs;
        say(`Swapped to ${swapped.productName}. Same amount, ${extra >= 0 ? '+' : '−'}${formatMoney(Math.abs(extra), 'en')}.`);
        log('product', 'swapProduct', `Swapped ${rice.productName} → ${swapped.productName}: requested by the buyer`);
        return;
      }
      case 'remove': {
        const line = current.lines.find((l) => l.id === edit.lineId)!;
        applyChange({ kind: 'removeLine', lineId: edit.lineId });
        say(`Removed ${line.productName}.`);
        log('order', 'removeLine', `Removed ${line.productName}`);
        return;
      }
      case 'unknown':
        say('In this demo I can change the guest count, swap the rice to basmati or remove a line. Try “make it 320 guests”.');
    }
  };

  // ───── Public actions ─────

  const send = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    push({ id: nextId(), kind: 'user', text });
    if (live) {
      say('Live planning isn’t connected in this build yet.');
      return;
    }
    switch (phaseRef.current) {
      case 'greeting':
      case 'sent':
        commitDraft(null);
        setDiff(null);
        return run(() => intakeFlow(text));
      case 'intake': {
        const parsed = parseFixtureAnswer(text);
        // Typed answers lock the matching quick replies, showing only what was understood.
        if (parsed.budget !== undefined && missingRef.current.includes('budget')) {
          answerSlot('budget', parsed.budget);
          markChoice('budget', { ids: [], freeText: parsed.budget === 'none' ? 'No limit' : formatMoney(parsed.budget, 'en') });
        }
        if (parsed.diets !== undefined && missingRef.current.includes('diets')) {
          answerSlot('diets', parsed.diets);
          markChoice('diets', { ids: [], freeText: capitalise(dietSummary(parsed.diets)) });
        }
        if (parsed.budget === undefined && parsed.diets === undefined) {
          say('Sorry, I didn’t catch that. Tap an option above, or type something like “€1,500, 12 gluten-free”.');
        }
        return afterSlotAnswered();
      }
      case 'addons': {
        const ids = ADDON_WORDS.filter(([, re]) => re.test(text)).map(([id]) => id);
        markChoice('addons', { ids, freeText: text });
        log('buyer', 'chooseAddons', ids.length ? `Add-ons: ${ids.join(', ')}` : 'No add-ons');
        return run(() => planningFlow(ids));
      }
      case 'draft':
        return run(() => editFlow(text));
      case 'planning':
        return;
    }
  };

  const choose = (itemId: string, ids: string[], freeText?: string) => {
    const item = itemsRef.current.find((i) => i.id === itemId);
    if (item?.kind !== 'choices' || item.answer) return;
    const answer = { ids, freeText: freeText?.trim() || undefined };

    if (item.event.id === 'budget') {
      const value = answer.freeText ? parseFixtureAnswer(answer.freeText).budget : ids[0] === 'none' ? 'none' : Number(ids[0]);
      if (value === undefined) return say('Which amount should I plan for? For example “€1,500”.');
      markChoice('budget', answer);
      answerSlot('budget', value);
      return afterSlotAnswered();
    }
    if (item.event.id === 'diets') {
      markChoice('diets', answer);
      answerSlot('diets', dietsFromChoice(ids, answer.freeText));
      return afterSlotAnswered();
    }
    if (item.event.id === 'addons') {
      const picked = [
        ...ids.filter((id) => id !== 'none'),
        ...(answer.freeText ? ADDON_WORDS.filter(([, re]) => re.test(answer.freeText!)).map(([id]) => id) : []),
      ];
      markChoice('addons', answer);
      log('buyer', 'chooseAddons', picked.length ? `Add-ons: ${picked.join(', ')}` : 'No add-ons');
      run(() => planningFlow([...new Set(picked)]));
    }
  };

  const change = (c: DraftChange) => {
    const current = draftRef.current;
    if (!current || current.status === 'submitted') return;
    const line = 'lineId' in c ? current.lines.find((l) => l.id === c.lineId) : undefined;
    applyChange(c);
    const name = line?.productName ?? '';
    if (c.kind === 'setPacks') log('buyer', 'setPacks', `Set ${name} to ${c.packs} packs`);
    if (c.kind === 'historyChoice') log('buyer', 'historyChoice', `${c.choice === 'history' ? 'Used the history amount' : 'Kept the suggested amount'} for ${name}`);
    if (c.kind === 'removeLine') log('buyer', 'removeLine', `Removed ${name}`);
  };

  const approve = async (): Promise<Receipt | null> => {
    const current = draftRef.current;
    if (!current) return null;
    const gen = genRef.current;
    await new Promise((resolve) => setTimeout(resolve, 700));
    if (gen !== genRef.current) return null;
    const next = fixtureReceipt(current, nextFixtureOrderId());
    commitDraft({ ...current, status: 'submitted' });
    setReceipt(next);
    commitOrders((list) => [
      {
        receipt: next,
        summary: {
          orderId: next.orderId, eventName: next.eventName, eventDate: next.deliveryDate, guests: next.guests,
          total: next.total, submittedAt: next.submittedAt, leftoverRatio: null, checkInDone: false,
        },
      },
      ...list,
    ]);
    log('buyer', 'approve', 'Approved the order on the review screen', next.orderId);
    log('order', 'submitOrder', `Sent ${next.orderId} to Valio Aimo (simulated): ${next.lines.length} lines, ${formatMoney(next.total, 'en')} excl. VAT`, next.orderId);
    phaseRef.current = 'sent';
    say(`Sent. Order ${next.orderId} is with Valio Aimo for delivery on Sun 6 Dec.`);
    return next;
  };

  const fastForward = () => {
    const order = ordersRef.current.find((o) => !o.summary.checkInDone);
    if (!order) return say('No orders are waiting for a check-in.');
    log('system', 'clockOffset', `Demo clock moved to the day after ${order.summary.eventName.toLowerCase()}`, order.summary.orderId);
    push({
      id: nextId(),
      kind: 'checkin',
      event: {
        orderId: order.summary.orderId,
        eventName: order.summary.eventName,
        lines: order.receipt.lines.map((l) => ({ lineId: l.lineId, productName: l.productName, quantity: l.quantity, unit: l.unit })),
      },
    });
  };

  const submitCheckIn = (itemId: string, text: string) => {
    const item = itemsRef.current.find((i) => i.id === itemId);
    if (item?.kind !== 'checkin' || item.answer) return;
    commitItems((list) => list.map((i) => (i.id === itemId && i.kind === 'checkin' ? { ...i, answer: text } : i)));
    const { results, ratio } = parseFixtureCheckIn(text, item.event.lines);
    run(async () => {
      await think(700);
      const parts = results.map((r) => {
        const what = r.outcome === 'short' ? (r.amount ? `${formatNumber(r.amount, 'en')} ${r.unit} short` : 'ran out') : `${formatNumber(r.amount ?? 0, 'en')} ${r.unit} left over`;
        return `${r.productName}: ${what}`;
      });
      say(`${parts.length ? `Saved. ${parts.join('. ')}.` : 'Saved.'} Everything else counts as used up, and I’ll factor this in next time.`);
      commitOrders((list) =>
        list.map((o) => (o.summary.orderId === item.event.orderId ? { ...o, summary: { ...o.summary, checkInDone: true, leftoverRatio: ratio } } : o)),
      );
      log('history', 'recordLeftovers', parts.length ? `Recorded leftovers: ${parts.join('; ')}` : 'Recorded: everything used up', item.event.orderId);
    });
  };

  const reset = () => {
    genRef.current++;
    phaseRef.current = 'greeting';
    itemsRef.current = [{ id: 'greet', kind: 'greeting' }];
    setItems(itemsRef.current);
    setTyping(false);
    setBusy(false);
    setLang(undefined);
    intakeRef.current = null;
    missingRef.current = [];
    setIntake(null);
    setMissing([]);
    commitDraft(null);
    setDiff(null);
    setReceipt(null);
    ordersRef.current = fixturePastOrders(customerId);
    setOrders(ordersRef.current);
    setAudit([]);
  };

  const setFast = (on: boolean) => {
    fastRef.current = on;
    setFastState(on);
  };

  return {
    items, typing, busy, lang, intake, missing, draft, diff, receipt, orders, audit, fast,
    send, choose, change, approve, fastForward, submitCheckIn, reset, setFast,
  };
}

export type WidgetSession = ReturnType<typeof useFixtureSession>;
