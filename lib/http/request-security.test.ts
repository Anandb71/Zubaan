import assert from "node:assert/strict";
import test from "node:test";

import {
  bearerToken,
  requireSameOrigin,
} from "@/lib/http/request-security";

test("same-origin mutations are accepted", () => {
  const request = new Request("https://zubaan.example/api/stt/relay", {
    headers: {
      Origin: "https://zubaan.example",
      "Sec-Fetch-Site": "same-origin",
    },
  });
  assert.equal(requireSameOrigin(request).ok, true);
});

test("cross-origin relay mutations are rejected", () => {
  const request = new Request("https://zubaan.example/api/stt/relay", {
    headers: {
      Origin: "https://attacker.example",
      "Sec-Fetch-Site": "cross-site",
    },
  });
  const result = requireSameOrigin(request);
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.error.kind, "forbidden");
});

test("relay capability must use a bearer token", () => {
  assert.deepEqual(
    bearerToken(
      new Request("https://zubaan.example/api/stt/relay/session", {
        headers: { Authorization: "Bearer secret-capability" },
      }),
    ),
    { ok: true, value: "secret-capability" },
  );
  assert.equal(
    bearerToken(new Request("https://zubaan.example/api/stt/relay/session")).ok,
    false,
  );
});
