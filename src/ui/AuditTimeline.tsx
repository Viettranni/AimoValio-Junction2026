import type { AuditEntry, UiLang } from '@/contracts';
import { formatTime } from './format';
import { t } from './i18n';

/** "10:42 · Allergen agent · Wheat flour contains gluten …" as a quiet vertical timeline. */
export function AuditTimeline({ entries, lang }: { entries: AuditEntry[]; lang: UiLang }) {
  return (
    <ol className="relative ml-1 border-l border-line pl-4">
      {entries.map((e) => (
        <li key={e.id} className="relative pb-2.5 last:pb-0">
          <span
            className={`absolute -left-[20.5px] top-[5px] h-2 w-2 rounded-full ring-2 ring-white ${
              e.actor === 'buyer' ? 'bg-blue' : 'bg-line'
            }`}
          />
          <div className="text-[11px] text-muted tabular-nums">
            {formatTime(e.at, lang)} · <span className="font-medium text-ink-soft">{t(`actor.${e.actor}`, lang)}</span>
          </div>
          <div className="text-[12px] leading-[17px] text-navy">{e.summary}</div>
        </li>
      ))}
    </ol>
  );
}
