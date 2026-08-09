/* The sync gate. These profiles are intimate, so the two properties worth
   proving are: only a token this server signed opens /api/sync, and the
   storage key comes from that token rather than from anything the caller
   sent - so one person's session can never address another's parts.
   The handlers are exercised for real; only Upstash is faked. */
"use strict";
var crypto = require("crypto");

process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = "fake-redis-token";
process.env.SESSION_SECRET = "test-session-secret";

var login = require("../api/login.js");
var sync = require("../api/sync.js");
var signup = require("../api/signup.js");

var calls = [];
var nextResult = null;   // what the fake Upstash returns for the next GET

function fakeFetch(url, opts) {
  calls.push({ url: String(url), opts: opts });
  return Promise.resolve({
    ok: true,
    json: function () { return Promise.resolve({ result: nextResult }); }
  });
}

function res() {
  return {
    code: 0,
    body: null,
    status: function (c) { this.code = c; return this; },
    json: function (b) { this.body = b; return this; }
  };
}

function record(password) {
  var salt = crypto.randomBytes(16).toString("hex");
  return JSON.stringify({ salt: salt, hash: crypto.scryptSync(password, salt, 64).toString("hex") });
}

function signWith(secret, payload) {
  var body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return body + "." + crypto.createHmac("sha256", secret).update(body).digest("base64url");
}

module.exports = async function (t) {
  var realFetch = globalThis.fetch;
  globalThis.fetch = fakeFetch;
  try {
    /* ---- login ---- */
    nextResult = record("correct horse");
    var ok = res();
    await login({ method: "POST", body: { username: "alice", password: "correct horse" } }, ok);
    t.eq(ok.code, 200, "right password signs in");
    t.ok(ok.body && ok.body.token, "a token comes back");
    var aliceToken = ok.body && ok.body.token;

    nextResult = record("correct horse");
    var bad = res();
    await login({ method: "POST", body: { username: "alice", password: "wrong" } }, bad);
    t.eq(bad.code, 401, "wrong password is refused");
    t.ok(!(bad.body && bad.body.token), "and hands out no token");

    nextResult = null;   // Upstash has no such user
    var nobody = res();
    await login({ method: "POST", body: { username: "ghost", password: "whatever" } }, nobody);
    t.eq(nobody.code, 401, "unknown user is refused");

    /* ---- signing yourself up ---- */
    nextResult = null;               // name is free
    calls.length = 0;
    var made = res();
    await signup({ method: "POST", body: { username: "newcomer", password: "eight-plus" } }, made);
    t.eq(made.code, 200, "a free name creates an account");
    t.ok(calls.length === 2 && calls[1].url.indexOf("innertable:user:newcomer") !== -1,
      "it checks the name is free, then writes it");
    t.ok(!(made.body && made.body.token), "sign-up mints no session of its own");

    /* the takeover case: signing up as someone who exists must not overwrite
       their record, or their parts would open with the new password */
    nextResult = record("their password");
    calls.length = 0;
    var taken = res();
    await signup({ method: "POST", body: { username: "alice", password: "my password" } }, taken);
    t.eq(taken.code, 409, "an existing name is refused");
    t.eq(calls.length, 1, "and nothing is written over them");

    nextResult = null;
    var weak = res();
    await signup({ method: "POST", body: { username: "newcomer", password: "short" } }, weak);
    t.eq(weak.code, 400, "a short password is refused");

    nextResult = null;
    var junk = res();
    await signup({ method: "POST", body: { username: "Not Valid!", password: "eight-plus" } }, junk);
    t.eq(junk.code, 400, "a malformed username is refused");

    /* ---- the gate ---- */
    var none = res();
    await sync({ method: "GET", headers: {} }, none);
    t.eq(none.code, 401, "no token is refused");

    var forged = res();
    await sync({ method: "GET", headers: { authorization: "Bearer " + signWith("not-the-secret", { u: "alice", exp: Date.now() + 60000 }) } }, forged);
    t.eq(forged.code, 401, "a token signed with the wrong secret is refused");

    var tampered = aliceToken.slice(0, aliceToken.indexOf(".")) + ".AAAA";
    var edited = res();
    await sync({ method: "GET", headers: { authorization: "Bearer " + tampered } }, edited);
    t.eq(edited.code, 401, "a token with a swapped signature is refused");

    var stale = res();
    await sync({ method: "GET", headers: { authorization: "Bearer " + signWith(process.env.SESSION_SECRET, { u: "alice", exp: Date.now() - 1000 }) } }, stale);
    t.eq(stale.code, 401, "an expired token is refused");

    /* ---- isolation: the key follows the token, not the request ---- */
    calls.length = 0;
    nextResult = '{"parts":{}}';
    var mine = res();
    await sync({ method: "GET", headers: { authorization: "Bearer " + aliceToken } }, mine);
    t.eq(mine.code, 200, "a valid token reads");
    t.ok(calls.length === 1 && calls[0].url.indexOf("innertable:state:alice") !== -1,
      "alice's token reads alice's key");

    calls.length = 0;
    var bobToken = signWith(process.env.SESSION_SECRET, { u: "bob", exp: Date.now() + 60000 });
    var bobRead = res();
    await sync({ method: "GET", headers: { authorization: "Bearer " + bobToken } }, bobRead);
    t.ok(calls[0].url.indexOf("innertable:state:bob") !== -1 &&
      calls[0].url.indexOf("alice") === -1, "bob's token cannot reach alice's key");

    /* a writer cannot aim at someone else's slot either */
    calls.length = 0;
    var write = res();
    await sync({ method: "POST", headers: { authorization: "Bearer " + bobToken }, body: { state: '{"parts":{}}', username: "alice" } }, write);
    t.eq(write.code, 200, "a valid token writes");
    t.ok(calls[0].url.indexOf("innertable:state:bob") !== -1 &&
      calls[0].url.indexOf("alice") === -1, "a username in the body cannot redirect the write");
  } finally {
    globalThis.fetch = realFetch;
  }
};
