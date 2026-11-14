'use client';

// Speech to text for the composer with the browser's Web Speech API (Chrome, Edge, Safari; not Firefox). No server or
// key: the browser does the recognition (Chrome sends the audio to Google's speech service). The words appear in the
// input as they are recognised and stay there for the buyer to check and send.
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';

interface Alternative { transcript: string }
interface Result { isFinal: boolean; 0: Alternative; length: number }
interface RecognitionEvent { resultIndex: number; results: { length: number; [i: number]: Result } }
interface Recognition {
  lang: string; continuous: boolean; interimResults: boolean;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type RecognitionCtor = new () => Recognition;
const noSubscribe = () => () => {};

const recognitionCtor = (): RecognitionCtor | null => {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

/** Joins what was typed before listening with what is being said. */
export function joinSpoken(before: string, spoken: string): string {
  const s = spoken.replace(/\s+/g, ' ').trim();
  if (!s) return before;
  return before.trim() ? `${before.trimEnd()} ${s}` : s.charAt(0).toUpperCase() + s.slice(1);
}

export type SpeechError = 'denied' | 'no-speech' | 'failed' | null;

export function useSpeechInput({ locale, value, onChange }: { locale: string; value: string; onChange: (v: string) => void }) {
  // Whether the browser can do it never changes while the page is open; false on the server.
  const supported = useSyncExternalStore(noSubscribe, () => !!recognitionCtor(), () => false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<SpeechError>(null);
  const rec = useRef<Recognition | null>(null);
  const base = useRef('');
  const latest = useRef({ onChange, value });
  useLayoutEffect(() => { latest.current = { onChange, value }; });
  useEffect(() => () => rec.current?.abort(), []);

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor || rec.current) return;
    const r = new Ctor();
    r.lang = locale;
    r.continuous = true;
    r.interimResults = true;
    base.current = latest.current.value;
    let finalText = '';
    r.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) finalText += `${res[0].transcript} `;
        else interim += res[0].transcript;
      }
      latest.current.onChange(joinSpoken(base.current, `${finalText}${interim}`));
    };
    r.onerror = (e) => {
      setError(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'no-speech' ? 'no-speech' : e.error === 'aborted' ? null : 'failed');
    };
    r.onend = () => { rec.current = null; setListening(false); };
    setError(null);
    rec.current = r;
    try {
      r.start();
      setListening(true);
    } catch {
      rec.current = null;
      setError('failed');
    }
  }, [locale]);

  return { supported, listening, error, start, stop, toggle: () => (rec.current ? stop() : start()) };
}
