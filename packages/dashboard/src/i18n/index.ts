import React, { createContext, useContext, useState, useCallback } from 'react';
import en from './locales/en.js';
import zh from './locales/zh.js';

export type Locale = 'en' | 'zh';

const locales: Record<Locale, Record<string, any>> = { en, zh };

const STORAGE_KEY = 'cortex-locale';

function detectLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {}
  return navigator.language.startsWith('zh') ? 'zh' : 'en';
}

function getNestedValue(obj: any, path: string): string | undefined {
  let current = obj;
  for (const key of path.split('.')) {
    if (current == null) return undefined;
    current = current[key];
  }
  return typeof current === 'string' ? current : undefined;
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(params[key] ?? `{{${key}}}`));
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => key,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectLocale);

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    try { localStorage.setItem(STORAGE_KEY, l); } catch {}
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    const value = getNestedValue(locales[locale], key);
    if (value !== undefined) return interpolate(value, params);
    // Fallback to English
    const fallback = getNestedValue(locales.en, key);
    if (fallback !== undefined) return interpolate(fallback, params);
    return key;
  }, [locale]);

  return React.createElement(I18nContext.Provider, { value: { locale, setLocale, t } }, children);
}

export function useI18n() {
  return useContext(I18nContext);
}
