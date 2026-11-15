'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { UiLang } from '@/contracts';
import { t } from './i18n';
import { MicIcon, PaperclipIcon, SendIcon } from './icons';
import {
  SPEECH_LANGUAGES, localeShort, readPickedSpeechLang, resolveSpeechLocale, savePickedSpeechLang, subscribePickedSpeechLang,
} from './speechLanguages';
import { useSpeechInput } from './useSpeechInput';

const noSubscribe = () => () => {};

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  focusKey,
  lang,
  onAttach,
  reading,
  speechLang,
  roomy,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void;
  placeholder: string;
  disabled?: boolean;
  /** Changing this focuses the input, e.g. after a slot chip prefilled it. */
  focusKey?: number;
  lang: UiLang;
  /** Shows a paperclip for the buyer's notes (photo, Excel, PDF, CSV). */
  onAttach?: (file: File) => void;
  /** An attached document is being read. */
  reading?: boolean;
  /** The conversation's language as detected from what the buyer wrote (any code, e.g. "et"), for the mic. */
  speechLang?: string | null;
  /** The Orders page: a taller, filled field with a plain arrow, as in the design. */
  roomy?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const picked = useSyncExternalStore(subscribePickedSpeechLang, readPickedSpeechLang, () => null);
  const browserLang = useSyncExternalStore(noSubscribe, () => navigator.language, () => null);
  const locale = resolveSpeechLocale(picked, speechLang, browserLang);
  const speech = useSpeechInput({ locale, value, onChange });
  useEffect(() => {
    if (focusKey) input.current?.focus();
  }, [focusKey]);

  const submit = () => {
    if (speech.listening) speech.stop();
    if (disabled || !value.trim()) return;
    onSubmit(value.trim());
    onChange('');
  };

  return (
    <form
      className={`flex items-center gap-1.5 border transition-colors focus-within:border-blue ${
        roomy ? 'rounded-2xl border-transparent bg-ice py-2 pl-5 pr-2' : 'rounded-full border-line bg-white py-1 pl-3.5 pr-1'
      }`}
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {onAttach && (
        <>
          <input
            ref={fileInput}
            type="file"
            accept="image/*,.pdf,.xlsx,.csv,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) onAttach(file);
            }}
          />
          <button
            type="button"
            disabled={disabled || reading}
            onClick={() => fileInput.current?.click()}
            aria-label={t('composer.attach', lang)}
            title={t('composer.attach', lang)}
            className="-ml-1.5 flex h-8 w-8 flex-none items-center justify-center rounded-full text-muted transition-colors hover:bg-ice hover:text-blue disabled:opacity-30"
          >
            <PaperclipIcon size={16} className={reading ? 'animate-pulse text-blue' : undefined} />
          </button>
        </>
      )}
      {speech.supported && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => { speech.toggle(); input.current?.focus(); }}
          aria-pressed={speech.listening}
          aria-label={t(speech.listening ? 'composer.micStop' : 'composer.mic', lang)}
          title={t(speech.listening ? 'composer.micStop' : 'composer.mic', lang)}
          className={`flex h-8 w-8 flex-none items-center justify-center rounded-full transition-colors disabled:opacity-30 ${
            speech.listening ? 'bg-red-500 text-white motion-safe:animate-pulse' : 'text-muted hover:bg-ice hover:text-blue'
          } ${onAttach ? '' : '-ml-1.5'}`}
        >
          <MicIcon size={16} />
        </button>
      )}
      {speech.supported && (
        <label
          title={t('composer.micLang', lang)}
          className="relative -ml-1 flex h-6 flex-none items-center rounded-md px-1 text-[10.5px] font-semibold tracking-wide text-muted hover:bg-ice hover:text-blue"
        >
          {localeShort(locale)}
          <select
            aria-label={t('composer.micLang', lang)}
            value={picked ?? ''}
            disabled={speech.listening}
            onChange={(e) => savePickedSpeechLang(e.target.value || null)}
            className="absolute inset-0 cursor-pointer opacity-0"
          >
            <option value="">{t('composer.micLangAuto', lang, { lang: localeShort(resolveSpeechLocale(null, speechLang, browserLang)) })}</option>
            {SPEECH_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
          </select>
        </label>
      )}
      <input
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={reading ? t('document.reading', lang) : speech.listening ? t('composer.listening', lang)
          : speech.error ? t(`composer.mic.${speech.error}`, lang) : placeholder}
        aria-label={placeholder}
        className={`min-w-0 flex-1 bg-transparent py-1.5 text-navy outline-none placeholder:text-muted focus-visible:outline-none ${roomy ? 'text-[15px]' : 'text-[13px]'}`}
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        aria-label={t('composer.send', lang)}
        className={`flex flex-none items-center justify-center rounded-full transition-[background-color,opacity] disabled:opacity-30 ${
          roomy ? 'h-9 w-9 text-navy hover:bg-sky' : 'h-8 w-8 bg-blue text-white hover:bg-blue-hover'
        }`}
      >
        <SendIcon size={15} strokeWidth={2.2} />
      </button>
    </form>
  );
}
