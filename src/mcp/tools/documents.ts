// The buyer's own order notes for agents: a photo of handwritten notes, a PDF, an Excel sheet, a CSV or pasted text
// → event details and an ingredient list, the slots still missing and the questions to ask. Same reader as the widget.
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ToolError } from './safe';

const service = () => import('@/server/document');

/** Only public https URLs: no local or private-network hosts (the gateway must not fetch its own neighbours). */
export function fetchableUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new ToolError('fileUrl is not a valid URL.'); }
  const host = url.hostname.toLowerCase();
  const privateHost = host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || host === '[::1]'
    || /^(127|10|0)\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || /^\[(fc|fd|fe80)/i.test(host);
  if (url.protocol !== 'https:' || privateHost) throw new ToolError('fileUrl must be a public https:// link.');
  return url;
}

export const readOrderDocumentTool = createTool({
  id: 'readOrderDocument',
  description:
    "Read the buyer's own order notes: a photo of handwritten notes, a PDF, an Excel sheet (.xlsx), a CSV, or the notes as text. " +
    'Give exactly one of: text (notes or spreadsheet rows you already read, e.g. pasted CSV), fileBase64 (+ filename), or fileUrl (public https). ' +
    'Returns what the document states (event, date, guests, diets, ingredients with any amounts), the slots still missing, questions to ask the buyer ' +
    'and, for an event, the planEvent arguments so far. Nothing is guessed: ask the questions, then call planEvent (or, for a shopping list with ' +
    'amounts, searchProducts → getPriceAndAvailability → requestOffer). Takes 5–20 s.',
  inputSchema: z.object({
    text: z.string().max(40_000).optional(),
    fileBase64: z.string().max(11_000_000).optional().describe('The file, base64-encoded (at most 8 MB)'),
    fileUrl: z.string().max(2000).optional(),
    filename: z.string().max(200).optional().describe('e.g. "juhlat.xlsx" or "lappu.jpg"; tells the file type'),
    mimeType: z.string().max(100).optional(),
  }),
  mcp: { annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true } },
  execute: async ({ text, fileBase64, fileUrl, filename, mimeType }) => {
    const given = [text, fileBase64, fileUrl].filter((x) => x !== undefined && x !== '').length;
    if (given !== 1) throw new ToolError('Give exactly one of text, fileBase64 or fileUrl.');
    const { DocumentError, documentContent, readDocument, MAX_DOCUMENT_BYTES } = await service();
    const { now } = await import('@/db/repo');
    try {
      let content;
      if (text) {
        content = { kind: 'text' as const, text, source: filename ? `file "${filename}"` : 'notes' };
      } else if (fileBase64) {
        content = await documentContent(Buffer.from(fileBase64, 'base64'), filename ?? 'file', mimeType ?? '');
      } else {
        const url = fetchableUrl(fileUrl!);
        const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(20_000) });
        if (!res.ok) throw new ToolError(`Could not download the file (HTTP ${res.status}).`);
        if (Number(res.headers.get('content-length') ?? 0) > MAX_DOCUMENT_BYTES) throw new ToolError('The file is too large (at most 8 MB).');
        const bytes = new Uint8Array(await res.arrayBuffer());
        const name = filename ?? url.pathname.split('/').pop() ?? 'file';
        content = await documentContent(bytes, name, mimeType ?? res.headers.get('content-type')?.split(';')[0] ?? '');
      }
      const reading = await readDocument(content, now().toISOString().slice(0, 10));
      const x = reading.extraction;
      const planEventArgs = reading.shoppingList ? undefined : {
        ...(x.deliveryDate ? { deliveryDate: x.deliveryDate } : {}),
        ...(x.guests ? { guests: x.guests } : {}),
        menu: x.items.map((i) => i.name),
        ...(x.diets.every((d) => d.guests !== null) && x.diets.length ? { diets: x.diets } : {}),
        ...(x.budget !== null ? { budget: x.budget } : {}),
        ...(x.eventType ? { eventType: x.eventType } : {}),
        ...(x.eventName ? { eventName: x.eventName } : {}),
        lang: x.lang,
      };
      return { ...reading, ...(planEventArgs ? { planEventArgs } : {}) };
    } catch (e) {
      if (e instanceof DocumentError) throw new ToolError(e.message);
      throw e;
    }
  },
});

export const documentTools = [readOrderDocumentTool] as const;
