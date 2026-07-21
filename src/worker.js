import { EmailMessage } from "cloudflare:email";

const DEST = "seanknox@outlook.com";
const FROM = "command@expedition40.com";

// Strip CR/LF so user input can never inject mail headers.
function clean(value, max = 300) {
  return String(value || "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
}

function field(label, value) {
  return `${label}: ${value || "-"}`;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/api/enlist") {
      return new Response("Not found", { status: 404 });
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    let entry;
    try {
      const body = await request.text();
      if (body.length > 50_000) throw new Error("too large");
      entry = JSON.parse(body);
    } catch (e) {
      return Response.json({ ok: false, error: "bad request" }, { status: 400 });
    }

    const name = clean(entry.name, 120);
    const contact = clean(entry.contact, 200);
    const quality = clean(entry.quality, 300);
    if (!name || !contact) {
      return Response.json({ ok: false, error: "name and contact required" }, { status: 400 });
    }

    const lines = [
      "New enlistment entry — expedition40.com",
      "",
      field("Name", name),
      field("Contact", contact),
      field("Quality", quality),
      field("Skills", clean(entry.skills, 400)),
      field("Role", clean(entry.role, 120)),
      field("Food track", clean(entry.food, 120)),
      field("Access", clean(entry.access, 120)),
      "",
      "Why one of the nine:",
      String(entry.why || "-").replace(/\r/g, "").slice(0, 4000),
      "",
      "Committing to improve:",
      String(entry.improve || "-").replace(/\r/g, "").slice(0, 4000),
      "",
      `Submitted: ${new Date().toISOString()}`,
    ];

    const replyTo = contact.includes("@") && !contact.includes(" ") ? `Reply-To: ${contact}\r\n` : "";
    const raw =
      `From: Expedition Command <${FROM}>\r\n` +
      `To: ${DEST}\r\n` +
      replyTo +
      `Subject: Expedition 40 entry: ${name}\r\n` +
      `Message-ID: <${crypto.randomUUID()}@expedition40.com>\r\n` +
      `Date: ${new Date().toUTCString()}\r\n` +
      `MIME-Version: 1.0\r\n` +
      `Content-Type: text/plain; charset=utf-8\r\n` +
      `\r\n` +
      lines.join("\r\n");

    try {
      await env.NOTIFY.send(new EmailMessage(FROM, DEST, raw));
    } catch (e) {
      return Response.json({ ok: false, error: "delivery failed" }, { status: 502 });
    }

    return Response.json({ ok: true });
  },
};
