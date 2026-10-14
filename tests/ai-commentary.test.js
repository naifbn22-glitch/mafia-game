import test from "node:test";
import assert from "node:assert/strict";
import { createAiNightCommentary, toPublicNightSummary } from "../server/aiCommentary.js";

test("public summary removes role and target details before they reach the model", () => {
  const summary = toPublicNightSummary({
    outcome: "eliminated",
    nightNumber: 3,
    kingPardonGranted: true,
    victimName: "Player A",
    victimId: "secret-player-id",
    thiefTargetId: "secret-target-id",
    actualRole: "thief",
  });

  assert.deepEqual(summary, {
    nightNumber: 3,
    outcome: "eliminated",
    royalPardonGranted: true,
  });
});

test("demo mode returns a short safe Arabic fallback without making provider calls", async () => {
  let called = false;
  const result = await createAiNightCommentary(
    { outcome: "saved", nightNumber: 1 },
    { mode: "demo", fetchImpl: async () => { called = true; } },
  );

  assert.equal(called, false);
  assert.equal(result.mode, "demo");
  assert.equal(result.audioBase64, null);
  assert.match(result.text, /الليلة/);
});

test("live mode generates one sanitized line and Arabic speech audio", async () => {
  const requests = [];
  const fakeFetch = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith("/responses")) {
      return new Response(JSON.stringify({ output_text: "<b>أشرقت الشمس، ونجا الجميع.</b>" }), { status: 200 });
    }
    return new Response(Buffer.from("test-mp3-data"), { status: 200 });
  };

  const result = await createAiNightCommentary(
    { outcome: "peace", nightNumber: 2, victimId: "private-id", role: "thief" },
    { apiKey: "test-secret", fetchImpl: fakeFetch },
  );

  assert.equal(requests.length, 2);
  assert.equal(requests[0].url, "https://api.openai.com/v1/responses");
  assert.equal(requests[1].url, "https://api.openai.com/v1/audio/speech");
  assert.equal(requests[0].options.headers.Authorization, "Bearer test-secret");
  assert.equal(requests[1].options.headers.Authorization, "Bearer test-secret");
  assert.equal(JSON.parse(requests[0].options.body).input.includes("private-id"), false);
  assert.equal(JSON.parse(requests[0].options.body).input.includes("thief"), false);
  assert.equal(JSON.parse(requests[1].options.body).voice, "marin");
  assert.equal(result.text, "أشرقت الشمس، ونجا الجميع.");
  assert.equal(Buffer.from(result.audioBase64, "base64").toString(), "test-mp3-data");
  assert.equal(result.mode, "ai");
});

test("live mode requires a server-side API key", async () => {
  await assert.rejects(
    createAiNightCommentary({ outcome: "peace" }, { mode: "live", apiKey: "" }),
    { message: "AI_COMMENTARY_API_KEY_MISSING" },
  );
});
