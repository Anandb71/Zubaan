/**
 * Identifier generation.
 *
 * Uses crypto.randomUUID where available (Node 18+, modern browsers) and falls
 * back to a time-ordered random id. Time-ordered prefixes keep ids roughly
 * sortable, which makes transcript and violation ordering stable even when two
 * records land in the same millisecond.
 */

export function uuid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  // Fallback: timestamp + randomness, UUID-shaped enough for a Postgres uuid column.
  const hex = (n: number, len: number) => n.toString(16).padStart(len, "0").slice(-len);
  const rand = () => Math.floor(Math.random() * 0xffff);
  return [
    hex(Date.now() & 0xffffffff, 8),
    hex(rand(), 4),
    `4${hex(rand(), 4).slice(1)}`,
    hex((rand() & 0x3fff) | 0x8000, 4),
    `${hex(rand(), 4)}${hex(rand(), 4)}${hex(rand(), 4)}`,
  ].join("-");
}

/** Short, human-quotable id for log correlation (e.g. request ids). */
export function shortId(prefix = ""): string {
  const s = Math.random().toString(36).slice(2, 8);
  const t = Date.now().toString(36).slice(-4);
  return `${prefix}${t}${s}`;
}
