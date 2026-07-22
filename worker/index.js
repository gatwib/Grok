/**
 * gatwib-mail Worker (versi mobile-friendly, API_KEY hardcoded)
 * Paste ini ke index.js di editor Cloudflare.
 * Binding KV MAILBOX diatur lewat wrangler.jsonc (file kedua).
 */

const API_KEY = "gatwib_mail_hUls05kl7Ks5KpTpE39blyo1eQtgJmpK";
const TTL_SECONDS = 3600;

export default {
  async email(message, env, ctx) {
    try {
      const to = (message.to || "").toLowerCase();
      const from = message.from || "";
      const subject = message.headers.get("subject") || "";
      const raw = await streamToString(message.raw);
      const bodyText = extractTextBody(raw);
      const record = {
        id: crypto.randomUUID(),
        to, from, subject, bodyText,
        date: new Date().toISOString(),
      };
      const key = `mail:${to}:${Date.now()}`;
      await env.MAILBOX.put(key, JSON.stringify(record), { expirationTtl: TTL_SECONDS });
    } catch (err) {
      console.error("email handler error:", err);
    }
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const auth = request.headers.get("X-API-Key") || url.searchParams.get("key") || "";
    if (auth !== API_KEY) return json({ error: "unauthorized" }, 401);

    if (url.pathname === "/inbox") {
      const address = (url.searchParams.get("address") || "").toLowerCase();
      if (!address) return json({ error: "missing address" }, 400);
      const list = await env.MAILBOX.list({ prefix: `mail:${address}:` });
      const messages = [];
      for (const k of list.keys) {
        const val = await env.MAILBOX.get(k.name);
        if (val) messages.push(JSON.parse(val));
      }
      messages.sort((a, b) => (a.date < b.date ? 1 : -1));
      return json({ address, count: messages.length, messages });
    }
    if (url.pathname === "/health") {
      return json({ ok: true, service: "gatwib-mail", time: new Date().toISOString() });
    }
    return json({ error: "not found", routes: ["/inbox?address=", "/health"] }, 404);
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });
}

async function streamToString(stream) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
    if (total > 200000) break;
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) { merged.set(c, offset); offset += c.length; }
  return new TextDecoder("utf-8").decode(merged);
}

function extractTextBody(raw) {
  // deteksi multipart via boundary di header
  const boundaryMatch = raw.match(/boundary="?([^"\r\n;]+)"?/i);

  let candidate = "";
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    // pecah jadi bagian-bagian MIME
    const segments = raw.split("--" + boundary);
    // prioritas: ambil bagian text/plain; kalau tak ada, text/html
    let plain = "";
    let html = "";
    for (const seg of segments) {
      const headerEnd = seg.search(/\r?\n\r?\n/);
      if (headerEnd === -1) continue;
      const head = seg.slice(0, headerEnd).toLowerCase();
      let content = seg.slice(headerEnd).replace(/^\r?\n\r?\n/, "");
      // decode sesuai encoding part
      content = decodePart(content, head);
      if (head.includes("text/plain") && !plain) plain = content;
      else if (head.includes("text/html") && !html) html = content;
    }
    candidate = plain || html;
  } else {
    // email non-multipart: buang header (sebelum baris kosong pertama)
    const idx = raw.search(/\r?\n\r?\n/);
    candidate = idx === -1 ? raw : raw.slice(idx);
    candidate = decodePart(candidate, raw.slice(0, idx).toLowerCase());
  }

  // bersihkan: strip HTML, entity dasar, rapikan whitespace
  const clean = candidate
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[ \t]+/g, " ")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return clean.slice(0, 10000);
}

// decode quoted-printable / base64 sesuai Content-Transfer-Encoding part
function decodePart(content, headerLower) {
  if (headerLower.includes("quoted-printable")) {
    return content
      .replace(/=\r?\n/g, "")
      .replace(/=([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
  }
  if (headerLower.includes("base64")) {
    try {
      const b64 = content.replace(/\s+/g, "");
      return decodeURIComponent(escape(atob(b64)));
    } catch {
      return content;
    }
  }
  return content;
}
