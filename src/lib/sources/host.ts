// Parse a URL's host, tolerating malformed values (returns ''). Shared by the source rules,
// which match entries by host.
export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}
