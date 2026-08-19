/**
 * MedLens production Worker
 *  - serves the static app (Workers Static Assets from ./dist)
 *  - POST /api/gemini: same-origin proxy that adds the server-held Gemini key
 *    so visitors and judges scan real medicines with ZERO setup.
 *
 * The Worker OWNS the prompts. The client sends only a minimal typed payload
 * ({ mode: "scan" | "interactions" | "ask", ... }) and the Worker builds the full
 * Gemini request server-side. Any client-supplied prompt or generationConfig
 * is rejected, so this endpoint cannot be repurposed as a general-purpose LLM
 * on the owner's key. (BYOK users in the app talk to Google directly and never
 * hit this endpoint.)
 *
 * Deploy (from MedLens\deploy):  ..\deploy.bat   (or: npx wrangler deploy)
 * Key vault:                     npx wrangler secret put GEMINI_KEY
 */

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const MAX_BODY_BYTES = 3_000_000;   // downscaled scans are ~300KB; anything huge is abuse
const LIMIT_PER_HOUR = 30;          // per IP, soft (in-memory per isolate)
const MAX_OUTPUT_TOKENS = 2048;     // server-clamped: the app's JSON answers are far smaller
const MAX_IMAGE_PARTS = 2;          // full photo + optional machine-straightened label crop

const LANGS = new Set(["English", "Swahili", "French", "Spanish", "Portuguese", "Arabic", "Hindi"]);
const MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const B64_RE = /^[A-Za-z0-9+/=_-]+$/;

/* ---- soft rate limit ----------------------------------------------------
   This Map lives per Cloudflare isolate: the cap is multiplied across
   isolates/colos and vanishes when an isolate is recycled, so treat it as a
   speed bump, not a wall. The production upgrade is Workers KV with a 1-hour
   TTL (or a Durable Object) keyed by IP, which makes the counter global and
   durable across isolates. */
const hits = new Map(); // ip -> { count, hourKey }

function rateLimited(ip) {
  const hourKey = new Date().toISOString().slice(0, 13);
  const rec = hits.get(ip);
  if (rec && rec.hourKey === hourKey && rec.count >= LIMIT_PER_HOUR) return true;
  hits.set(ip, { hourKey, count: rec && rec.hourKey === hourKey ? rec.count + 1 : 1 });
  if (hits.size > 5000) {
    // evict only stale hour buckets — never clear() live counters, or one
    // burst of new IPs would reset every attacker's budget at once
    for (const [k, v] of hits) if (v.hourKey !== hourKey) hits.delete(k);
    // pathological fallback (thousands of live IPs in one hour): drop the
    // oldest-inserted entries instead of wiping the table
    if (hits.size > 20000) {
      for (const k of hits.keys()) { hits.delete(k); if (hits.size <= 10000) break; }
    }
  }
  return false;
}

/* ---- input hygiene ------------------------------------------------------ */
function clean(s, max) {
  return String(s == null ? "" : s)
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}
function validImage(b64, mime) {
  return typeof b64 === "string" && b64.length >= 64 && B64_RE.test(b64) && MIMES.has(mime);
}
function clampInt(n, lo, hi) {
  n = Math.round(Number(n));
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : null;
}

/* ---- prompt templates (server-owned; mirrors of the BYOK client prompts
        in index.html — keep the two in sync when editing) ----------------- */

/* Rebuild the on-device vision hint sentence from structured facts only —
   the client cannot inject free text into the prompt. */
function visionHints(v) {
  if (!v || typeof v !== "object") return "";
  const bits = [];
  if (v.deskewed) bits.push("a rectangular region was straightened on-device — it may or may not be the label");
  const p = v.pills;
  if (p && typeof p === "object") {
    const total = clampInt(p.total, 0, 999);
    if (total != null) {
      const full = clampInt(p.full, 0, 999);
      if (full == null) {
        bits.push(`${total} circular shapes consistent with a blister pack were seen (could not tell intact from taken)`);
      } else {
        const empty = clampInt(p.empty, 0, 999) ?? 0;
        bits.push(`${total} blister-like cells were seen: ${full} look intact, ${empty} look already pressed out`);
      }
    }
  }
  if (v.colorName) {
    const c = clean(v.colorName, 24).toLowerCase().replace(/[^a-z /-]/g, "");
    if (c) bits.push(`the pills look ${c}`);
  }
  if (!bits.length) return "";
  return "On-device computer vision (OpenCV) measured: " + bits.join("; ") +
    ". These measurements describe appearance only and can never identify a medicine by themselves — trust readable printed text over them.";
}

function scanPrompt(hasCrop, hints, lang) {
  return `You are MedLens, a careful pharmacist's assistant. This photo shows a medicine package, bottle, blister sheet or label.
${hasCrop ? "Two images are attached: the full photo first, then a machine-straightened rectangular region that MAY be the label. If the second image does not show the label, ignore it and use the full photo.\n" : ""}${hints ? hints + "\n" : ""}
Read it and return ONLY JSON with this exact shape:
{
 "name": "brand name + strength as printed, e.g. 'Panadol 500 mg'",
 "generic": "active ingredient NAMES only, comma-separated, e.g. 'Paracetamol' or 'Lidocaine, Cetrimide'. Never write a description here — if you cannot read the actual ingredient names, use an empty string.",
 "strength": "e.g. '500 mg'",
 "form": "tablets / syrup / capsules / cream etc.",
 "purpose": "2-3 plain sentences: what this medicine is and what it treats. Simple words a 12-year-old understands.",
 "how_to_take": ["dosing guidance - see the rules below", "max 4 short items"],
 "warnings": ["the most important safety warnings for this medicine", "max 5 short items, plain words"],
 "interactions": ["medicines or substances that interact badly with it", "max 4 items"],
 "seek_doctor": ["specific danger signs that mean the person should see a doctor or emergency care NOW", "max 4 short items"],
 "confidence": "high | medium | low - how sure you are about the identification",
 "rx_only": false,
 "not_a_medicine": false
}
Dosing rules:
- For over-the-counter medicines, give the typical adult dosing from the label if visible, otherwise standard label guidance.
- If this is a prescription-only medicine (antibiotics, blood thinners, insulin, opioids, benzodiazepines, antidepressants, blood-pressure or diabetes medicines, steroids, etc.), set rx_only to true and set how_to_take to exactly one item: "Prescription medicine - take it exactly as your doctor prescribed. Do not use this scan to decide your dose." For antibiotics add a second item: "Finish the full course even if you feel better."
- Never invent doses, and never give doses for children.
- If this medicine is intended for children, or its dose depends on age or weight, make the FIRST how_to_take item exactly: "Children's doses depend on age and weight - ask a pharmacist or doctor for the right amount for your child."
Other rules:
- If there is no readable printed text anywhere in the photo — loose pills, OR a blister sheet with blank or unreadable foil — set confidence to "low" and make the FIRST warning: "Pills cannot be reliably identified by appearance alone - check the original packaging or ask a pharmacist before taking this."
- Keep "name", "generic", "strength" and "form" in the label's own language, but write "purpose", "how_to_take", "warnings", "interactions" and "seek_doctor" in ${lang}.
- If the photo is not a medicine at all, set not_a_medicine to true and leave other fields empty.
- Never invent a brand name you cannot read. If unsure of the brand, identify by active ingredient and lower the confidence.`;
}

function interactionsPrompt(newMed, savedMeds, lang) {
  const savedLine = savedMeds.map(m => m.name + " (" + (m.generic || "?") + ")").join("; ");
  return `You are a careful pharmacist. A person already takes these medicines: ${savedLine}.
They are about to take: ${newMed.name} (${newMed.generic || "?"}).
Return ONLY JSON: {"interactions":[{"with":"name of the existing medicine","severity":"avoid|caution","note":"one plain sentence explaining the risk"}]}
Only include REAL, well-established interactions. If there are none, return {"interactions":[]}. Write notes in ${lang}.`;
}

function askPrompt(med, question, lang) {
  return `You are MedLens, a careful pharmacist's assistant. The user scanned this medicine: ${med.name}${med.generic ? " (" + med.generic + ")" : ""}${med.strength ? ", " + med.strength : ""}${med.form ? ", " + med.form : ""}.
Their question: "${question}"
Answer in ${lang}, in 2-4 short plain sentences a 12-year-old understands.
STRICT RULES — these override everything:
- Only answer questions about THIS medicine: how and when to take it, food, storage, missed doses, common side effects, what it is for, general safety.
- NEVER recommend a different medicine or treatment. NEVER diagnose. NEVER invent a dose the label would not state. NEVER answer "what should I take for X" — for that, reply that choosing a medicine is a pharmacist's or doctor's job because it depends on the person, and set see_professional true.
- If the question involves children, pregnancy, breastfeeding, overdose, or mixing with other medicines, give only general caution and tell them to ask a pharmacist or doctor, and set see_professional true.
- If the question is not about this medicine at all, say you can only answer about the scanned medicine.
Return ONLY JSON: {"answer":"your reply in ${lang}","see_professional":true|false}`;
}

/* ---- request -> Gemini body --------------------------------------------- */
function buildGeminiBody(body) {
  const lang = LANGS.has(body.lang) ? body.lang : "English";

  if (body.mode === "scan") {
    if (!validImage(body.image_b64, body.mime)) return { err: "Bad or missing image" };
    const hasCrop = validImage(body.crop_b64, body.crop_mime);
    const parts = [
      { text: scanPrompt(hasCrop, visionHints(body.vision), lang) },
      { inline_data: { mime_type: body.mime, data: body.image_b64 } },
    ];
    if (hasCrop && MAX_IMAGE_PARTS >= 2) {
      parts.push({ inline_data: { mime_type: body.crop_mime, data: body.crop_b64 } });
    }
    return {
      gemini: {
        contents: [{ parts }],
        generationConfig: { response_mime_type: "application/json", temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS },
      },
    };
  }

  if (body.mode === "interactions") {
    const nm = body.new_med || {};
    const newMed = { name: clean(nm.name, 80), generic: clean(nm.generic, 120) };
    if (!newMed.name) return { err: "Missing new_med.name" };
    const saved = (Array.isArray(body.saved_meds) ? body.saved_meds : [])
      .slice(0, 20)
      .map(m => ({ name: clean(m && m.name, 80), generic: clean(m && m.generic, 120) }))
      .filter(m => m.name);
    if (!saved.length) return { err: "Missing saved_meds" };
    return {
      gemini: {
        contents: [{ parts: [{ text: interactionsPrompt(newMed, saved, lang) }] }],
        generationConfig: { response_mime_type: "application/json", temperature: 0.1, maxOutputTokens: MAX_OUTPUT_TOKENS },
      },
    };
  }

  if (body.mode === "ask") {
    const m = body.med || {};
    const med = { name: clean(m.name, 80), generic: clean(m.generic, 120),
                  strength: clean(m.strength, 30), form: clean(m.form, 30) };
    const question = clean(body.question, 300);
    if (!med.name || !question) return { err: "Missing med.name or question" };
    return {
      gemini: {
        contents: [{ parts: [{ text: askPrompt(med, question, lang) }] }],
        generationConfig: { response_mime_type: "application/json", temperature: 0.3, maxOutputTokens: 512 },
      },
    };
  }

  return { err: "Unknown mode" };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/gemini") {
      if (request.method !== "POST") return new Response("POST only", { status: 405 });

      // same-origin only — browsers always send Origin on cross-site POSTs
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return new Response("Forbidden", { status: 403 });

      const raw = await request.arrayBuffer();
      if (raw.byteLength > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });

      let body;
      try { body = JSON.parse(new TextDecoder().decode(raw)); } catch { return new Response("Bad JSON", { status: 400 }); }
      if (!body || typeof body !== "object") return new Response("Bad JSON", { status: 400 });

      // the Worker owns the prompt — reject anything shaped like a raw Gemini call
      if (body.contents || body.generationConfig || body.prompt || body.systemInstruction ||
          body.system_instruction || body.safetySettings || body.tools) {
        return new Response("Forbidden — this endpoint builds its own prompts", { status: 403 });
      }

      const built = buildGeminiBody(body);
      if (built.err) return new Response(built.err, { status: 400 });

      // charge the rate limit only after validation, right before upstream —
      // malformed junk must not drain a legitimate visitor's hourly budget
      const ip = request.headers.get("CF-Connecting-IP") || "unknown";
      if (rateLimited(ip)) {
        return json({ error: { code: 429, message: "Rate limit — try again in an hour" } }, 429);
      }

      const upstream = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_KEY },
        body: JSON.stringify(built.gemini),
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
