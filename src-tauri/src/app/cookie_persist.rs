//! macOS: persist session-only login cookies across app restarts.
//!
//! Some sites (e.g. Spotify) keep their login credential in a cookie that
//! WKWebView treats as *session-only* — it is held in memory and never written
//! to disk, so it is discarded when the app quits and the user is logged out on
//! the next launch. This periodically rewrites session-only cookies as
//! persistent (a far-future expiry) so WebKit writes them to disk; on the next
//! launch they load from disk and the session survives.
//!
//! This only upgrades a cookie's lifetime — it never changes names or values —
//! and runs entirely against the webview's own `WKHTTPCookieStore`.

use std::time::Duration;

use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use objc2_foundation::NSString;
use tauri::WebviewWindow;

/// How often to sweep the cookie store. Short enough that a freshly-issued login
/// cookie is persisted well before the user quits.
const SWEEP_INTERVAL: Duration = Duration::from_secs(20);

/// Expiry applied to rewritten session cookies (~1 year), matching what sites
/// normally set for long-lived login cookies.
const PERSIST_SECONDS: f64 = 365.0 * 24.0 * 60.0 * 60.0;

/// Spawn a background sweep that keeps this window's session cookies persistent.
pub fn start(window: WebviewWindow) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(SWEEP_INTERVAL).await;
            // WebKit cookie APIs must be touched on the main thread.
            let caller = window.clone();
            let target = window.clone();
            let _ = caller.run_on_main_thread(move || sweep(&target));
        }
    });
}

fn sweep(window: &WebviewWindow) {
    let _ = window.with_webview(|webview| unsafe {
        let wk_webview = webview.inner() as *mut AnyObject;
        if wk_webview.is_null() {
            return;
        }
        let configuration: *mut AnyObject = msg_send![wk_webview, configuration];
        let data_store: *mut AnyObject = msg_send![configuration, websiteDataStore];
        let cookie_store: *mut AnyObject = msg_send![data_store, httpCookieStore];
        if cookie_store.is_null() {
            return;
        }

        let store_for_block = cookie_store;
        let handler = RcBlock::new(move |cookies: *mut AnyObject| {
            persist_all_session_cookies(store_for_block, cookies);
        });
        let _: () = msg_send![cookie_store, getAllCookies: &*handler];
    });
}

/// SAFETY: invoked by WebKit on the main thread with a valid `NSArray<NSHTTPCookie *>`.
unsafe fn persist_all_session_cookies(cookie_store: *mut AnyObject, cookies: *mut AnyObject) {
    if cookies.is_null() {
        return;
    }
    let count: usize = msg_send![cookies, count];
    for index in 0..count {
        let cookie: *mut AnyObject = msg_send![cookies, objectAtIndex: index];
        let session_only: bool = msg_send![cookie, isSessionOnly];
        if !session_only {
            continue;
        }

        // Copy the cookie's properties and add a far-future expiry so WebKit
        // treats it as persistent and writes it to disk.
        let properties: *mut AnyObject = msg_send![cookie, properties];
        if properties.is_null() {
            continue;
        }
        // mutableCopy returns +1 retained; take ownership so it is released
        // when this iteration ends instead of leaking every sweep.
        let mutable: Option<Retained<AnyObject>> =
            Retained::from_raw(msg_send![properties, mutableCopy]);
        let Some(mutable) = mutable else {
            continue;
        };
        let expires: *mut AnyObject =
            msg_send![class!(NSDate), dateWithTimeIntervalSinceNow: PERSIST_SECONDS];
        // NSHTTPCookiePropertyKey raw values.
        let expires_key = NSString::from_str("Expires");
        let discard_key = NSString::from_str("Discard");
        let _: () = msg_send![&*mutable, setObject: expires, forKey: &*expires_key];
        let _: () = msg_send![&*mutable, removeObjectForKey: &*discard_key];

        let new_cookie: *mut AnyObject =
            msg_send![class!(NSHTTPCookie), cookieWithProperties: &*mutable];
        if new_cookie.is_null() {
            continue;
        }
        let no_completion = None::<&block2::Block<dyn Fn()>>;
        let _: () =
            msg_send![cookie_store, setCookie: new_cookie, completionHandler: no_completion];
    }
}
