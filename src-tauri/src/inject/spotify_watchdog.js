// Spotify resilience watchdog. Injected only for open.spotify.com builds
// (gated in app/window.rs). Two failure modes observed after many hours of
// uptime in a packaged WKWebView, neither of which Spotify's web player
// recovers from on its own:
//
// 1. The Connect "dealer" WebSocket dies as a half-open TCP connection. No
//    `close` event fires, so the player never reconnects, the backend expires
//    the device registration, and every playback command is rejected with
//    410 Gone until the page is reloaded.
// 2. WebKit's HLS segment loader wedges: the media element reports playing
//    while `currentTime` stays frozen and the buffer never refills.
//
// Remedies, least destructive first: a dealer socket silent past
// DEALER_SILENCE_MS is force-closed so Spotify's own reconnect logic
// re-registers the device; frozen playback or repeated 410s trigger a
// rate-limited page reload.
(function () {
  'use strict';

  if (window.__pakeSpotifyWatchdog) {
    return;
  }
  window.__pakeSpotifyWatchdog = true;

  // Dealer traffic (pings, state pushes) normally flows at least once a minute.
  var DEALER_SILENCE_MS = 5 * 60 * 1000;
  var CHECK_INTERVAL_MS = 15 * 1000;
  var FROZEN_CHECKS_LIMIT = 4; // ~60s of "playing" with a frozen clock
  var RELOAD_COOLDOWN_MS = 10 * 60 * 1000;
  var RELOAD_STAMP_KEY = '__pakeWatchdogReloadAt';

  function reload(reason) {
    var now = Date.now();
    var last = 0;
    try {
      last = Number(sessionStorage.getItem(RELOAD_STAMP_KEY)) || 0;
    } catch (e) {}
    if (now - last < RELOAD_COOLDOWN_MS) {
      return;
    }
    try {
      sessionStorage.setItem(RELOAD_STAMP_KEY, String(now));
    } catch (e) {}
    console.warn('[pake-spotify-watchdog] reloading: ' + reason);
    location.reload();
  }

  // Wrap WebSocket before Spotify creates the dealer connection so silence on
  // an OPEN socket can be detected from page start.
  var dealers = [];
  var NativeWebSocket = window.WebSocket;
  function WatchedWebSocket(url, protocols) {
    var ws =
      protocols === undefined
        ? new NativeWebSocket(url)
        : new NativeWebSocket(url, protocols);
    try {
      if (/dealer\./i.test(String(url))) {
        var entry = { ws: ws, lastMessage: Date.now() };
        dealers.push(entry);
        ws.addEventListener('message', function () {
          entry.lastMessage = Date.now();
        });
        ws.addEventListener('close', function () {
          var index = dealers.indexOf(entry);
          if (index >= 0) {
            dealers.splice(index, 1);
          }
        });
      }
    } catch (e) {}
    return ws;
  }
  WatchedWebSocket.prototype = NativeWebSocket.prototype;
  WatchedWebSocket.CONNECTING = NativeWebSocket.CONNECTING;
  WatchedWebSocket.OPEN = NativeWebSocket.OPEN;
  WatchedWebSocket.CLOSING = NativeWebSocket.CLOSING;
  WatchedWebSocket.CLOSED = NativeWebSocket.CLOSED;
  window.WebSocket = WatchedWebSocket;

  // Spotify keeps its playback element detached from the DOM, so it cannot be
  // found with querySelector; grab a reference whenever anything calls play().
  var mediaElements = [];
  var nativePlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (mediaElements.indexOf(this) < 0) {
      mediaElements.push(this);
    }
    return nativePlay.apply(this, arguments);
  };

  // 410 Gone from playback endpoints means the backend dropped this device's
  // registration; the player never re-registers on its own.
  var goneCount = 0;
  var nativeFetch = window.fetch;
  window.fetch = function (input) {
    var result = nativeFetch.apply(this, arguments);
    try {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (/track-playback|connect-state/.test(url)) {
        result.then(
          function (response) {
            if (response.status === 410) {
              goneCount += 1;
              if (goneCount >= 2) {
                reload('device registration expired (410 Gone)');
              }
            } else if (response.ok) {
              goneCount = 0;
            }
          },
          function () {}
        );
      }
    } catch (e) {}
    return result;
  };

  var frozenChecks = 0;
  var lastElement = null;
  var lastCurrentTime = -1;
  setInterval(function () {
    var now = Date.now();

    for (var i = 0; i < dealers.length; i++) {
      var dealer = dealers[i];
      if (
        dealer.ws.readyState === NativeWebSocket.OPEN &&
        now - dealer.lastMessage > DEALER_SILENCE_MS
      ) {
        console.warn(
          '[pake-spotify-watchdog] dealer socket silent, forcing reconnect'
        );
        dealer.lastMessage = now; // one close per silence window
        try {
          dealer.ws.close();
        } catch (e) {}
      }
    }

    var playing = null;
    for (var j = mediaElements.length - 1; j >= 0; j--) {
      var el = mediaElements[j];
      if (!el.paused && !el.ended && el.readyState > 0) {
        playing = el;
        break;
      }
    }
    if (
      playing &&
      playing === lastElement &&
      playing.currentTime === lastCurrentTime
    ) {
      frozenChecks += 1;
      if (frozenChecks >= FROZEN_CHECKS_LIMIT) {
        frozenChecks = 0;
        reload('media element claims playing but its clock is frozen');
      }
    } else {
      frozenChecks = 0;
    }
    lastElement = playing;
    lastCurrentTime = playing ? playing.currentTime : -1;
  }, CHECK_INTERVAL_MS);
})();
