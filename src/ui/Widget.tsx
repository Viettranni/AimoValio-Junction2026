'use client';

import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import Image from 'next/image';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AuditEntry, IntakeSlot } from '@/contracts';
import { AuditTimeline } from './AuditTimeline';
import { ChatThread } from './ChatThread';
import { Composer } from './Composer';
import { DemoControls } from './DemoControls';
import { DraftSheet } from './DraftSheet';
import { customerDisplayName, TICKER_NAMES } from './fixtures';
import { t, uiLangFor, type UiKey } from './i18n';
import { ChevronDownIcon, OrdersIcon } from './icons';
import { MyOrders } from './MyOrders';
import { OrderDraft, OrderDraftEmpty, OrderDraftSkeleton } from './OrderDraft';
import { ReceiptView } from './ReceiptView';
import { ReviewSheet } from './ReviewSheet';
import { sampleTerms } from './shelf';
import { SkeletonSheet } from './SkeletonRows';
import { SlotChips } from './SlotChips';
import type { ResizeState, WidgetView } from './thread';
import type { OrderDetails, WidgetSession } from './session';
import { useFixtureSession } from './useFixtureSession';
import { useLiveSession } from './useLiveSession';
import { ShelfContext, usePageVisible, useProductSample, type ShelfState } from './useProductSample';

const noSubscribe = () => () => {};
const useEmbedded = () => useSyncExternalStore(noSubscribe, () => window.self !== window.top, () => false);
const useBrowserLang = () => useSyncExternalStore(noSubscribe, () => navigator.language, () => 'en');

/** Fixture mode only plays the wedding script, so it only offers that example. */
const FIXTURE_EXAMPLES: UiKey[] = ['example.1'];
const LIVE_EXAMPLES: UiKey[] = ['example.1', 'example.2', 'example.3'];

const SLOT_PREFILL: Record<IntakeSlot, (guests?: number) => string> = {
  deliveryDate: () => 'deliver on ',
  guests: (g) => `make it ${g ?? ''} guests`,
  menu: () => 'menu: ',
  budget: () => 'budget €',
  diets: () => 'allergies: ',
};

const paneMotion = {
  initial: { opacity: 0, y: 10, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  // "Fold": the outgoing card shrinks and fades before the next one arrives.
  exit: { opacity: 0, y: 8, scale: 0.95 },
  transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const },
};

interface WidgetProps {
  conversationId: string;
  customerId: string;
  mode: 'live' | 'fixture';
  demo: boolean;
  /** The host page's origin, passed by widget.js; size messages go only there. */
  parentOrigin?: string;
  /** 'panel' (default): the embeddable widget. 'page': the Orders page, assistant and draft as two cards. */
  layout?: 'panel' | 'page';
}

/** Live mode talks to the backend; fixture mode plays the scripted demo without an API key. */
export function Widget(props: WidgetProps) {
  return props.mode === 'live' ? <LiveWidget {...props} /> : <FixtureWidget {...props} />;
}

function LiveWidget(props: WidgetProps) {
  const browserLang = useBrowserLang();
  const session = useLiveSession({ initialConversationId: props.conversationId, customerId: props.customerId, fallbackLang: browserLang });
  return <WidgetView {...props} session={session} examples={LIVE_EXAMPLES} />;
}

function FixtureWidget(props: WidgetProps) {
  const session = useFixtureSession({ conversationId: props.conversationId, customerId: props.customerId });
  return <WidgetView {...props} session={session} examples={FIXTURE_EXAMPLES} fixtureNames={TICKER_NAMES} />;
}

function WidgetView({
  customerId,
  demo,
  parentOrigin,
  layout = 'panel',
  session,
  examples,
  fixtureNames,
}: WidgetProps & { session: WidgetSession; examples: UiKey[]; fixtureNames?: string[] }) {
  const page = layout === 'page';
  const embedded = useEmbedded() && !page;
  const browserLang = useBrowserLang();
  const lang = uiLangFor(session.lang ?? browserLang);

  // Loaders: products for this conversation's menu, rolling only while the widget is open and visible.
  const [hostOpen, setHostOpen] = useState(true);
  const pageVisible = usePageVisible();
  const terms = sampleTerms(session.draft?.intake ?? session.intake);
  // Wait for the intake (data-slots) so the first request is the menu's own; staples only when it has no menu.
  const products = useProductSample({ terms, lang, enabled: session.busy && session.intake !== null, fixtureNames });
  const running = hostOpen && pageVisible;
  const shelf: ShelfState = { products, working: session.busy, running, lang };

  useEffect(() => {
    if (!parentOrigin) return;
    // widget.js says when the buyer minimises or reopens the panel (origin-pinned like the resize messages).
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== parentOrigin || event.source !== window.parent) return;
      if (event.data?.type === 'aimo:open') setHostOpen(event.data.open !== false);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [parentOrigin]);

  const [view, setView] = useState<WidgetView>('chat');
  const [opened, setOpened] = useState<OrderDetails | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  const [text, setText] = useState('');
  const [focusKey, setFocusKey] = useState(0);

  const { draft, receipt } = session;
  // Planning opens the sheet straight away, with skeleton rows until the draft arrives.
  const skeleton = draft === null && session.planning && view === 'chat';
  const expanded = draft !== null || view !== 'chat' || skeleton;
  // Rows that replace the skeletons drop in one after another; afterwards (review → back) the sheet just appears.
  const [fromSkeleton, setFromSkeleton] = useState(false);
  if (skeleton && !fromSkeleton) setFromSkeleton(true);
  if (fromSkeleton && view !== 'chat') setFromSkeleton(false);
  const sentHere = receipt !== null && draft?.status === 'submitted';

  const postResize = (state: ResizeState) => {
    if (parentOrigin) window.parent.postMessage({ type: 'aimo:resize', state }, parentOrigin);
  };

  useEffect(() => {
    if (embedded && parentOrigin) window.parent.postMessage({ type: 'aimo:resize', state: expanded ? 'expanded' : 'chat' }, parentOrigin);
  }, [embedded, expanded, parentOrigin]);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const go = (next: WidgetView) => {
    setAudit(null);
    setView(next);
  };
  const send = (value: string) => {
    // A sent order stays on its receipt; anything else returns to the live draft.
    if (view !== 'orders' && !(view === 'receipt' && sentHere)) go('chat');
    session.send(value);
  };
  const showReceipt = (details: OrderDetails) => {
    setOpened(details);
    go('receipt');
  };
  const openOrder = async (orderId: string) => {
    const details = await session.openOrder(orderId);
    if (details) showReceipt(details);
  };
  const backFromOrders = () => (sentHere ? showReceipt({ receipt: receipt!, leftovers: [] }) : go('chat'));
  // An order placed from Review (directly, or after the approver signed off) opens its receipt.
  const [shownReceiptId, setShownReceiptId] = useState<string | null>(receipt?.orderId ?? null);
  if (receipt && shownReceiptId !== receipt.orderId) {
    setShownReceiptId(receipt.orderId);
    if (view === 'review' || view === 'chat') {
      setOpened({ receipt, leftovers: [] });
      setAudit(null);
      setView('receipt');
    }
  }

  // A new or changed open draft comes to the front. Without this, a draft planned while a receipt (after sending an
  // order) or My orders is showing stays hidden behind it until the buyer toggles My orders.
  const openDraftKey = draft && draft.status !== 'submitted' ? `${draft.id}:${draft.updatedAt}` : null;
  const [seenDraftKey, setSeenDraftKey] = useState(openDraftKey);
  if (openDraftKey !== seenDraftKey) {
    setSeenDraftKey(openDraftKey);
    if (openDraftKey && (view === 'receipt' || view === 'orders')) {
      setAudit(null);
      setView('chat');
    }
  }

  // The delivery timeline of the opened order comes from the gateway.
  const openedId = view === 'receipt' && opened && opened.delivery === undefined ? opened.receipt.orderId : null;
  useEffect(() => {
    if (!openedId) return;
    let live = true;
    session.getDelivery(openedId).then((delivery) => {
      if (live) setOpened((o) => (o && o.receipt.orderId === openedId ? { ...o, delivery: delivery ?? undefined } : o));
    });
    return () => { live = false; };
    // session.getDelivery is recreated each render; the fetch is per opened order.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openedId]);

  const nextDeliveryStep = async () => {
    const r = await session.nextDeliveryStep();
    if (!r) return;
    if (view === 'receipt' && opened?.receipt.orderId === r.orderId) setOpened({ ...opened, delivery: r.delivery });
    else await openOrder(r.orderId);
  };
  const toggleAudit = async (orderId?: string) => {
    if (audit) return setAudit(null);
    setAudit(await session.getAudit(orderId));
  };
  const editSlot = (slot: IntakeSlot) => {
    setText(SLOT_PREFILL[slot](session.intake?.guests));
    setFocusKey((k) => k + 1);
  };
  const reset = () => {
    session.reset();
    setFromSkeleton(false);
    go('chat');
    setOpened(null);
    setText('');
  };

  const auditNode = audit ? <AuditTimeline entries={audit} lang={lang} /> : undefined;
  const pane = (() => {
    if (view === 'orders')
      return <MyOrders orders={session.orders} onOpen={openOrder} onBack={draft || receipt ? backFromOrders : undefined} lang={lang} />;
    if (view === 'receipt' && opened)
      return (
        <ReceiptView
          receipt={opened.receipt}
          leftovers={opened.leftovers}
          lang={lang}
          audit={auditNode}
          delivery={opened.delivery ?? null}
          onOpenAudit={() => toggleAudit(opened.receipt.orderId)}
          onReorder={
            opened.receipt.orderId === receipt?.orderId
              ? undefined
              : () => {
                  go('chat');
                  session.send(t('reorder.message', lang, { event: opened.receipt.eventName, n: opened.receipt.guests, id: opened.receipt.orderId }));
                }
          }
        />
      );
    if (view === 'review' && draft)
      return (
        <ReviewSheet
          draft={draft}
          checkout={session.checkout}
          onRequestOffer={session.requestOffer}
          onPlace={session.placeOrder}
          onBack={() => go('chat')}
          onBackToDraft={() => {
            session.clearCheckout();
            go('chat');
          }}
          onOpenAudit={() => toggleAudit()}
          audit={auditNode}
          lang={lang}
        />
      );
    if (skeleton) return page ? <OrderDraftSkeleton intake={session.intake} lang={lang} /> : <SkeletonSheet intake={session.intake} lang={lang} />;
    if (draft && page)
      return (
        <OrderDraft
          draft={draft}
          diff={session.diff}
          editing={session.editing}
          animateIn={fromSkeleton}
          locked={session.busy || (session.editing !== null && (session.editing.length === 0 || session.editing.includes('')))}
          onChange={session.change}
          onReview={() => go('review')}
          lang={lang}
        />
      );
    if (draft)
      return (
        <DraftSheet
          draft={draft}
          diff={session.diff}
          editing={session.editing}
          animateIn={fromSkeleton}
          locked={session.busy || (session.editing !== null && (session.editing.length === 0 || session.editing.includes('')))}
          onChange={session.change}
          onReview={() => go('review')}
          lang={lang}
        />
      );
    return page ? <OrderDraftEmpty lang={lang} /> : null;
  })();

  const toggleOrders = () => {
    if (view === 'orders') return backFromOrders();
    session.refreshOrders?.();
    go('orders');
  };
  const composer = (roomy: boolean) => (
    <>
      {session.intake && draft?.status !== 'submitted' && (
        <SlotChips intake={draft?.intake ?? session.intake} missing={session.missing} onEdit={editSlot} lang={lang} roomy={roomy} />
      )}
      <Composer
        value={text}
        onChange={setText}
        onSubmit={send}
        onAttach={session.attachDocument ? (file) => { if (view !== 'orders') go('chat'); session.attachDocument?.(file); } : undefined}
        reading={session.reading}
        speechLang={session.lang}
        disabled={session.busy || session.reading}
        focusKey={focusKey}
        lang={lang}
        roomy={roomy}
        placeholder={t(draft && draft.status !== 'submitted' ? 'composer.placeholderDraft' : 'composer.placeholder', lang)}
      />
    </>
  );
  const thread = (roomy: boolean) => (
    <ChatThread
      items={session.items}
      typing={session.typing}
      lang={lang}
      examples={draft || receipt ? [] : examples}
      onExample={send}
      onChoice={session.choose}
      onCheckIn={session.submitCheckIn}
      onCheckInConfirm={session.confirmCheckIn}
      onRetry={session.retry}
      roomy={roomy}
    />
  );

  if (page)
    return (
      <ShelfContext.Provider value={shelf}>
      <MotionConfig reducedMotion="user">
        <main
          className={`mx-auto grid min-h-0 w-full max-w-[1400px] flex-1 gap-5 lg:flex-none px-4 py-5 md:px-6 md:py-6 lg:h-[calc(100dvh-4rem-1px)] lg:grid-cols-[minmax(340px,5fr)_8fr] lg:grid-rows-[minmax(0,1fr)] lg:gap-6 ${running ? '' : 'aimo-paused'}`}
        >
          <section aria-label={t('header.title', lang)} className="flex h-[78dvh] min-h-0 flex-col rounded-2xl bg-white shadow-card lg:h-auto">
            <header className="flex flex-none items-center gap-1.5 px-5 pb-3 pt-6 md:px-8 md:pt-7">
              <h1 className="min-w-0 flex-1 truncate text-[24px] font-bold leading-tight tracking-[-0.01em] text-navy">{t('header.title', lang)}</h1>
              {demo && (
                <DemoControls
                  light
                  fast={session.fast}
                  lang={lang}
                  onFastForward={session.fastForward}
                  onNextStep={() => void nextDeliveryStep()}
                  onReset={reset}
                  onToggleFast={session.setFast && (() => session.setFast!(!session.fast))}
                />
              )}
              <button
                type="button"
                onClick={toggleOrders}
                aria-pressed={view === 'orders'}
                className={`flex flex-none items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                  view === 'orders' ? 'bg-sky text-navy' : 'text-muted hover:bg-sky hover:text-navy'
                }`}
              >
                <OrdersIcon size={15} />
                {t('draft.myOrders', lang)}
              </button>
            </header>
            {thread(true)}
            <div className="flex-none px-5 pb-5 pt-1 md:px-8 md:pb-7">{composer(true)}</div>
          </section>

          <section aria-label={t('sheet.title', lang)} className="flex min-h-[70dvh] min-w-0 flex-col lg:min-h-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={view === 'receipt' ? `receipt-${opened?.receipt.orderId}` : view}
                {...paneMotion}
                className="flex min-h-0 w-full flex-1 flex-col"
              >
                {pane}
              </motion.div>
            </AnimatePresence>
          </section>
        </main>
      </MotionConfig>
      </ShelfContext.Provider>
    );

  const card = (
    <div className={`relative flex h-full w-full flex-col overflow-hidden bg-white md:flex-row ${running ? '' : 'aimo-paused'}`}>
      <section
        className={`flex min-h-0 flex-col ${expanded ? 'h-[46%] flex-none border-b border-line md:h-full md:w-[380px] md:border-b-0 md:border-r' : 'h-full w-full'}`}
      >
        <header className="flex flex-none items-center gap-2.5 bg-navy px-3.5 py-3 text-white">
          {/* The robot is petrol, so it sits on a white disc to read on the petrol header. */}
          <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-white">
            <Image src="/aimo-bot.svg" alt="" width={24} height={24} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13.5px] font-semibold leading-[18px]">{t('header.title', lang)}</div>
            <div className="truncate text-[11px] leading-4 text-white/60">{customerDisplayName(customerId)}</div>
          </div>
          {demo && (
            <DemoControls
              fast={session.fast}
              lang={lang}
              onFastForward={session.fastForward}
              onNextStep={() => void nextDeliveryStep()}
              onReset={reset}
              onToggleFast={session.setFast && (() => session.setFast!(!session.fast))}
            />
          )}
          <HeaderButton
            label={t('header.orders', lang)}
            active={view === 'orders'}
            onClick={toggleOrders}
          >
            <OrdersIcon size={16} />
          </HeaderButton>
          {embedded && (
            <HeaderButton label={t('header.close', lang)} onClick={() => postResize('closed')}>
              <ChevronDownIcon size={18} />
            </HeaderButton>
          )}
        </header>

        {thread(false)}

        <div className="flex-none px-3 pb-3 pt-1">{composer(false)}</div>
      </section>

      <AnimatePresence>
        {expanded && (
          <motion.section
            key="pane"
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ type: 'spring', stiffness: 260, damping: 30, delay: 0.15 }}
            className="aimo-wash flex min-h-0 min-w-0 flex-1 flex-col p-4 md:p-5"
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={view === 'receipt' ? `receipt-${opened?.receipt.orderId}` : view}
                {...paneMotion}
                className="mx-auto flex min-h-0 w-full max-w-[780px] flex-1 flex-col"
              >
                {pane}
              </motion.div>
            </AnimatePresence>
          </motion.section>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <ShelfContext.Provider value={shelf}>
    <MotionConfig reducedMotion="user">
      {embedded ? (
        <div className="h-dvh w-full">{card}</div>
      ) : (
        // Standalone preview: mimic the host script's bubble → panel growth.
        <div className="aimo-wash fixed inset-0">
          <div
            className="fixed bottom-6 right-6 overflow-hidden rounded-2xl border border-line shadow-card transition-[width,height] duration-[560ms] ease-[cubic-bezier(0.2,1.15,0.3,1)] motion-reduce:transition-none"
            style={{
              width: expanded ? 'min(1100px, calc(100vw - 48px))' : 'min(380px, calc(100vw - 48px))',
              height: expanded ? 'min(86vh, calc(100vh - 48px))' : 'min(600px, calc(100vh - 48px))',
            }}
          >
            {card}
          </div>
        </div>
      )}
    </MotionConfig>
    </ShelfContext.Provider>
  );
}

function HeaderButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={`flex h-8 w-8 flex-none items-center justify-center rounded-full transition-colors hover:bg-white/10 hover:text-white ${
        active ? 'bg-white/15 text-white' : 'text-white/70'
      }`}
    >
      {children}
    </button>
  );
}
