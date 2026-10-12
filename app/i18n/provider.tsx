"use client";
import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { LANGUAGE_COOKIE, sampleText, translate, type Language } from "./core";
const LanguageContext = createContext<{ language: Language; setLanguage: (value: Language) => void }>({ language: "en", setLanguage: () => {} });
export function LanguageProvider({ initialLanguage, children }: { initialLanguage: Language; children: React.ReactNode }) {
  const [language, setLanguage] = useState(initialLanguage);
  useEffect(() => {
    document.documentElement.lang = language;
    document.title = language === "zh-CN" ? "个人手账 — 安排日常，记录生活" : "Personal Daily — A place for your things";
  }, [language]);
  const value = useMemo(() => ({ language, setLanguage: (next: Language) => {
    document.cookie = `${LANGUAGE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax`;
    setLanguage(next);
  } }), [language]);
  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}
export function useI18n() {
  const { language, setLanguage } = useContext(LanguageContext);
  return { language, setLanguage, tr: <T,>(value: T) => translate(value, language), sample: (value: string, id?: string | null) => sampleText(value, id, language) };
}
export function LanguageToggle() {
  const { language, setLanguage } = useI18n();
  return <div className="language-toggle" role="group" aria-label={language === "zh-CN" ? "界面语言" : "Interface language"}>
    <button type="button" lang="en" aria-label="English" aria-pressed={language === "en"} onClick={() => setLanguage("en")}>EN</button>
    <span aria-hidden="true">/</span>
    <button type="button" lang="zh-CN" aria-label="简体中文" aria-pressed={language === "zh-CN"} onClick={() => setLanguage("zh-CN")}>中</button>
  </div>;
}
