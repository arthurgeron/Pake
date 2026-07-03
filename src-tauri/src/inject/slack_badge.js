(function () {
  if (window.__PAKE_SLACK_BADGE_BRIDGE__) return;
  window.__PAKE_SLACK_BADGE_BRIDGE__ = true;

  const host = window.location.hostname.toLowerCase();
  const isSlackHost = host === "slack.com" || host.endsWith(".slack.com");
  if (!isSlackHost) return;

  const internals = window.__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== "function") return;

  const windowLabel = internals.metadata?.currentWindow?.label || "pake";
  const MAX_BADGE_COUNT = 99999;
  let lastBadgeKey = "";
  let titleSyncTimer = null;

  const invoke = (cmd, args) => internals.invoke(cmd, args).catch(() => {});

  function normalizeCount(value) {
    if (value === undefined) return 1;
    if (value === null) return null;

    const count = Math.floor(Number(value));
    if (!Number.isFinite(count) || count <= 0) return null;

    return Math.min(count, MAX_BADGE_COUNT);
  }

  function normalizeLabel(value) {
    if (value === undefined || value === null) return null;
    const label = String(value).trim();
    if (!label) return null;
    return label.slice(0, 16);
  }

  function setNativeBadge(count, label) {
    const normalizedCount = normalizeCount(count);
    const normalizedLabel = normalizedCount ? null : normalizeLabel(label);
    const badgeKey = `${normalizedCount || ""}:${normalizedLabel || ""}`;

    if (badgeKey === lastBadgeKey) return Promise.resolve();
    lastBadgeKey = badgeKey;

    if (normalizedCount) {
      return Promise.allSettled([
        invoke("plugin:window|set_badge_count", {
          label: windowLabel,
          value: normalizedCount,
        }),
        invoke("plugin:window|set_badge_label", {
          label: windowLabel,
          value: null,
        }),
      ]).then(() => undefined);
    }

    if (normalizedLabel) {
      return Promise.allSettled([
        invoke("plugin:window|set_badge_count", {
          label: windowLabel,
          value: null,
        }),
        invoke("plugin:window|set_badge_label", {
          label: windowLabel,
          value: normalizedLabel,
        }),
      ]).then(() => undefined);
    }

    return Promise.allSettled([
      invoke("plugin:window|set_badge_count", {
        label: windowLabel,
        value: null,
      }),
      invoke("plugin:window|set_badge_label", {
        label: windowLabel,
        value: null,
      }),
    ]).then(() => undefined);
  }

  function deriveBadgeFromTitle() {
    const title = document.title || "";
    const leadingCount = title.match(/^\((\d{1,5})\)/);
    if (leadingCount) {
      return { count: Number(leadingCount[1]), label: null };
    }

    const unreadCount = title.match(/\b(\d{1,5})\s+(?:unread|new)\b/i);
    if (unreadCount) {
      return { count: Number(unreadCount[1]), label: null };
    }

    if (/^\s*[•*]/.test(title) || /\bunread\b/i.test(title)) {
      return { count: null, label: "•" };
    }

    return { count: null, label: null };
  }

  function syncBadgeFromTitle() {
    const badge = deriveBadgeFromTitle();
    setNativeBadge(badge.count, badge.label);
  }

  function scheduleTitleSync(delay = 150) {
    clearTimeout(titleSyncTimer);
    titleSyncTimer = setTimeout(syncBadgeFromTitle, delay);
  }

  Object.defineProperty(navigator, "setAppBadge", {
    configurable: true,
    value: (count) => setNativeBadge(count, null),
  });

  Object.defineProperty(navigator, "clearAppBadge", {
    configurable: true,
    value: () => setNativeBadge(null, null),
  });

  function watchTitle() {
    const titleEl = document.querySelector("title");
    if (!titleEl) {
      scheduleTitleSync(500);
      return;
    }

    new MutationObserver(() => scheduleTitleSync()).observe(titleEl, {
      childList: true,
      characterData: true,
      subtree: true,
    });
    scheduleTitleSync();
  }

  window.addEventListener("focus", () => scheduleTitleSync(500));
  document.addEventListener("visibilitychange", () => scheduleTitleSync(500));
  setInterval(syncBadgeFromTitle, 5000);

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", watchTitle, { once: true });
  } else {
    watchTitle();
  }
})();
