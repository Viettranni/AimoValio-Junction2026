// Order documents in, order details out: a photo of handwritten notes, a PDF, an Excel sheet or CSV (in the chat
// widget via POST /api/intake/document, for MCP agents via readOrderDocument). The reader (src/mastra/agents/document.ts)
// returns only what the document states; this file turns that into the buyer's chat message, the slots still missing
// and the questions to ask, so nothing is guessed.
import readXlsxFile from 'read-excel-file/node';
import type { ISODate, IntakeSlot, UiLang } from '@/contracts';
import { dietLabel, uiLangFor } from '@/ui/i18n';
import { extractDocument, type DocumentContent, type DocumentExtraction } from '@/mastra/agents/document';

/** Largest upload accepted (a phone photo is resized in the browser first). */
export const MAX_DOCUMENT_BYTES = 8_000_000;
const MAX_SHEET_ROWS = 400;
const MAX_TEXT_CHARS = 40_000;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export class DocumentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentError';
  }
}

/** The type from the file name when the browser or agent sent none (or a generic one). */
export function documentType(filename: string, mimeType: string): string {
  const ext = filename.toLowerCase().split('.').pop() ?? '';
  const byExt: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
    pdf: 'application/pdf', xlsx: XLSX, csv: 'text/csv', tsv: 'text/tab-separated-values', txt: 'text/plain', xls: 'application/vnd.ms-excel',
  };
  return mimeType && mimeType !== 'application/octet-stream' ? mimeType : byExt[ext] ?? mimeType;
}

const cellText = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).replace(/\s+/g, ' ').trim();
};

/** Spreadsheet sheets as tab-separated text, empty rows and columns dropped, at most MAX_SHEET_ROWS rows. */
export function sheetsToText(sheets: Array<{ sheet: string; data: unknown[][] }>): string {
  const out: string[] = [];
  let rows = 0;
  for (const { sheet, data } of sheets) {
    const lines = data.map((r) => r.map(cellText)).filter((r) => r.some(Boolean));
    if (!lines.length) continue;
    out.push(`# Sheet: ${sheet}`);
    for (const r of lines) {
      if (rows++ >= MAX_SHEET_ROWS) { out.push('… (more rows not read)'); return out.join('\n'); }
      while (r.length && !r[r.length - 1]) r.pop();
      out.push(r.join('\t'));
    }
  }
  return out.join('\n');
}

/** Bytes plus type → what the reader is given. Throws DocumentError for unsupported or empty files. */
export async function documentContent(bytes: Uint8Array, filename: string, mimeType: string): Promise<DocumentContent> {
  if (!bytes.byteLength) throw new DocumentError('The file is empty.');
  if (bytes.byteLength > MAX_DOCUMENT_BYTES) throw new DocumentError(`The file is too large (at most ${MAX_DOCUMENT_BYTES / 1_000_000} MB).`);
  const type = documentType(filename, mimeType);
  if (IMAGE_TYPES.has(type)) return { kind: 'image', data: bytes, mediaType: type };
  if (type === 'application/pdf') return { kind: 'pdf', data: bytes };
  if (type === XLSX) {
    let sheets;
    try { sheets = await readXlsxFile(Buffer.from(bytes)); } catch { throw new DocumentError('The Excel file could not be opened.'); }
    const text = sheetsToText(sheets);
    if (!text) throw new DocumentError('The Excel file has no rows.');
    return { kind: 'text', text, source: `spreadsheet "${filename}"` };
  }
  if (type === 'application/vnd.ms-excel') throw new DocumentError('Old .xls files are not supported; save it as .xlsx or .csv.');
  if (type.startsWith('text/')) {
    const text = new TextDecoder().decode(bytes).slice(0, MAX_TEXT_CHARS).trim();
    if (!text) throw new DocumentError('The file has no text.');
    return { kind: 'text', text, source: type === 'text/plain' ? 'notes' : `table "${filename}"` };
  }
  throw new DocumentError('Send a photo (JPG, PNG), a PDF, an Excel file (.xlsx) or a CSV.');
}

// ── What is still missing ──

/** An order with amounts on (nearly) every item is a shopping list; otherwise the amounts come from the guest count. */
export function isShoppingList(x: DocumentExtraction): boolean {
  if (!x.items.length) return false;
  const withAmount = x.items.filter((i) => i.quantity !== null).length;
  return withAmount / x.items.length >= 0.75;
}

export function missingSlots(x: DocumentExtraction): IntakeSlot[] {
  const missing: IntakeSlot[] = [];
  if (!x.deliveryDate) missing.push('deliveryDate');
  if (isShoppingList(x)) return missing;
  if (!x.guests) missing.push('guests');
  if (!x.items.length) missing.push('menu');
  if (x.budget === null) missing.push('budget');
  if (!x.diets.length || x.diets.some((d) => d.guests === null)) missing.push('diets');
  return missing;
}

/** Questions for an agent to ask the buyer, in English (the agent words them for its user). */
export function documentQuestions(x: DocumentExtraction): string[] {
  const q: string[] = [];
  const missing = missingSlots(x);
  if (missing.includes('deliveryDate')) q.push('Which day should it be delivered?');
  if (missing.includes('guests')) q.push('How many guests?');
  if (missing.includes('menu')) q.push('What should be on the menu?');
  if (missing.includes('budget')) q.push('Is there a budget (EUR excl. VAT), or no limit?');
  const uncounted = x.diets.filter((d) => d.guests === null).map((d) => dietLabel(d.diet, 'en'));
  if (uncounted.length) q.push(`How many guests are ${uncounted.join(', ')}?`);
  else if (missing.includes('diets')) q.push('Any allergies or special diets, and for how many guests?');
  if (x.unreadable.length) q.push(`Some lines could not be read: ${x.unreadable.map((u) => `"${u}"`).join(', ')}. What do they say?`);
  return q;
}

// ── The buyer's chat message ──

const LABELS: Record<UiLang, Record<'from' | 'event' | 'guests' | 'date' | 'budget' | 'diets' | 'items' | 'notes' | 'unreadable', string>> = {
  en: { from: 'From my notes', event: 'Event', guests: 'guests', date: 'Delivery', budget: 'Budget', diets: 'Diets', items: 'Ingredients', notes: 'Notes', unreadable: 'Could not read' },
  fi: { from: 'Muistiinpanoistani', event: 'Tilaisuus', guests: 'vierasta', date: 'Toimitus', budget: 'Budjetti', diets: 'Ruokavaliot', items: 'Raaka-aineet', notes: 'Huom', unreadable: 'Ei saatu selvää' },
  sv: { from: 'Från mina anteckningar', event: 'Tillställning', guests: 'gäster', date: 'Leverans', budget: 'Budget', diets: 'Specialkost', items: 'Råvaror', notes: 'Obs', unreadable: 'Gick inte att läsa' },
};

const amount = (q: number, unit: string) => `${Number.isInteger(q) ? q : Math.round(q * 100) / 100} ${unit}`;

/** What was read, as the message the buyer sends: they see it, and the assistant asks only for what is missing. */
export function documentMessage(x: DocumentExtraction, filename: string, lang?: string): string {
  const ui = uiLangFor(lang ?? x.lang);
  const L = LABELS[ui];
  const lines = [`${L.from} (${filename}):`];
  const event = [x.eventName, x.guests ? `${x.guests} ${L.guests}` : null].filter(Boolean).join(', ');
  if (event) lines.push(`• ${L.event}: ${event}`);
  if (x.deliveryDate) lines.push(`• ${L.date}: ${x.deliveryDate}`);
  if (x.budget !== null) lines.push(`• ${L.budget}: ${x.budget} €`);
  if (x.diets.length) {
    lines.push(`• ${L.diets}: ${x.diets.map((d) => (d.guests !== null ? `${d.guests} ${dietLabel(d.diet, ui)}` : dietLabel(d.diet, ui))).join(', ')}`);
  }
  if (x.items.length) {
    lines.push(`• ${L.items}: ${x.items.map((i) => (i.quantity !== null ? `${i.name} ${amount(i.quantity, i.unit ?? '')}`.trim() : i.name)).join('; ')}`);
  }
  if (x.notes) lines.push(`• ${L.notes}: ${x.notes}`);
  if (x.unreadable.length) lines.push(`• ${L.unreadable}: ${x.unreadable.map((u) => `"${u}"`).join(', ')}`);
  return lines.join('\n');
}

export interface DocumentReading {
  extraction: DocumentExtraction;
  shoppingList: boolean;
  missing: IntakeSlot[];
  questions: string[];
}

export async function readDocument(content: DocumentContent, today: ISODate): Promise<DocumentReading> {
  const extraction = await extractDocument(content, today);
  if (!extraction.items.length && !extraction.guests && !extraction.eventName) {
    throw new DocumentError('No order details could be read from it. Is it the right file, and is the photo sharp?');
  }
  return { extraction, shoppingList: isShoppingList(extraction), missing: missingSlots(extraction), questions: documentQuestions(extraction) };
}
