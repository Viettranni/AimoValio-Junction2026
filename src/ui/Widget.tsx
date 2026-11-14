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
import { customerDisplayName } from './fixtures';
import { t, uiLangFor, type UiKey } from './i18n';
import { ChevronDownIcon, OrdersIcon } from './icons';
import { MyOrders } from './MyOrders';
import { ReceiptView } from './ReceiptView';
import { ReviewSheet } from './ReviewSheet';
import { SlotChips } from './SlotChips';
import type { ResizeState, WidgetView } from './thread';
import type { ApproveResult, OrderDetails, WidgetSession } from './session';
import { useFixtureSession } from './useFixtureSession';
import { useLiveSession } from './useLiveSession';

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
  return <WidgetView {...props} session={session} examples={FIXTURE_EXAMPLES} />;
}

function WidgetView({
  customerId,
  demo,
  parentOrigin,
  session,
  examples,
}: WidgetProps & { session: WidgetSession; examples: UiKey[] }) {
  const embedded = useEmbedded();
  const browserLang = useBrowserLang();
  const lang = uiLangFor(session.lang ?? browserLang);

  const [view, setView] = useState<WidgetView>('chat');
  const [opened, setOpened] = useState<OrderDetails | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null>(null);
  // Problems from the last approval hold only for the draft version they were found on.
  const [rejected, setRejected] = useState<{ at: string; problems: NonNullable<ApproveResult['problems']> } | null>(null);
  const [text, setText] = useState('');
  const [focusKey, setFocusKey] = useState(0);

  const { draft, receipt } = session;
  const expanded = draft !== null || view !== 'chat';
  const sentHere = receipt !== null && draft?.status === 'submitted';
  const problems = rejected && draft && rejected.at === draft.updatedAt ? rejected.problems : undefined;
  const lineProblems = problems && Object.fromEntries(problems.filter((p) => p.lineId).map((p) => [p.lineId, p.reason]));

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
  const approve = async (confirmedUnknownLineIds: string[]) => {
    const result = await session.approve(confirmedUnknownLineIds);
    if (result.receipt) showReceipt({ receipt: result.receipt, leftovers: [] });
    else if (result.problems?.length && draft) setRejected({ at: draft.updatedAt, problems: result.problems });
    return result;
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
          onOpenAudit={() => toggleAudit(opened.receipt.orderId)}
          onReorder={
            opened.receipt.orderId === receipt?.orderId
              ? undefined
              : () => {
                  go('chat');
                  session.send(t('reorder.message', lang, { event: opened.receipt.eventName, n: opened.receipt.guests }));
                }
          }
        />
      );
    if (view === 'review' && draft)
      return (
        <ReviewSheet
          draft={draft}
          problems={problems}
          onApprove={approve}
          onBack={() => go('chat')}
          onOpenAudit={() => toggleAudit()}
          audit={auditNode}
          lang={lang}
        />
      );
    if (draft)
      return (
        <DraftSheet
          draft={draft}
          diff={session.diff}
          problems={lineProblems}
          locked={session.busy}
          onChange={session.change}
          onReview={() => go('review')}
          lang={lang}
        />
      );
    return null;
  })();

  const card = (
    <div className="flex h-full w-full flex-col overflow-hidden bg-white md:flex-row">
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
              onReset={reset}
              onToggleFast={session.setFast && (() => session.setFast!(!session.fast))}
            />
          )}
          <HeaderButton
            label={t('header.orders', lang)}
            active={view === 'orders'}
            onClick={() => (view === 'orders' ? backFromOrders() : go('orders'))}
          >
            <OrdersIcon size={16} />
          </HeaderButton>
          {embedded && (
            <HeaderButton label={t('header.close', lang)} onClick={() => postResize('closed')}>
              <ChevronDownIcon size={18} />
            </HeaderButton>
          )}
        </header>

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
        />

        <div className="flex-none px-3 pb-3 pt-1">
          {session.intake && draft?.status !== 'submitted' && (
            <SlotChips intake={draft?.intake ?? session.intake} missing={session.missing} onEdit={editSlot} lang={lang} />
          )}
          <Composer
            value={text}
            onChange={setText}
            onSubmit={send}
            disabled={session.busy}
            focusKey={focusKey}
            lang={lang}
            placeholder={t(draft && draft.status !== 'submitted' ? 'composer.placeholderDraft' : 'composer.placeholder', lang)}
          />
        </div>
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
