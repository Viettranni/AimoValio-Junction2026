import { describe, expect, it } from 'vitest';
import { localeShort, resolveSpeechLocale, speechLocale } from './speechLanguages';

describe('mic language', () => {
  it('turns language codes into recogniser locales', () => {
    expect(speechLocale('fi')).toBe('fi-FI');
    expect(speechLocale('et')).toBe('et-EE');
    expect(speechLocale('en-us')).toBe('en-US');
    expect(speechLocale('pt_BR')).toBe('pt-BR');
    expect(speechLocale('ka')).toBe('ka');
    expect(speechLocale('')).toBe('en-GB');
  });

  it('prefers the pick, then the chat language, then the browser', () => {
    expect(resolveSpeechLocale('ru-RU', 'fi', 'en-GB')).toBe('ru-RU');
    expect(resolveSpeechLocale(null, 'et', 'en-GB')).toBe('et-EE');
    expect(resolveSpeechLocale(null, 'fi', 'fi-FI')).toBe('fi-FI');
    expect(resolveSpeechLocale(null, 'en', 'en-US')).toBe('en-US');
    expect(resolveSpeechLocale(null, null, 'uk-UA')).toBe('uk-UA');
  });

  it('labels the chip', () => {
    expect(localeShort('et-EE')).toBe('ET');
    expect(localeShort('ka')).toBe('KA');
  });
});
