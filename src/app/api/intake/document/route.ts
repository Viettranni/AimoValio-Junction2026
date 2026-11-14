// POST /api/intake/document (multipart: file, lang?) → what the widget read from the buyer's notes (photo, PDF,
// Excel, CSV): the chat message to send, the slots still missing and the extraction. See src/server/document.ts.
import { now } from '@/db/repo';
import { DocumentError, MAX_DOCUMENT_BYTES, documentContent, documentMessage, readDocument } from '@/server/document';
import { failure, jsonError } from '../../http';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_DOCUMENT_BYTES + 100_000) {
    return jsonError(`The file is too large (at most ${MAX_DOCUMENT_BYTES / 1_000_000} MB).`, 413);
  }
  let form: FormData;
  try { form = await request.formData(); } catch { return jsonError('Send the file as multipart form data (field "file").', 400); }
  const file = form.get('file');
  if (!(file instanceof File)) return jsonError('Missing the "file" field.', 400);
  const lang = typeof form.get('lang') === 'string' ? (form.get('lang') as string) : undefined;
  try {
    const content = await documentContent(new Uint8Array(await file.arrayBuffer()), file.name || 'notes', file.type);
    const reading = await readDocument(content, now().toISOString().slice(0, 10));
    return Response.json({ ...reading, message: documentMessage(reading.extraction, file.name || 'notes', lang) });
  } catch (e) {
    if (e instanceof DocumentError) return jsonError(e.message, 422);
    return failure(e);
  }
}
