// Port of valioaimo gateway/playbook/insights.py: Insights and Settings for the app, in plain kitchen language.
// Statements are computed from the buyer's memory (outcome labels per line); the weekly 'left over' series is the
// source's seeded demo series. tips() is recall.tips from gateway/playbook/recall.py, which for_buyer uses.
import { memoryOf, productName, type Buyer, type Memory } from './data';
import { roundHalfEven } from './math';

/** Share of ordered food that was left over, per week (seeded, 8 weeks to 13 Nov 2026). */
const WASTE_SERIES: Record<string, number[]> = {
  'BUY-POHJOLA': [9.8, 9.1, 8.7, 8.9, 7.6, 7.2, 6.4, 5.9],
  'BUY-KOULU': [6.1, 6.0, 5.8, 5.9, 5.5, 5.2, 5.4, 5.0],
  'BUY-KAARI': [4.2, 4.0, 4.4, 4.1, 3.9, 3.8, 3.6, 3.7],
  'BUY-UUSI': [],
};
const WEEKS = ['21.9.', '28.9.', '5.10.', '12.10.', '19.10.', '26.10.', '2.11.', '9.11.'];

interface Tip { tipId: string; need: string; eventType: string; factor: number; cutPct: number; n: number }

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** 'Last 3 galas used less cream — order 10% less?' when a need was over-ordered 3 times in a row. */
export function tips({ memory, eventType }: { memory: Memory; eventType: string | null }): Tip[] {
  if (!eventType) return [];
  const runs = new Map<string, Memory['orders'][number]['lines']>();
  const orders = [...memory.orders].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const o of orders) {
    if (o.eventType !== eventType) continue;
    for (const l of o.lines) runs.set(l.need, [...(runs.get(l.need) ?? []), l]);
  }
  const out: Tip[] = [];
  for (const [need, ls] of runs) {
    const last = ls.slice(-3);
    if (last.length === 3 && last.every((l) => l.label === 'over_ordered')) {
      const used = median(last.map((l) => l.usage ?? 1));
      const cut = Math.max(5, Math.min(30, roundHalfEven(((1 - used) * 100) / 5) * 5));
      out.push({ tipId: `TIP-${need.replaceAll(' ', '-')}`, need, eventType, factor: Math.round((1 - cut / 100) * 100) / 100, cutPct: cut, n: 3 });
    }
  }
  return out;
}

export interface Statement { id: string; tone: 'good' | 'watch' | 'neutral'; text: string; detail: string }

/** decisions: the gateway decision of each of the buyer's ordering sessions (auto, tell_me, needs_ok, blocked). */
export function forBuyer({ buyerId, decisions }: { buyerId: string; decisions: string[] }) {
  const mem = memoryOf(buyerId);
  const lines = mem.orders.flatMap((o) => o.lines);
  const right = lines.filter((l) => l.label === 'right_sized' || l.label === 'good_substitute').length;
  const series = WASTE_SERIES[buyerId] ?? [];
  const statements: Statement[] = [];
  if (series.length >= 8) {
    const a = series.slice(0, 4).reduce((s, v) => s + v, 0) / 4;
    const b = series.slice(4).reduce((s, v) => s + v, 0) / 4;
    statements.push({ id: 'waste', tone: b < a ? 'good' : 'watch',
      text: b < a ? 'Heitit tässä kuussa vähemmän pois.' : 'Tässä kuussa jäi hieman enemmän yli.',
      detail: b < a ? `Noin ${roundHalfEven((Math.abs(a - b) / a) * 100)} % vähemmän hävikkiä kuin edellisessä kuussa.` : '' });
  }
  if (lines.length) {
    statements.push({ id: 'right', tone: 'good', text: `${roundHalfEven((right / lines.length) * 100)} % tilaamastasi oli sopiva määrä.`,
      detail: 'Laskettu siitä, mitä tiimisi merkitsi kohdassa ”Miten meni?”.' });
  }
  const auto = decisions.filter((d) => d === 'auto' || d === 'tell_me').length;
  const total = decisions.length;
  statements.push({ id: 'ok', tone: 'neutral',
    text: !total || auto / total >= 0.5 ? 'Useimmat tilaukset menivät läpi odottamatta hyväksyntää.' : 'Moni tilaus tarvitsi tällä viikolla hyväksynnän.',
    detail: 'Rajojesi sisällä olevat tilaukset menevät suoraan Valio Aimolle.' });
  const favs = mem.favourites.map((f) => productName(f.key)).slice(0, 3);
  if (favs.length) {
    statements.push({ id: 'fav', tone: 'neutral', text: `Suosikkisi käytetään ensin: ${favs[0]}${favs.length > 1 ? ' ja muut.' : '.'}`,
      detail: 'Muuta niitä asetuksissa.' });
  }
  const tipList: Array<{ text: string; tipId: string | null }> = [];
  const eventTypes = [...new Set(mem.orders.flatMap((o) => (o.eventType ? [o.eventType] : [])))].sort();
  for (const et of eventTypes) {
    for (const t of tips({ memory: mem, eventType: et })) {
      tipList.push({ text: `Kolmella viimeisellä tapahtumalla (${et}) tuotetta ”${t.need}” jäi yli. Tilaa ensi kerralla ${t.cutPct} % vähemmän?`, tipId: t.tipId });
    }
  }
  if (buyerId === 'BUY-POHJOLA' && !tipList.length) {
    tipList.push({ text: 'Lohiannoksesi ovat kohdillaan. Pidä sama määrä seuraavaan gaalaan.', tipId: null });
  }
  return { statements: statements.slice(0, 4),
    chart: { title: 'Hävikki', unit: '%', labels: series.length ? WEEKS.slice(-series.length) : [], values: series },
    tips: tipList.slice(0, 3) };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function settings({ buyer, all, liveApi }: { buyer: Buyer; all: Buyer[]; liveApi: boolean }) {
  const lim = buyer.mandate.limits;
  return {
    buyer: { id: buyer.id, name: buyer.name, site: buyer.site.name, segment: buyer.segment },
    buyers: all.map((x) => ({ id: x.id, name: x.name, segment: x.segment })),
    favourites: memoryOf(buyer.id).favourites.map((f) => ({ name: productName(f.key), pinned: Boolean(f.pinned) })),
    limits: [{ label: 'Tilausta kohti', value: lim.perOrderEUR }, { label: 'Tapahtumaa kohti', value: lim.perEventEUR ?? null },
      { label: 'Kuukaudessa', value: lim.perMonthEUR }],
    allergens: buyer.mandate.hardExclusions.allergens.map(cap),
    approvers: buyer.approvers.map((a) => ({ name: a.name, role: a.role })),
    liveApi,
  };
}
