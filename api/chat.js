// api/chat.js
// Vercel serverless function (Node.js runtime).
// Keeps the Gemini API key server-side only — never sent to the browser.
//
// Expects POST body:
// {
//   messages: [{ role: "user"|"assistant", content: string, attachments?: [{mimeType, data, name}] }],
//   language: "en" | "hi" | ...,
//   settings: { webSearch: boolean, autoMode: boolean }
// }
//
// Returns:
// { reply: string, sources: [{ title, url }] }

const GEMINI_MODEL = "gemini-2.5-flash";
const GEMINI_ENDPOINT =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const MAX_MESSAGES = 24;        // cap conversation history sent upstream
const MAX_ATTACHMENTS_PER_MSG = 6;
const MAX_INLINE_BYTES = 18 * 1024 * 1024; // ~18MB base64 safety cap per attachment

const LANGUAGE_NAMES = {
  en: "English",
  hi: "Hindi (हिन्दी)",
  es: "Spanish",
  fr: "French",
  ar: "Arabic",
  bn: "Bengali",
};

module.exports = async function handler(req, res) {
  // Basic CORS / method guard — this endpoint is same-origin from public/index.html,
  // but we keep this defensive in case the app is embedded elsewhere.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed. Use POST." });
    return;
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    res.status(500).json({
      error:
        "Server is missing GEMINI_API_KEY. Set it in your Vercel project's Environment Variables.",
    });
    return;
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  } catch (e) {
    res.status(400).json({ error: "Invalid JSON body." });
    return;
  }
  if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
    res.status(400).json({ error: "Request must include a non-empty 'messages' array." });
    return;
  }

  const language = LANGUAGE_NAMES[body.language] || "English";
  const settings = body.settings || {};
  const useWebSearch = settings.webSearch !== false; // default on
  const autoMode = !!settings.autoMode;

  const messages = body.messages.slice(-MAX_MESSAGES);

  let contents;
  try {
    contents = buildContents(messages);
  } catch (err) {
    res.status(400).json({ error: err.message });
    return;
  }

  const systemInstruction = {
    role: "user",
    parts: [
      {
        text:
          "You are Guru AI, a calm, precise, and genuinely helpful assistant. " +
          `Respond in ${language} unless the user clearly writes in a different language, in which case follow them. ` +
          "Be concise by default and expand only when the question needs depth. " +
          "When you use information from web search results, weave it in naturally and rely on the provided grounding rather than guessing. " +
          (autoMode
            ? "Auto-Mode is ON: when a request implies multiple steps, proactively lay out and carry out a clear step-by-step plan instead of just asking what to do next."
            : "Auto-Mode is OFF: prefer asking a brief clarifying question before taking multi-step actions on the user's behalf."),
      },
    ],
  };

  const payload = {
    contents,
    systemInstruction,
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 2048,
    },
    safetySettings: [
      { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_ONLY_HIGH" },
      { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_ONLY_HIGH" },
    ],
  };

  if (useWebSearch) {
    // Real-time web search grounding tool (Gemini 2.x).
    payload.tools = [{ google_search: {} }];
  }

  try {
    const upstream = await fetch(`${GEMINI_ENDPOINT}?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await upstream.json();

    if (!upstream.ok) {
      const message =
        (data && data.error && data.error.message) ||
        `Upstream model request failed (${upstream.status}).`;
      res.status(upstream.status >= 400 && upstream.status < 600 ? upstream.status : 502).json({
        error: message,
      });
      return;
    }

    const candidate = data.candidates && data.candidates[0];
    if (!candidate) {
      const blockReason =
        (data.promptFeedback && data.promptFeedback.blockReason) || "no_candidate";
      res.status(200).json({
        reply: "I wasn't able to generate a response for that (reason: " + blockReason + "). Could you rephrase?",
        sources: [],
      });
      return;
    }

    const parts = (candidate.content && candidate.content.parts) || [];
    const reply = parts.map((p) => p.text || "").join("").trim() || "(empty response)";

    const sources = extractSources(candidate);

    res.status(200).json({ reply, sources });
  } catch (err) {
    res.status(502).json({ error: "Failed to reach the model backend: " + err.message });
  }
};

/**
 * Convert our simplified message history into Gemini's `contents` format,
 * including inline multimodal data (images / PDFs as base64).
 */
function buildContents(messages) {
  return messages.map((msg) => {
    const role = msg.role === "assistant" ? "model" : "user";
    const parts = [];

    if (msg.content && String(msg.content).trim()) {
      parts.push({ text: String(msg.content) });
    }

    const attachments = Array.isArray(msg.attachments) ? msg.attachments.slice(0, MAX_ATTACHMENTS_PER_MSG) : [];
    for (const att of attachments) {
      if (!att || !att.data || !att.mimeType) continue;
      if (att.data.length > MAX_INLINE_BYTES) {
        throw new Error(`Attachment "${att.name || "file"}" is too large.`);
      }
      if (!isSupportedMime(att.mimeType)) {
        throw new Error(`Unsupported attachment type: ${att.mimeType}`);
      }
      parts.push({
        inlineData: {
          mimeType: att.mimeType,
          data: att.data,
        },
      });
    }

    if (parts.length === 0) {
      parts.push({ text: "" });
    }

    return { role, parts };
  });
}

function isSupportedMime(mimeType) {
  return (
    mimeType.startsWith("image/") ||
    mimeType === "application/pdf"
  );
}

/**
 * Pull grounding citations (web search sources) out of a Gemini candidate,
 * if grounding metadata is present.
 */
function extractSources(candidate) {
  const meta = candidate.groundingMetadata || candidate.citationMetadata;
  if (!meta) return [];

  const sources = [];
  const seen = new Set();

  const chunks = meta.groundingChunks || meta.groundingAttributions || [];
  for (const chunk of chunks) {
    const web = chunk.web || chunk.retrievedContext || {};
    const url = web.uri || web.url;
    const title = web.title || url;
    if (url && !seen.has(url)) {
      seen.add(url);
      sources.push({ title, url });
    }
  }

  return sources;
}
