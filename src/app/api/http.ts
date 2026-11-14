import { NextResponse } from 'next/server';
import { ZodError, type ZodType } from 'zod';
import { NotFoundError } from '@/server/orders';
import { ValioUnavailableError } from '@/valio/client';

export const jsonError = (message: string, status: number) => NextResponse.json({ error: message }, { status });

/** Parses a JSON body; returns the value or a ready 400 response. */
export async function parseBody<T>(req: Request, schema: ZodType<T>): Promise<{ data: T } | { error: NextResponse }> {
  let raw: unknown;
  try { raw = await req.json(); } catch { return { error: jsonError('Request body must be JSON', 400) }; }
  const r = schema.safeParse(raw);
  return r.success ? { data: r.data } : { error: jsonError(`Invalid request: ${r.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`, 400) };
}

export function parseQuery<T>(req: Request, schema: ZodType<T>): { data: T } | { error: NextResponse } {
  const r = schema.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  return r.success ? { data: r.data } : { error: jsonError('Invalid query parameters', 400) };
}

/** Maps thrown errors to safe JSON; details stay in the server log. */
export function failure(e: unknown): NextResponse {
  if (e instanceof NotFoundError) return jsonError(e.message, 404);
  if (e instanceof ZodError) return jsonError('Invalid request', 400);
  if (e instanceof ValioUnavailableError) {
    console.error(e);
    return jsonError('Valio prices and stock can’t be reached right now. Please try again in a moment.', 503);
  }
  console.error(e);
  return jsonError('Something went wrong. Please try again.', 500);
}
