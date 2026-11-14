import type { ISODate, Lang, UiLang } from '@/contracts';
import { formatDay } from '@/ui/format';
import { uiLangFor } from '@/ui/i18n';

/**
 * Buyer-facing reasons for substitutions and exceptions, in the intake language
 * (fi / sv / en; any other language falls back to English). They are shown on draft lines
 * and quoted in the exceptions the orchestrator relays, so they stay short.
 */
export type Reason =
  | { kind: 'salesBlock' }
  | { kind: 'late'; date: ISODate }
  | { kind: 'notDeliverable'; date: ISODate }
  | { kind: 'shortStock'; packs: number; label: string }
  | { kind: 'buyerAsked' }
  | { kind: 'noSafeProduct'; label: string };

const TEMPLATES: Record<UiLang, { [K in Reason['kind']]: (r: Extract<Reason, { kind: K }>, day: (d: ISODate) => string) => string }> = {
  en: {
    salesBlock: () => 'The product has a sales block',
    late: (r, day) => `Earliest delivery ${day(r.date)}`,
    notDeliverable: (r, day) => `Not deliverable on ${day(r.date)}`,
    shortStock: (r) => `Only ${r.packs} packs in stock; the rest is a similar ${r.label.toLowerCase()}`,
    buyerAsked: () => 'Swapped at your request',
    noSafeProduct: (r) => `${r.label}: every product found conflicts with the diets`,
  },
  fi: {
    salesBlock: () => 'Tuotteella on myyntiesto',
    late: (r, day) => `Aikaisintaan toimitettavissa ${day(r.date)}`,
    notDeliverable: (r, day) => `Ei toimitettavissa ${day(r.date)}`,
    shortStock: (r) => `Varastossa vain ${r.packs} pakkausta; loput korvataan vastaavalla tuotteella`,
    buyerAsked: () => 'Vaihdettu pyynnöstäsi',
    noSafeProduct: (r) => `${r.label}: kaikki löydetyt tuotteet ovat ristiriidassa ruokavalioiden kanssa`,
  },
  sv: {
    salesBlock: () => 'Produkten har säljspärr',
    late: (r, day) => `Tidigast leverans ${day(r.date)}`,
    notDeliverable: (r, day) => `Kan inte levereras ${day(r.date)}`,
    shortStock: (r) => `Bara ${r.packs} förpackningar i lager; resten ersätts med en liknande produkt`,
    buyerAsked: () => 'Bytt på din begäran',
    noSafeProduct: (r) => `${r.label}: alla produkter som hittades strider mot specialkosten`,
  },
};

export function reasonText(reason: Reason, lang: Lang | undefined): string {
  const ui = uiLangFor(lang);
  const template = TEMPLATES[ui][reason.kind] as (r: Reason, day: (d: ISODate) => string) => string;
  return template(reason, (d) => formatDay(d, ui));
}
