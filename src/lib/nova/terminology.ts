/** Localize this known model term in Nova replies, never user messages or source quotes. */
export function normalizeNovaReplyText(text: string): string {
  return text.replace(/\bfocus\s+duel\b/giu, 'odak düellosu');
}
