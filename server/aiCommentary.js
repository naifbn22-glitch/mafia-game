const MAX_COMMENTARY_CHARACTERS = 180;

export function toPublicNightSummary(summary = {}) {
  const outcome = ["saved", "eliminated", "peace"].includes(summary.outcome)
    ? summary.outcome
    : "peace";

  return {
    nightNumber: Math.max(1, Number(summary.nightNumber) || 1),
    outcome,
    royalPardonGranted: Boolean(summary.kingPardonGranted),
  };
}

function fallbackText(summary) {
  if (summary.outcome === "saved") return "انتهت الليلة بسلام، ولم يخرج أي لاعب. استعدوا لجولة جديدة من النقاش.";
  if (summary.outcome === "eliminated") return "أشرقت الشمس على خبر خروج لاعب من المنافسة. فكروا جيدًا قبل التصويت.";
  return "مرّت الليلة دون خروج أي لاعب. أمامكم جولة جديدة لكشف الحقيقة.";
}

function extractResponseText(payload) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const text = (payload?.output || [])
    .flatMap(item => item?.content || [])
    .find(item => item?.type === "output_text")?.text;
  return typeof text === "string" ? text : "";
}

function cleanCommentary(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/[`*_#]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_COMMENTARY_CHARACTERS);
}

async function readProviderError(response) {
  try {
    const payload = await response.json();
    return payload?.error?.message || `AI_PROVIDER_HTTP_${response.status}`;
  } catch {
    return `AI_PROVIDER_HTTP_${response.status}`;
  }
}

export async function createAiNightCommentary(
  summary,
  {
    mode = process.env.AI_COMMENTARY_MODE || "live",
    apiKey = process.env.OPENAI_API_KEY || "",
    fetchImpl = fetch,
    textModel = process.env.AI_COMMENTARY_TEXT_MODEL || "gpt-4.1-mini",
    speechModel = process.env.AI_COMMENTARY_SPEECH_MODEL || "gpt-4o-mini-tts",
    voice = process.env.AI_COMMENTARY_VOICE || "marin",
  } = {},
) {
  const publicSummary = toPublicNightSummary(summary);

  if (mode === "demo") {
    return {
      text: fallbackText(publicSummary),
      audioBase64: null,
      mode: "demo",
    };
  }

  if (!apiKey) throw new Error("AI_COMMENTARY_API_KEY_MISSING");

  const textResponse = await fetchImpl("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      model: textModel,
      instructions: [
        "أنت معلّق صوتي عربي للعبة مافيا اجتماعية.",
        "اكتب جملة واحدة قصيرة وحماسية عن النتيجة العلنية فقط.",
        "لا تخمّن الأدوار ولا تكشف معلومات سرية ولا تضف أسماء لاعبين.",
        "أعد الجملة وحدها دون علامات تنسيق أو مقدمات.",
      ].join(" "),
      input: JSON.stringify(publicSummary),
      max_output_tokens: 70,
    }),
  });

  if (!textResponse.ok) throw new Error(await readProviderError(textResponse));
  const text = cleanCommentary(extractResponseText(await textResponse.json()));
  if (!text) throw new Error("AI_COMMENTARY_EMPTY_TEXT");

  const speechResponse = await fetchImpl("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify({
      model: speechModel,
      voice,
      input: text,
      instructions: "تحدث بالعربية بوضوح وبنبرة معلّق ودودة وحماسية، بسرعة معتدلة.",
      response_format: "mp3",
    }),
  });

  if (!speechResponse.ok) throw new Error(await readProviderError(speechResponse));
  const audio = Buffer.from(await speechResponse.arrayBuffer());
  if (!audio.length || audio.length > 512 * 1024) throw new Error("AI_COMMENTARY_AUDIO_INVALID");

  return {
    text,
    audioBase64: audio.toString("base64"),
    mode: "ai",
  };
}
