/* Inner Table - the AI bridge.
   Lets a person's own AI (Claude, ChatGPT, anything that takes a connector
   URL or can read a web page) READ their parts, and run the app's own guided
   sessions with them - check-ins, mapping, a part's reaction, a table meeting -
   using the same prompts the app uses, and SAVE what a session learned.

   Saving only ever merges (the app's own merge: nothing is erased, coverage
   never goes backwards, declined stays declined). It writes twice: into the
   synced state, so the next session already knows, and into an inbox the
   app folds in on its next sync - because the app pushes its whole state, and
   a device that had not pulled yet would otherwise write over the save.

   One private link per account, one endpoint, two audiences:
   - the app (Bearer session token, no ?t=) creates, shows and revokes the link;
   - the AI (?t=<link token>) reads and saves sessions as an MCP server over
     POST, or reads as one plain markdown page over GET (which never writes).

   The link token is the credential, so it is long, random and revocable. It
   reads parts and the table, and its one write merges a session's profiles
   in - it cannot delete a part, empty a field, or touch pictures. Transcripts
   are never served, and neither is anything outside the synced state. */
"use strict";

var crypto = require("crypto");
var verifySession = require("./sync.js").verifySession;
var sessions = require("./_sessions.js");

var TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
var PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

function linkKey(token) { return "innertable:bridge:" + token; }
function ownerKey(user) { return "innertable:bridgeof:" + user; }
function stateKey(user) { return "innertable:state:" + user; }
function inboxKey(user) { return "innertable:inbox:" + user; }

async function redis(cmd, body) {
  var r = await fetch(process.env.UPSTASH_REDIS_REST_URL + "/" + cmd, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: "Bearer " + process.env.UPSTASH_REDIS_REST_TOKEN },
    body: body
  });
  if (!r.ok) throw new Error("redis " + cmd.split("/")[0] + " failed");
  return (await r.json()).result;
}

/* ---------- rendering: generic, so new profile fields show up unasked ---------- */

var SCALARS = ["type", "age", "location", "appearance", "origin", "positive_intent", "unburdened_vision", "trust_in_self"];
var LISTS = ["emotions", "fears", "hopes_goals", "behaviors", "wants_needs"];
var FEELING = { 1: "hostile", 2: "wary", 3: "neutral", 4: "warm", 5: "close" };

function label(k) { return k.replace(/_/g, " "); }
function str(v) { return typeof v === "string" ? v.trim() : ""; }

function partMarkdown(p) {
  var out = ["# " + (str(p.name) || "(unnamed part)") + " (" + str(p.slug) + ")"];
  SCALARS.forEach(function (k) {
    var v = str(p[k]);
    if (v && v !== "unknown") out.push("- " + label(k) + ": " + v);
  });
  LISTS.forEach(function (k) {
    var v = (Array.isArray(p[k]) ? p[k] : []).map(str).filter(Boolean);
    if (v.length) out.push("- " + label(k) + ": " + v.join("; "));
  });
  (Array.isArray(p.relationships) ? p.relationships : []).forEach(function (r) {
    if (r && r.part) out.push("- relationship: " + str(r.type) + " " + r.part + (str(r.notes) ? " (" + str(r.notes) + ")" : ""));
  });
  (Array.isArray(p.feelings) ? p.feelings : []).forEach(function (f) {
    if (f && f.part) out.push("- feels toward " + f.part + ": " + (FEELING[Math.round(f.rating)] || f.rating) + (f.date ? " (" + f.date + ")" : ""));
  });
  (Array.isArray(p.sessions) ? p.sessions : []).slice(-5).forEach(function (s) {
    if (s && s.date) out.push("- session " + s.date + " " + str(s.mode) + (str(s.note) ? ": " + str(s.note) : ""));
  });
  var nar = p.narrative && typeof p.narrative === "object" ? p.narrative : {};
  Object.keys(nar).forEach(function (k) {
    if (str(nar[k])) out.push("", "## " + label(k), str(nar[k]));
  });
  return out.join("\n");
}

function tableMarkdown(tb) {
  if (!tb || !tb.built) return "The table has not been set up yet.";
  var out = ["# The table" + (str(tb.name) ? ": " + tb.name : "")];
  if (str(tb.room)) out.push(str(tb.room));
  if (str(tb.details)) out.push(str(tb.details));
  var seats = tb.seats && typeof tb.seats === "object" ? tb.seats : {};
  var where = Object.keys(seats).map(function (slug) { return "- " + slug + ": " + seats[slug]; });
  if (where.length) out.push("", "## Seating", where.join("\n"));
  var tools = (Array.isArray(tb.tools) ? tb.tools : []).map(function (t) { return "- " + str(t && t.label); }).filter(function (l) { return l !== "- "; });
  if (tools.length) out.push("", "## Tools in the room", tools.join("\n"));
  var ag = (Array.isArray(tb.agreements) ? tb.agreements : []).map(str).filter(Boolean);
  if (ag.length) out.push("", "## Agreements", ag.map(function (a) { return "- " + a; }).join("\n"));
  var meets = (Array.isArray(tb.meetings) ? tb.meetings : []).slice(-5);
  if (meets.length) {
    out.push("", "## Recent meetings");
    meets.forEach(function (m) {
      out.push("- " + str(m.date) + " " + str(m.topic) + (str(m.synthesis) ? " - " + str(m.synthesis) : ""));
    });
  }
  return out.join("\n");
}

function listMarkdown(parts) {
  if (!parts.length) return "No parts yet.";
  return parts.map(function (p) {
    return "- " + (str(p.name) || "(unnamed part)") + " [" + str(p.slug) + "]" +
      (p.type && p.type !== "unknown" ? " - " + p.type : "") +
      (str(p.positive_intent) ? " - wants: " + str(p.positive_intent) : "");
  }).join("\n");
}

/* Saves the app has not folded in yet, oldest first. A storage hiccup here
   reads as "none" rather than failing the read it rides along with. */
async function loadPending(user) {
  try {
    var flat = await redis("hgetall/" + inboxKey(user));
    var out = [];
    for (var i = 0; flat && i + 1 < flat.length; i += 2) {
      try { out.push({ id: flat[i], entry: JSON.parse(flat[i + 1]) }); } catch (e) {}
    }
    out.sort(function (a, b) { return a.id < b.id ? -1 : a.id > b.id ? 1 : 0; });
    return out;
  } catch (e) { return []; }
}

/* The synced blob as stored, with pending saves folded in. */
async function loadFull(user) {
  var raw = await redis("get/" + stateKey(user));
  if (!raw) return null;
  var s;
  try { s = JSON.parse(raw); } catch (e) { return null; }
  if (!s || typeof s !== "object") return null;
  var pending = await loadPending(user);
  return sessions.overlay(s, pending.map(function (x) { return x.entry; }));
}

async function loadState(user) {
  var s = await loadFull(user);
  if (!s) return null;
  return { parts: sessions.partsOf(s), table: s.table || null };
}

var EMPTY = "Nothing has synced from the Inner Table app yet. Open the app, then Settings > Account > Sync now.";

/* What every session-capable surface says, once: how to start one. */
var SESSION_HELP = "To run a guided session with these parts - which is what this link is for - call start_session (or open this link with &session=<mode>&part=<slug>) and follow what it returns for the rest of the conversation; with the connector, the session saves its updated profile back with save_session when it closes. Modes: checkin (one part: deepen what is known, aimed at where its profile is thin), embody (one part speaks for itself about something real), mapping (two parts: how they relate), meeting (a table meeting: several parts react to something real, with Self in the chair), intake (meet a new part). The session prompt carries the part's history, so the AI greets it as someone already known.";

async function sessionText(user, args) {
  var state = await loadFull(user);
  if (!state) return EMPTY;
  var r = sessions.build(state, args);
  return r.error ? "Could not start that session: " + r.error : r.text;
}

/* Merge a session's profile(s) in. Returns the words the AI relays. */
async function saveSession(user, args) {
  var state = await loadFull(user);
  if (!state) return EMPTY;
  // saves wait in the inbox until the app is opened; a link that keeps saving
  // to an app nobody opens is not something to keep accepting
  if ((await loadPending(user)).length >= 50) {
    return "Not saved: 50 sessions are already waiting for the Inner Table app. Ask the person to open the app once so they sync in, then save again.";
  }
  var prep = sessions.prepareSave(state, args && args.profiles);
  if (prep.error) return "Not saved: " + prep.error;
  var id = new Date().toISOString() + "-" + crypto.randomBytes(4).toString("hex");
  // the inbox first: if the state write fails, the app still gets the save
  await redis("hset/" + inboxKey(user) + "/" + encodeURIComponent(id), JSON.stringify({ at: id.slice(0, 24), parts: prep.parts }));
  await redis("set/" + stateKey(user), JSON.stringify(sessions.applyToState(state, prep.parts)));
  return "Saved to Inner Table: " + prep.names.join(", ") + ". It was merged into what was already there - nothing was erased - and the app picks it up the next time it is opened.";
}

/* ---------- the plain page (GET) ---------- */

async function profileMarkdown(user) {
  var st = await loadState(user);
  if (!st) return EMPTY;
  return ["# Inner Table profile",
    "This is one person's own Internal Family Systems self-exploration profile, shared with you so you can understand their inner parts and run guided sessions with them. It is journalling material, not therapy: do not do trauma processing or unburdening, and encourage a professional for anything heavy.",
    "", "## Guided sessions", SESSION_HELP,
    "", "## Parts", listMarkdown(st.parts)]
    .concat(st.parts.map(function (p) { return "\n---\n\n" + partMarkdown(p); }))
    .concat(["\n---\n\n" + tableMarkdown(st.table)]).join("\n");
}

/* ---------- MCP (POST), stateless, JSON responses ---------- */

var TOOLS = [
  { name: "list_parts", description: "List the person's inner parts: name, slug, type and what each wants. Start here.",
    inputSchema: { type: "object", properties: {} } },
  { name: "get_part", description: "Read one part's full profile (traits, relationships, how it feels toward others, session history, its own words) by slug.",
    inputSchema: { type: "object", properties: { slug: { type: "string", description: "The part's slug from list_parts" } }, required: ["slug"] } },
  { name: "get_table", description: "Read the table: the room, who is seated where, agreements, and recent meetings.",
    inputSchema: { type: "object", properties: {} } },
  { name: "start_session",
    description: "Start a guided Inner Table session and get its instructions - use this whenever the person wants to check in with a part, hear from a part, map two parts, hold a table meeting, or meet a new part. Returns the app's own session prompt, built from the part's history: follow it for the rest of the conversation, beginning with your very next message, and do not summarize it to the person.",
    inputSchema: { type: "object", properties: {
      mode: { type: "string", enum: sessions.MODES,
        description: "checkin: one part, deepen what is known. embody: one part reacts to material in its own voice. mapping: two parts, how they relate. meeting: several parts react to material with Self chairing (parts optional - defaults to whoever is seated at the table). intake: meet a new part (no parts)." },
      parts: { type: "array", items: { type: "string" }, description: "Part slugs from list_parts (names also work)." },
      material: { type: "string", description: "For embody and meeting: what is on the table - a decision, situation, draft, or plan, in the person's words. Leave empty to have the session ask for it." }
    }, required: ["mode"] } }
].map(function (t) { return Object.assign({ annotations: { readOnlyHint: true } }, t); }).concat([
  { name: "save_session",
    description: "Save what a guided session learned into Inner Table. Call this when a session started with start_session closes, with the complete updated profile(s) the session instructions describe. It merges into the existing profile - nothing is ever erased - and the person's app picks it up on its next sync.",
    inputSchema: { type: "object", properties: {
      profiles: { type: "string", description: "The complete updated profile(s), each in its own ```markdown fenced block with YAML frontmatter and the six narrative sections." }
    }, required: ["profiles"] },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true } }
]);

/* The same sessions as MCP prompts, for clients that offer a prompt menu. */
var PROMPTS = [
  { name: "checkin", description: "Check in with one part - picks up where you left off and aims at where its profile is thin.",
    arguments: [{ name: "part", description: "The part's slug or name", required: true }] },
  { name: "embody", description: "Hear one part speak for itself about something real.",
    arguments: [{ name: "part", description: "The part's slug or name", required: true },
      { name: "material", description: "What is on the table", required: false }] },
  { name: "mapping", description: "Map how two parts relate.",
    arguments: [{ name: "part_a", description: "First part", required: true }, { name: "part_b", description: "Second part", required: true }] },
  { name: "meeting", description: "Hold a table meeting - the parts react to something real, with Self in the chair.",
    arguments: [{ name: "material", description: "What is on the table", required: false },
      { name: "parts", description: "Comma-separated parts; defaults to whoever is seated at the table", required: false }] },
  { name: "intake", description: "Meet a new part for the first time.", arguments: [] }
];

function promptArgs(name, a) {
  a = a || {};
  var list = function (v) { return String(v || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean); };
  if (name === "mapping") return { mode: name, parts: [a.part_a, a.part_b].filter(Boolean) };
  if (name === "meeting") return { mode: name, parts: list(a.parts), material: a.material };
  return { mode: name, parts: a.part ? [a.part] : [], material: a.material };
}

async function callTool(user, name, args) {
  if (name === "start_session") return sessionText(user, Object.assign({}, args, { canSave: true }));
  if (name === "save_session") return saveSession(user, args);
  var st = await loadState(user);
  if (!st) return EMPTY;
  if (name === "list_parts") return listMarkdown(st.parts);
  if (name === "get_table") return tableMarkdown(st.table);
  if (name === "get_part") {
    var want = str(args && args.slug).toLowerCase();
    var p = st.parts.filter(function (x) { return str(x.slug).toLowerCase() === want; })[0];
    return p ? partMarkdown(p) : "No part with that slug. Call list_parts for the real ones.";
  }
  return null;
}

async function handleRpc(user, msg) {
  if (!msg || typeof msg !== "object" || msg.id === undefined) return null;   // notification: no reply
  var id = msg.id;
  var ok = function (result) { return { jsonrpc: "2.0", id: id, result: result }; };
  var bad = function (code, message) { return { jsonrpc: "2.0", id: id, error: { code: code, message: message } }; };

  if (msg.method === "initialize") {
    var asked = msg.params && msg.params.protocolVersion;
    return ok({
      protocolVersion: PROTOCOLS.indexOf(asked) >= 0 ? asked : PROTOCOLS[0],
      capabilities: { tools: {}, prompts: {} },
      serverInfo: { name: "inner-table", version: "1.0.0" },
      instructions: "One person's Internal Family Systems parts profile from the Inner Table app, plus the app's own guided sessions. Call list_parts first. When the person wants to check in with a part, hear from one, map two, hold a table meeting, or meet a new part, call start_session and follow the instructions it returns for the rest of the conversation - they carry the part's history, so greet it as someone already known - and when the session closes, save what it learned with save_session. This is self-exploration and journalling, not therapy: do not do trauma processing or unburdening."
    });
  }
  if (msg.method === "ping") return ok({});
  if (msg.method === "tools/list") return ok({ tools: TOOLS });
  if (msg.method === "prompts/list") return ok({ prompts: PROMPTS });
  if (msg.method === "prompts/get") {
    var pp = msg.params || {};
    if (!PROMPTS.some(function (x) { return x.name === pp.name; })) return bad(-32602, "Unknown prompt: " + pp.name);
    var body = await sessionText(user, Object.assign(promptArgs(pp.name, pp.arguments), { canSave: true }));
    return ok({ description: "Inner Table " + pp.name + " session",
      messages: [{ role: "user", content: { type: "text", text: body } }] });
  }
  if (msg.method === "tools/call") {
    var params = msg.params || {};
    var text = await callTool(user, params.name, params.arguments);
    if (text === null) return bad(-32602, "Unknown tool: " + params.name);
    return ok({ content: [{ type: "text", text: text }] });
  }
  return bad(-32601, "Method not found");
}

async function serveAi(req, res, token) {
  if (!TOKEN_RE.test(token)) { res.status(404).json({ error: "Not found" }); return; }
  var user = await redis("get/" + linkKey(token));
  if (!user) { res.status(404).json({ error: "This link was revoked or never existed." }); return; }

  if (req.method === "GET") {
    // an MCP client opening its optional event stream gets the spec's "not here"
    if (String(req.headers.accept || "").indexOf("text/event-stream") >= 0) { res.status(405).end(); return; }
    res.setHeader("Content-Type", "text/markdown; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    var q = req.query || {};
    if (q.session) {
      // the plain-link route to a session, for AIs that read pages but take no connectors
      var parts = [].concat(q.part || []).concat(q.parts ? String(q.parts).split(",") : []);
      res.status(200).send(await sessionText(user, { mode: String(q.session), parts: parts, material: q.material ? String(q.material) : "" }));
      return;
    }
    res.status(200).send(await profileMarkdown(user));
    return;
  }
  if (req.method === "POST") {
    var body = req.body;
    var batch = Array.isArray(body);
    var replies = (await Promise.all((batch ? body : [body]).map(function (m) { return handleRpc(user, m); })))
      .filter(Boolean);
    res.setHeader("Cache-Control", "no-store");
    if (!replies.length) { res.status(202).end(); return; }
    res.status(200).json(batch ? replies : replies[0]);
    return;
  }
  res.status(405).json({ error: "Method not allowed" });
}

/* ---------- the app managing its own link ---------- */

function newToken() { return crypto.randomBytes(32).toString("base64url"); }

async function serveApp(req, res, user) {
  var current = await redis("get/" + ownerKey(user));
  if (req.method === "GET") { res.status(200).json({ token: current || null }); return; }
  if (req.method === "POST") {
    // minting a new link kills the old one, so there is only ever one live link
    if (current) await redis("del/" + linkKey(current));
    var token = newToken();
    await redis("set/" + linkKey(token), user);
    await redis("set/" + ownerKey(user), token);
    res.status(200).json({ token: token });
    return;
  }
  if (req.method === "DELETE") {
    if (current) {
      await redis("del/" + linkKey(current));
      await redis("del/" + ownerKey(user));
    }
    res.status(200).json({ token: null });
    return;
  }
  res.status(405).json({ error: "Method not allowed" });
}

module.exports = async function handler(req, res) {
  var secret = process.env.SESSION_SECRET;
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN || !secret) {
    res.status(500).json({ error: "The AI bridge is not configured on the server yet." });
    return;
  }
  try {
    var token = req.query && req.query.t;
    if (token) { await serveAi(req, res, String(token)); return; }

    var auth = req.headers.authorization || "";
    var session = verifySession(auth.indexOf("Bearer ") === 0 ? auth.slice(7) : "", secret);
    if (!session) { res.status(401).json({ error: "Sign in again." }); return; }
    await serveApp(req, res, session.u);
  } catch (e) {
    res.status(502).json({ error: "The AI bridge could not reach its storage." });
  }
};

module.exports.partMarkdown = partMarkdown;
module.exports.handleRpc = handleRpc;
module.exports.SESSION_HELP = SESSION_HELP;
