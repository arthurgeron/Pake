(function () {
  if (window.__PAKE_SLACK_LINK_BRIDGE__) return;
  window.__PAKE_SLACK_LINK_BRIDGE__ = true;

  const host = window.location.hostname.toLowerCase();
  const isCurrentSlackHost = host === "slack.com" || host.endsWith(".slack.com");
  if (!isCurrentSlackHost) return;

  const internals = window.__TAURI_INTERNALS__;
  if (!internals || typeof internals.invoke !== "function") return;

  function parseUrl(rawUrl) {
    if (!rawUrl) return null;

    try {
      return new URL(rawUrl, window.location.href);
    } catch (_) {
      return null;
    }
  }

  function isSlackUrl(url) {
    const targetHost = url.hostname.toLowerCase();
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      (targetHost === "slack.com" || targetHost.endsWith(".slack.com"))
    );
  }

  function isExternalWebUrl(url) {
    return (url.protocol === "http:" || url.protocol === "https:") && !isSlackUrl(url);
  }

  function openExternal(url) {
    return internals
      .invoke("open_external_url", { params: { url: url.href } })
      .catch(() => false);
  }

  function navigateInPlace(url) {
    window.location.href = url.href;
  }

  document.addEventListener(
    "click",
    (event) => {
      if (event.defaultPrevented || event.button !== 0) return;

      const anchor = event.target && event.target.closest && event.target.closest("a[href]");
      if (!anchor) return;

      const url = parseUrl(anchor.getAttribute("href") || anchor.href);
      if (!url) return;

      if (isSlackUrl(url)) {
        if (
          anchor.target ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          event.preventDefault();
          event.stopPropagation();
          navigateInPlace(url);
        }
        return;
      }

      if (isExternalWebUrl(url)) {
        event.preventDefault();
        event.stopPropagation();
        openExternal(url);
      }
    },
    true
  );

  const originalOpen = window.open;
  window.open = function (rawUrl, target, features) {
    const url = parseUrl(rawUrl);

    if (url) {
      if (isSlackUrl(url)) {
        navigateInPlace(url);
        return window;
      }

      if (isExternalWebUrl(url)) {
        openExternal(url);
        return null;
      }
    }

    return originalOpen.call(window, rawUrl, target, features);
  };
})();
