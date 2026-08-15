/**
 * MedLens production Worker
 *  - serves the static app (Workers Static Assets from ./dist)
 *  - POST /api/gemini: same-origin proxy that adds the server-held Gemini key
 *    so visitors and judges scan real medicines with ZERO setup.
 *
 * Deploy (from MedLens\deploy):  ..\deploy.bat   (or: npx wrangler deploy)
 * Key vault:                     npx wrangler secret put GEMINI_KEY
 */

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const MAX_BODY_BYTES = 3_000_000;   // downscaled scans are ~300KB; anything huge is abuse
const LIMIT_PER_HOUR = 30;          // per IP, soft (in-memory per isolate)

const hits = new Map(); // ip -> { count, hourKey }

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/gemini") {
      if (request.method !== "POST") return new Response("POST only", { status: 405 });

      // soft per-IP rate limit
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      const hourKey = new Date().toISOString().slice(0, 13);
      const rec = hits.get(ip);
      if (rec && rec.hourKey === hourKey && rec.count >= LIMIT_PER_HOUR) {
        return json({ error: { code: 429, message: "Rate limit — try again in an hour" } }, 429);
      }
      hits.set(ip, { hourKey, count: rec && rec.hourKey === hourKey ? rec.count + 1 : 1 });
      if (hits.size > 5000) hits.clear();

      const raw = await request.arrayBuffer();
      if (raw.byteLength > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });

      // only serve MedLens's own prompts — this endpoint is not a free general-purpose LLM
      let body;
      try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return new Response("Bad JSON", { status: 400 }); }
      const firstText = body?.contents?.[0]?.parts?.[0]?.text || "";
      if (!firstText.startsWith("You are MedLens") && !firstText.startsWith("You are a careful pharmacist")) {
        return new Response("Forbidden", { status: 403 });
      }

      const upstream = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
        body: raw,
      });
      // pass Gemini's response through untouched so the app's error handling works
      return new Response(await upstream.arrayBuffer(), {
        status: upstream.status,
        headers: { "Content-Type": "application/json" },
      });
    }

    return env.ASSETS.fetch(request);
  },
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });
}
