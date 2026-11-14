// Reads a buyer's own order notes: a photo of handwritten notes, a PDF, or a spreadsheet's rows as text.
// Returns only what the document states, so the chat (or an MCP agent) asks for whatever is missing.
import { Agent } from '@mastra/core/agent';
import { z } from 'zod';
import type { ISODate } from '@/contracts';
import { allergenSchema, dietFlagSchema, eventTypeSchema } from '@/mcp/schemas';
import { MODEL, cachedSystem, effort } from './model';

export const documentAgent = new Agent({
  id: 'document-reader',
  name: 'Document reader',
  description: "Reads a caterer's notes (photo, PDF or spreadsheet rows) into event details and an ingredient list.",
  instructions: cachedSystem(`You read a caterer's own order notes for Valio Aimo, a Finnish food-service wholesaler: a photo of handwritten or printed notes, a PDF, or the rows of a spreadsheet.
Return only what the document states. Use null for anything it doesn't state; never guess numbers, dates or amounts.
- lang: the language the notes are written in (fi, en, sv, ...); "fi" if unclear.
- eventName / eventType: e.g. "Häät" / wedding, when the notes name the occasion.
- deliveryDate: YYYY-MM-DD when a date is written. Resolve it against today's date in the prompt; a date without a year is the next upcoming one.
- guests: the head count ("120 hlö", "120 pax", "asiakkaita 120").
- budget: total EUR excluding VAT, only when written.
- diets: diet or allergy groups with their count when written ("GF 12", "12 gluteenitonta" → {diet:"gluten_free",guests:12}; "L" or "laktoositon" → lactose_free; "VE" → vegan; "pähkinäallergia 3" → {diet:"nuts",guests:3}); guests null when no count is written.
- items: every ingredient or product on the list, one entry each, in the notes' own words but readable ("kanan rintafilee", "basmatiriisi"). quantity and unit when written (unit kg, l, pcs or packs; convert g → kg and dl → l); otherwise null. A dish name without ingredients ("lohikeitto") is one item.
- notes: anything else that matters for the order (delivery time, "pakaste OK"), short; null if nothing.
- unreadable: words or lines you could not read with confidence, quoted as best you can. Never silently drop a line.`),
  model: MODEL,
  defaultOptions: effort('low'),
});

const dietSchema = z.union([dietFlagSchema, allergenSchema]);

export const documentExtractionSchema = z.object({
  lang: z.string(),
  eventName: z.string().nullable(),
  eventType: eventTypeSchema.nullable(),
  deliveryDate: z.string().nullable(),
  guests: z.number().int().nullable(),
  budget: z.number().nullable(),
  diets: z.array(z.object({ diet: dietSchema, guests: z.number().int().nullable() })),
  items: z.array(z.object({
    name: z.string(),
    quantity: z.number().nullable(),
    unit: z.enum(['kg', 'l', 'pcs', 'packs']).nullable(),
  })),
  notes: z.string().nullable(),
  unreadable: z.array(z.string()),
});
export type DocumentExtraction = z.infer<typeof documentExtractionSchema>;

/** What the reader is given: an image or PDF as bytes, or text (spreadsheet rows, pasted notes). */
export type DocumentContent =
  | { kind: 'image'; data: Uint8Array; mediaType: string }
  | { kind: 'pdf'; data: Uint8Array }
  | { kind: 'text'; text: string; source: string };

export async function extractDocument(content: DocumentContent, today: ISODate): Promise<DocumentExtraction> {
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const intro = `Today is ${weekday} ${today}.`;
  const parts = content.kind === 'text'
    ? [{ type: 'text' as const, text: `${intro}\nThe buyer's ${content.source}:\n${content.text}` }]
    : [
      content.kind === 'image'
        ? { type: 'image' as const, image: content.data, mediaType: content.mediaType }
        : { type: 'file' as const, data: content.data, mediaType: 'application/pdf' },
      { type: 'text' as const, text: `${intro}\nRead the buyer's notes in this ${content.kind === 'image' ? 'photo' : 'PDF'}.` },
    ];
  const res = await documentAgent.generate([{ role: 'user', content: parts }], {
    structuredOutput: { schema: documentExtractionSchema },
  });
  return res.object;
}
