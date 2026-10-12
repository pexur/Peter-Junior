import messages from "./zh.json";
import samples from "./samples.json";
export type Language = "en" | "zh-CN";
export const LANGUAGE_COOKIE = "personal-daily-language";
export function languageOf(value?: string | null): Language { return value === "zh-CN" ? "zh-CN" : "en"; }
const dictionary: Record<string, string> = messages;
const sampleDictionary: Record<string, Record<string, string>> = samples;
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(dictionary).filter(([key]) => /\{\d+\}/.test(key))
  .sort(([a], [b]) => b.replace(/\{\d+\}/g, "").length - a.replace(/\{\d+\}/g, "").length).map(([key, value]) => ({
  pattern: new RegExp("^" + key.trim().split(/\{\d+\}/).map(escape).join("(.*?)") + "$", "s"), value,
}));
/** Only call for interface text. Editable user content uses sampleText instead. */
export function translate<T>(value: T, language: Language): T {
  if (language === "en" || typeof value !== "string" || !value) return value;
  const trimmed = value.trim();
  let translated = dictionary[value] ?? dictionary[trimmed];
  if (translated === undefined && /^\d+h(?: \d+m)?$/.test(trimmed)) translated = trimmed.replace("h", " 小时").replace("m", " 分钟");
  if (translated === undefined) {
    for (const entry of patterns) {
      const match = entry.pattern.exec(trimmed);
      if (!match) continue;
      translated = entry.value.replace(/\{(\d+)\}/g, (_, i) => match[Number(i) + 1] ?? "");
      break;
    }
  }
  if (translated === undefined) return value;
  return (value.match(/^\s*/)?.[0] + translated + value.match(/\s*$/)?.[0]) as T;
}
/** Translate only untouched built-in examples. IDs and stored data never change. */
export function sampleText(value: string, id: string | null | undefined, language: Language): string {
  return language === "zh-CN" && id ? sampleDictionary[id]?.[value] ?? value : value;
}
