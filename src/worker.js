import { EmailMessage } from "cloudflare:email";

const DEST = "seanknox@outlook.com";
const FROM = "command@expedition40.com";

// Strip CR/LF so user input can never inject mail headers.
function clean(value, max = 300) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function esc(text) {
  return String(text ?? "").replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[m]);
}

function field(label, value) {
  return `${label}: ${value || "-"}`;
}

async function handleEnlist(request, env) {
  let entry;
  try {
    const body = await request.text();
    if (body.length > 50_000) throw new Error("too large");
    entry = JSON.parse(body);
  } catch (e) {
    return Response.json({ ok: false, error: "bad request" }, { status: 400 });
  }

  const rec = {
    ts: new Date().toISOString(),
    name: clean(entry.name, 120),
    contact: clean(entry.contact, 200),
    quality: clean(entry.quality, 300),
    skills: clean(entry.skills, 400),
    role: clean(entry.role, 120),
    food: clean(entry.food, 120),
    access: clean(entry.access, 120),
    why: String(entry.why || "").replace(/\r/g, "").slice(0, 4000),
    improve: String(entry.improve || "").replace(/\r/g, "").slice(0, 4000),
  };
  if (!rec.name || !rec.contact) {
    return Response.json({ ok: false, error: "name and contact required" }, { status: 400 });
  }

  // Storage is the primary record: store first, email second.
  let stored = false;
  try {
    await env.DB.prepare(
      `INSERT INTO entries (ts, name, contact, quality, skills, role, food, access, why, improve, emailed)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, 0)`
    ).bind(rec.ts, rec.name, rec.contact, rec.quality, rec.skills, rec.role,
           rec.food, rec.access, rec.why, rec.improve).run();
    stored = true;
  } catch (e) {
    stored = false;
  }

  let emailed = false;
  try {
    const lines = [
      "New enlistment entry — expedition40.com",
      "",
      field("Name", rec.name),
      field("Contact", rec.contact),
      field("Quality", rec.quality),
      field("Skills", rec.skills),
      field("Role", rec.role),
      field("Food track", rec.food),
      field("Access", rec.access),
      "",
      "Why one of the nine:",
      rec.why || "-",
      "",
      "Committing to improve:",
      rec.improve || "-",
      "",
      `Submitted: ${rec.ts}`,
      `Stored in roster: ${stored ? "yes" : "NO — check D1"}`,
      "Full roster: https://expedition40.com/roster",
    ];
    const replyTo = rec.contact.includes("@") && !rec.contact.includes(" ")
      ? `Reply-To: ${rec.contact}\r\n` : "";
    const raw =
      `From: Expedition Command <${FROM}>\r\n` +
      `To: ${DEST}\r\n` +
      replyTo +
      `Subject: Expedition 40 entry: ${rec.name}\r\n` +
      `Message-ID: <${crypto.randomUUID()}@expedition40.com>\r\n` +
      `Date: ${new Date().toUTCString()}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `\r\n` +
      lines.join("\r\n");
    await env.NOTIFY.send(new EmailMessage(FROM, DEST, raw));
    emailed = true;
  } catch (e) {
    emailed = false;
  }

  if (stored && emailed) {
    await env.DB.prepare("UPDATE entries SET emailed = 1 WHERE ts = ?1 AND name = ?2")
      .bind(rec.ts, rec.name).run().catch(() => {});
  }

  if (!stored && !emailed) {
    return Response.json({ ok: false, error: "delivery failed" }, { status: 502 });
  }
  return Response.json({ ok: true, stored, emailed });
}

async function handleRoster(request, env, url) {
  const key = url.searchParams.get("key") || "";
  if (!env.ROSTER_KEY || key !== env.ROSTER_KEY) {
    return new Response("Not found", { status: 404 });
  }

  const { results } = await env.DB.prepare(
    "SELECT * FROM entries ORDER BY id DESC"
  ).all();

  if (url.searchParams.get("format") === "json") {
    return Response.json(results);
  }

  const rows = results.map((r) => `
    <article>
      <h2>#${r.id} — ${esc(r.name)} <small>${esc(r.ts.slice(0, 16).replace("T", " "))} UTC${r.emailed ? "" : " · not emailed"}</small></h2>
      <dl>
        <dt>Contact</dt><dd>${esc(r.contact)}</dd>
        <dt>Quality</dt><dd>${esc(r.quality) || "-"}</dd>
        <dt>Skills</dt><dd>${esc(r.skills) || "-"}</dd>
        <dt>Role</dt><dd>${esc(r.role) || "-"}</dd>
        <dt>Food track</dt><dd>${esc(r.food) || "-"}</dd>
        <dt>Access</dt><dd>${esc(r.access) || "-"}</dd>
        <dt>Why</dt><dd>${esc(r.why) || "-"}</dd>
        <dt>Improving</dt><dd>${esc(r.improve) || "-"}</dd>
      </dl>
    </article>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex, nofollow">
<title>Expedition 40 — Roster (${results.length})</title>
<style>
  body{margin:0;background:#e9e2cf;color:#171912;font-family:Georgia,serif;line-height:1.55}
  .wrap{max-width:760px;margin:0 auto;padding:40px 20px 80px}
  h1{letter-spacing:-.03em;border-bottom:6px solid #8a4325;padding-bottom:12px}
  article{border:1px solid rgba(23,25,18,.22);background:rgba(255,255,255,.35);padding:18px 22px;margin:18px 0}
  h2{margin:0 0 10px;font-size:1.2rem}
  h2 small{font:700 .68rem Arial,sans-serif;text-transform:uppercase;letter-spacing:.1em;color:#8a4325;margin-left:8px}
  dl{display:grid;grid-template-columns:110px 1fr;gap:6px 14px;margin:0}
  dt{font:700 .68rem/1.8 Arial,sans-serif;text-transform:uppercase;letter-spacing:.1em;color:#5a5c52}
  dd{margin:0}
</style></head><body><div class="wrap">
<h1>Enlistment roster — ${results.length} ${results.length === 1 ? "entry" : "entries"}</h1>
${rows || "<p>No entries yet.</p>"}
</div></body></html>`;

  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/enlist") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      return handleEnlist(request, env);
    }
    if (url.pathname === "/roster") {
      return handleRoster(request, env, url);
    }
    return new Response("Not found", { status: 404 });
  },
};
