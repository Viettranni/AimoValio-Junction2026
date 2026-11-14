// Which language the mic listens in. The browser's recogniser needs one language up front (it does not detect it), so:
// the buyer's own pick (remembered in this browser) → the chat's language once known → the browser's language.

/** Languages offered in the mic's picker, by the name a speaker of it would look for. */
export const SPEECH_LANGUAGES: Array<{ code: string; label: string; short: string }> = [
  { code: 'fi-FI', label: 'Suomi', short: 'FI' },
  { code: 'sv-FI', label: 'Svenska', short: 'SV' },
  { code: 'en-GB', label: 'English', short: 'EN' },
  { code: 'et-EE', label: 'Eesti', short: 'ET' },
  { code: 'ru-RU', label: 'Русский', short: 'RU' },
  { code: 'uk-UA', label: 'Українська', short: 'UK' },
  { code: 'de-DE', label: 'Deutsch', short: 'DE' },
  { code: 'fr-FR', label: 'Français', short: 'FR' },
  { code: 'es-ES', label: 'Español', short: 'ES' },
  { code: 'it-IT', label: 'Italiano', short: 'IT' },
  { code: 'pl-PL', label: 'Polski', short: 'PL' },
  { code: 'tr-TR', label: 'Türkçe', short: 'TR' },
  { code: 'ar-SA', label: 'العربية', short: 'AR' },
  { code: 'fa-IR', label: 'فارسی', short: 'FA' },
  { code: 'so-SO', label: 'Soomaali', short: 'SO' },
  { code: 'vi-VN', label: 'Tiếng Việt', short: 'VI' },
  { code: 'th-TH', label: 'ไทย', short: 'TH' },
  { code: 'zh-CN', label: '中文', short: 'ZH' },
];

const DEFAULT_REGION: Record<string, string> = Object.fromEntries(SPEECH_LANGUAGES.map((l) => [l.code.split('-')[0], l.code]));

/** A language code ("et", "fi", "en-US", "pt_BR") → a recogniser locale ("et-EE", "fi-FI", "en-US", "pt-BR"). */
export function speechLocale(code: string | null | undefined): string {
  const clean = (code ?? '').trim().replace('_', '-');
  if (!clean) return 'en-GB';
  const [base, region] = clean.split('-');
  if (region) return `${base.toLowerCase()}-${region.toUpperCase()}`;
  return DEFAULT_REGION[base.toLowerCase()] ?? base.toLowerCase();
}

/** The buyer's pick wins; otherwise the chat's language; otherwise the browser's. */
export function resolveSpeechLocale(picked: string | null, chatLang: string | null | undefined, browserLang: string | null | undefined): string {
  if (picked) return speechLocale(picked);
  // The browser's own regional variant beats a guessed one when both are the same language ("fi" + "fi-FI").
  const chat = chatLang?.split(/[-_]/)[0].toLowerCase();
  const browser = browserLang?.split(/[-_]/)[0].toLowerCase();
  if (chat && chat !== browser) return speechLocale(chatLang);
  return speechLocale(browserLang || chatLang);
}

/** "FI", "ET", … for the chip next to the mic. */
export const localeShort = (locale: string) => SPEECH_LANGUAGES.find((l) => l.code === locale)?.short ?? locale.split('-')[0].toUpperCase();

const KEY = 'aimo.speechLang';
const EVENT = 'aimo-speech-lang';

/** The buyer's remembered pick (this browser only), or null for automatic. */
export function readPickedSpeechLang(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function savePickedSpeechLang(code: string | null): void {
  try { if (code) localStorage.setItem(KEY, code); else localStorage.removeItem(KEY); } catch { /* private mode: not remembered */ }
  window.dispatchEvent(new Event(EVENT));
}
/** For useSyncExternalStore: a pick made here or in another tab. */
export function subscribePickedSpeechLang(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => { window.removeEventListener(EVENT, onChange); window.removeEventListener('storage', onChange); };
}
