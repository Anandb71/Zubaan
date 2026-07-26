import type { SttEvent } from "@/lib/sarvam/types";

export function parseSttMessage(data: unknown): SttEvent[] {
  if (typeof data !== "string") return [];

  let message: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(data);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    message = parsed as Record<string, unknown>;
  } catch {
    return [];
  }

  const events: SttEvent[] = [];
  const type = pickString(message, "type");
  const payload =
    message.data && typeof message.data === "object" && !Array.isArray(message.data)
      ? (message.data as Record<string, unknown>)
      : message;

  if (type === "error") {
    events.push({
      type: "error",
      message:
        pickString(payload, "error") ??
        pickString(payload, "message") ??
        "STT error",
      retriable: true,
    });
    return events;
  }

  if (type === "events") {
    const signal = pickString(payload, "signal_type");
    if (signal === "START_SPEECH") events.push({ type: "vad", speaking: true });
    if (signal === "END_SPEECH") events.push({ type: "vad", speaking: false });
    return events;
  }

  const language =
    pickString(payload, "language_code") ??
    pickString(payload, "detected_language") ??
    pickString(payload, "language");
  if (language) events.push({ type: "language", code: language });

  const text = pickString(payload, "transcript") ?? pickString(payload, "text");
  if (text === undefined) return events;

  const isFinal =
    type === "data" ||
    toBoolean(firstOf(payload, ["is_final", "final"])) ||
    pickString(payload, "event") === "final";

  events.push(
    isFinal
      ? {
          type: "final",
          text,
          language,
          startMs: toNumber(firstOf(payload, ["start_time_ms", "start_ms", "start"])),
          endMs: toNumber(firstOf(payload, ["end_time_ms", "end_ms", "end"])),
        }
      : { type: "partial", text, language },
  );
  return events;
}

function pickString(
  message: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = message[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function firstOf(message: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (message[key] !== undefined) return message[key];
  }
  return undefined;
}

function toBoolean(value: unknown): boolean {
  return value === true || value === "true" || value === 1;
}

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}
