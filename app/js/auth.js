/* Inner Table - session for the optional cross-device sync feature.
   Local-only use needs none of this; it only gates syncing. */
(function () {
  "use strict";
  var SESSION_KEY = "innertable.session";

  function getSession() {
    try { var raw = localStorage.getItem(SESSION_KEY); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function isLoggedIn() {
    var s = getSession();
    return !!(s && s.token && s.exp > Date.now());
  }
  function getToken() {
    var s = getSession();
    return s ? s.token : null;
  }
  function getUsername() {
    var s = getSession();
    return s ? s.username : null;
  }

  async function login(username, password) {
    var r = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, password: password })
    });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(data.error || "sign in failed");
    // server TTL is 30 days; keep the local mirror slightly shorter so a
    // clock-skewed device never presents a token the server has expired.
    var exp = Date.now() + 29 * 24 * 60 * 60 * 1000;
    localStorage.setItem(SESSION_KEY, JSON.stringify({ token: data.token, username: data.username, exp: exp }));
    return data.username;
  }

  /* Create the account, then sign in with the same credentials - only
     api/login.js ever mints a session, so there is one path to get one. */
  async function signup(username, password) {
    var r = await fetch("/api/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username, password: password })
    });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(data.error || "could not create that account");
    return login(username, password);
  }

  function logout() { localStorage.removeItem(SESSION_KEY); }

  window.IFS.auth = {
    isLoggedIn: isLoggedIn,
    getToken: getToken,
    getUsername: getUsername,
    login: login,
    signup: signup,
    logout: logout
  };
})();
