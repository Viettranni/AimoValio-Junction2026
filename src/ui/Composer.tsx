'use client';

import { useEffect, useRef } from 'react';
import type { UiLang } from '@/contracts';
import { t } from './i18n';
import { SendIcon } from './icons';

export function Composer({
  value,
  onChange,
  onSubmit,
  placeholder,
  disabled,
  focusKey,
  lang,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (text: string) => void;
  placeholder: string;
  disabled?: boolean;
  /** Changing this focuses the input, e.g. after a slot chip prefilled it. */
  focusKey?: number;
  lang: UiLang;
}) {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focusKey) input.current?.focus();
  }, [focusKey]);

  const submit = () => {
    if (disabled || !value.trim()) return;
    onSubmit(value.trim());
    onChange('');
  };

  return (
    <form
      className="flex items-center gap-1.5 rounded-full border border-line bg-white py-1 pl-3.5 pr-1 transition-colors focus-within:border-blue"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input
        ref={input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent py-1.5 focus-visible:outline-none text-[13px] text-navy outline-none placeholder:text-muted"
      />
      <button
        type="submit"
        disabled={disabled || !value.trim()}
        aria-label={t('composer.send', lang)}
        className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-blue text-white transition-[background-color,opacity] hover:bg-blue-hover disabled:opacity-30"
      >
        <SendIcon size={15} strokeWidth={2.2} />
      </button>
    </form>
  );
}
