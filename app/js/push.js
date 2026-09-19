/* Inner Table - Web Push subscribe/unsubscribe/test for this device, plus
   its own Settings row. Notifications are tied to the signed-in account
   (the server has nowhere else to keep a subscription), and on iOS the
   Push API only exists once the app is running standalone from the home
   screen - Safari itself exposes none of this.

   The settings row is injected here rather than added to ui.js's
   renderSettings(): that function rewrites #settingsPane's innerHTML
   wholesale on every render (theme change, sign in/out, ...), wiping
   anything not built into it - so instead this file watches that element
   and reinserts its own group whenever ui.js clears it. */
(function () {
  "use strict";
  var AUTH = window.IFS.auth;
  var F = window.IFS.files;

  var toastTimer = null;
  function toast(msg) {
    var el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.remove("hidden");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add("hidden"); }, 2600);
  }

  function isStandalone() {
    return matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  }

  function supported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }

  function urlBase64ToUint8Array(base64) {
    var padding = "=".repeat((4 - (base64.length % 4)) % 4);
    var b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
    var raw = atob(b64);
    var out = new Uint8Array(raw.length);
    for (var i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  function authHeaders() {
    return { "Content-Type": "application/json", "Authorization": "Bearer " + AUTH.getToken() };
  }

  async function getSubscription() {
    if (!supported()) return null;
    var reg = await navigator.serviceWorker.ready;
    return reg.pushManager.getSubscription();
  }

  async function isSubscribed() {
    return !!(await getSubscription());
  }

  async function subscribe() {
    if (!supported()) throw new Error("This browser doesn't support notifications.");
    if (!AUTH.isLoggedIn()) throw new Error("Sign in first - notifications are tied to your account.");
    if (Notification.permission === "denied") {
      throw new Error("Notifications are blocked for this app - check your browser or phone settings.");
    }

    var perm = await Notification.requestPermission();
    if (perm !== "granted") throw new Error("Permission wasn't granted.");

    var keyRes = await fetch("/api/vapid-public-key");
    var keyData = await keyRes.json().catch(function () { return {}; });
    if (!keyRes.ok || !keyData.publicKey) throw new Error("Push is not configured on the server yet.");

    var reg = await navigator.serviceWorker.ready;
    var sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(keyData.publicKey)
    }));

    var r = await fetch("/api/push-subscribe", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ subscription: sub.toJSON() })
    });
    if (!r.ok) throw new Error("Could not save your subscription - try again.");
    return sub;
  }

  /* tokenOverride: logout() below clears the session token synchronously,
     before this async chain reaches the point of reading it - so it
     captures the token first and hands it in, rather than this function
     reading AUTH.getToken() fresh and finding it already gone. */
  async function unsubscribe(tokenOverride) {
    var sub = await getSubscription();
    if (!sub) return;
    var endpoint = sub.endpoint;
    try { await sub.unsubscribe(); } catch (e) {}
    var token = tokenOverride || AUTH.getToken();
    if (token) {
      await fetch("/api/push-subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token },
        body: JSON.stringify({ endpoint: endpoint })
      }).catch(function () {});
    }
  }

  async function sendTest() {
    var r = await fetch("/api/push-send", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ title: "Inner Table", body: "Notifications are working on this device." })
    });
    var data = await r.json().catch(function () { return {}; });
    if (!r.ok) throw new Error(data.error || "Could not send a test notification.");
    return data;
  }

  // signing out must also drop the subscription, or the device keeps
  // getting this account's notifications after it's no longer signed in -
  // wrapped rather than added to ui.js's sign-out handler, for the same
  // reason the settings row is injected below
  var origLogout = AUTH.logout;
  AUTH.logout = function () {
    var token = AUTH.getToken();
    unsubscribe(token).catch(function () {});
    return origLogout.apply(AUTH, arguments);
  };

  /* ================= settings row ================= */
  var GROUP_ID = "pushSettingsGroup";
  var cachedSubscribed = null;

  function groupHTML() {
    var html = '<div class="set-group" id="' + GROUP_ID + '"><h3>Notifications</h3>';
    if (!AUTH.isLoggedIn()) {
      html += '<div class="set-row"><span class="sr-main">Sign in required<span class="sr-sub">notifications are tied to your account, like sync</span></span></div>';
    } else if (F.isIOS() && !isStandalone()) {
      html += '<div class="set-row"><span class="sr-main">Add to Home Screen first<span class="sr-sub">iOS only allows notifications for the installed app</span></span></div>';
    } else if (!supported()) {
      html += '<div class="set-row"><span class="sr-main">Not supported here<span class="sr-sub">try this on your phone, from the home-screen app</span></span></div>';
    } else if (cachedSubscribed) {
      html += '<div class="set-row"><span class="sr-main">Notifications on<span class="sr-sub">this device can receive them</span></span><button class="btn btn-soft" id="pushTestBtn">Send test</button></div>' +
        '<div class="set-row"><span class="sr-main">Turn off<span class="sr-sub">stop notifications on this device</span></span><button class="btn btn-soft" id="pushOffBtn">Turn off</button></div>';
    } else {
      html += '<div class="set-row"><span class="sr-main">Get notified on this device<span class="sr-sub">asks for permission, once</span></span><button class="btn btn-soft" id="pushOnBtn">Enable</button></div>';
    }
    html += '<p class="dim" style="margin:12px 14px 14px">Only this device is notified once enabled &mdash; turn it on separately on each phone or computer you use Inner Table on.</p></div>';
    return html;
  }

  function wire(group) {
    var onBtn = group.querySelector("#pushOnBtn");
    if (onBtn) onBtn.addEventListener("click", async function () {
      try { await subscribe(); cachedSubscribed = true; paint(); toast("Notifications are on for this device"); }
      catch (e) { toast(e.message || "Could not turn on notifications"); }
    });
    var offBtn = group.querySelector("#pushOffBtn");
    if (offBtn) offBtn.addEventListener("click", async function () {
      await unsubscribe();
      cachedSubscribed = false;
      paint();
      toast("Notifications are off for this device");
    });
    var testBtn = group.querySelector("#pushTestBtn");
    if (testBtn) testBtn.addEventListener("click", async function () {
      testBtn.disabled = true;
      testBtn.textContent = "Sending…";
      try { await sendTest(); toast("Sent - it should arrive any moment"); }
      catch (e) { toast(e.message || "Could not send a test notification"); }
      testBtn.disabled = false;
      testBtn.textContent = "Send test";
    });
  }

  var painting = false;
  function paint() {
    var pane = document.getElementById("settingsPane");
    if (!pane) return;
    painting = true;
    var existing = document.getElementById(GROUP_ID);
    var temp = document.createElement("div");
    temp.innerHTML = groupHTML();
    var node = temp.firstElementChild;
    if (existing) {
      existing.replaceWith(node);
    } else {
      var firstGroup = pane.querySelector(".set-group");
      if (firstGroup) firstGroup.insertAdjacentElement("afterend", node);
      else pane.appendChild(node);
    }
    wire(node);
    painting = false;
  }

  function refreshAndPaint() {
    if (!supported()) { cachedSubscribed = false; paint(); return; }
    isSubscribed().then(function (v) { cachedSubscribed = v; paint(); });
  }

  // ui.js's renderSettings() replaces #settingsPane's whole innerHTML on
  // every render, which erases this group - so watch for that and put it
  // back rather than trying to render once and be done
  function watchSettingsPane() {
    var pane = document.getElementById("settingsPane");
    if (!pane) return;
    var mo = new MutationObserver(function () {
      if (painting) return;
      if (!document.getElementById(GROUP_ID)) refreshAndPaint();
    });
    mo.observe(pane, { childList: true });
    refreshAndPaint();
  }
  watchSettingsPane();

  window.IFS = window.IFS || {};
  window.IFS.push = {
    supported: supported,
    isSubscribed: isSubscribed,
    subscribe: subscribe,
    unsubscribe: unsubscribe,
    sendTest: sendTest
  };
})();
