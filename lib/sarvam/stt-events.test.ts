import assert from "node:assert/strict";
import test from "node:test";

import { parseSttMessage } from "@/lib/sarvam/stt-events";

test("parses Saaras final transcript and detected language", () => {
  const events = parseSttMessage(
    JSON.stringify({
      type: "data",
      data: {
        transcript: "Returns guaranteed nahi hain",
        language_code: "hi-IN",
        start_time_ms: 120,
        end_time_ms: 980,
      },
    }),
  );
  assert.deepEqual(events, [
    { type: "language", code: "hi-IN" },
    {
      type: "final",
      text: "Returns guaranteed nahi hain",
      language: "hi-IN",
      startMs: 120,
      endMs: 980,
    },
  ]);
});

test("parses VAD signals without inventing transcript events", () => {
  assert.deepEqual(
    parseSttMessage(
      JSON.stringify({ type: "events", data: { signal_type: "START_SPEECH" } }),
    ),
    [{ type: "vad", speaking: true }],
  );
});

test("ignores malformed provider payloads", () => {
  assert.deepEqual(parseSttMessage("not-json"), []);
  assert.deepEqual(parseSttMessage(new Uint8Array([1, 2])), []);
});
