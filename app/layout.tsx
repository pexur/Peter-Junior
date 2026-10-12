import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import "./globals.css";
import { LanguageProvider } from "./i18n/provider";
import { LANGUAGE_COOKIE, languageOf, translate } from "./i18n/core";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  const language = languageOf((await cookies()).get(LANGUAGE_COOKIE)?.value);
  return {
    metadataBase: new URL(origin),
    title: translate("Personal Daily — A place for your things", language),
    description: translate("Organize your things into categories, keep useful details close, and remember each day with a lightweight journal.", language),
    openGraph: {
      title: translate("Personal Daily", language),
      description: translate("Find your next thing, record what you did, and add a thought for the day.", language),
    },
    twitter: { card: "summary", title: translate("Personal Daily", language), description: translate("Find your next thing, record what you did, and add a thought for the day.", language) },
  };
}

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const language = languageOf((await cookies()).get(LANGUAGE_COOKIE)?.value);
  return <html lang={language}><body><LanguageProvider initialLanguage={language}>{children}</LanguageProvider></body></html>;
}
