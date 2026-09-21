import type { RawSignal } from "./types";

const TOKEN_PATTERN = /[^\p{L}\p{N}]+/gu;

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(TOKEN_PATTERN, " ").replace(/\s+/g, " ");
}

function containsPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  return ` ${normalize(haystack)} `.includes(` ${phrase} `);
}

function domainMatches(signal: RawSignal, domain: string): boolean {
  const normalizedDomain = domain.trim().toLocaleLowerCase().replace(/^www\./, "");
  if (!normalizedDomain) return false;

  const haystack = [
    signal.sourceUrl,
    signal.title,
    signal.rawContent,
  ]
    .join(" ")
    .toLocaleLowerCase();

  return haystack.includes(normalizedDomain);
}

export interface NewsRelevanceContext {
  entityName: string;
  entityDomain: string | null;
  industry?: string | null;
  country?: string | null;
}

/**
 * Filters obvious same-name false positives before external news becomes a
 * Radar signal. A multi-word company name is generally specific enough to
 * stand alone; a short/single-token name needs either a domain or contextual
 * evidence such as industry/country.
 */
export function isRelevantNewsSignal(
  signal: RawSignal,
  context: NewsRelevanceContext
): boolean {
  if (signal.sourceType !== "NEWS_ARTICLE") return true;

  const name = normalize(context.entityName);
  if (!name) return false;

  const nameMentioned = containsPhrase(
    [signal.title, signal.rawContent].join(" "),
    name
  );
  const hasDomain = Boolean(
    context.entityDomain && domainMatches(signal, context.entityDomain)
  );

  if (hasDomain) return true;
  if (!nameMentioned) return false;

  const isSpecificName = name.split(" ").length >= 2 || name.length >= 14;
  if (isSpecificName) return true;

  const contextualMention =
    containsPhrase(
      [signal.title, signal.rawContent].join(" "),
      normalize(context.industry ?? "")
    ) ||
    containsPhrase(
      [signal.title, signal.rawContent].join(" "),
      normalize(context.country ?? "")
    );

  return contextualMention;
}

export function filterRelevantNewsSignals(
  signals: RawSignal[],
  context: NewsRelevanceContext
): RawSignal[] {
  return signals.filter((signal) => isRelevantNewsSignal(signal, context));
}
