import type { Entry } from "$lib/types";
import type { SourceRules } from "./types";
import { githubSource } from "./github";
import { telegramSource } from "./telegram";

// Registry of per-source image rules, checked in order. Add a source by dropping in a new module
// (see ./github, ./telegram) and listing it here — the thumbnail pipeline needs no other change.
const SOURCES: SourceRules[] = [githubSource, telegramSource];

// The source rules that apply to an entry, or null. First match wins (sources are host-disjoint).
export function sourceFor(entry: Entry): SourceRules | null {
  return SOURCES.find((s) => s.appliesTo(entry)) ?? null;
}

export type { SourceRules, SourceContext } from "./types";
