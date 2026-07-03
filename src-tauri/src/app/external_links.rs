use serde::Deserialize;
use tauri::{command, AppHandle, Url};
use tauri_plugin_opener::OpenerExt;

#[derive(Debug, Deserialize)]
pub struct OpenExternalUrlParams {
    url: String,
}

pub(crate) fn is_slack_host(host: &str) -> bool {
    let host = host.trim_end_matches('.').to_ascii_lowercase();
    host == "slack.com" || host.ends_with(".slack.com")
}

pub(crate) fn is_slack_url(value: &str) -> bool {
    Url::parse(value)
        .ok()
        .and_then(|url| url.host_str().map(is_slack_host))
        .unwrap_or(false)
}

pub(crate) fn is_spotify_url(value: &str) -> bool {
    Url::parse(value)
        .ok()
        .and_then(|url| {
            url.host_str().map(|host| {
                let host = host.trim_end_matches('.').to_ascii_lowercase();
                host == "open.spotify.com"
            })
        })
        .unwrap_or(false)
}

fn is_allowed_external_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some_and(|host| !is_slack_host(host))
}

#[command]
pub fn open_external_url(app: AppHandle, params: OpenExternalUrlParams) -> Result<bool, String> {
    let url = Url::parse(&params.url).map_err(|error| format!("Invalid URL: {error}"))?;

    if !is_allowed_external_url(&url) {
        return Ok(false);
    }

    app.opener()
        .open_url(url.as_str(), None::<&str>)
        .map_err(|error| format!("Failed to open URL: {error}"))?;

    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn allowed(url: &str) -> bool {
        is_allowed_external_url(&Url::parse(url).unwrap())
    }

    #[test]
    fn external_https_url_is_allowed() {
        assert!(allowed("https://example.com/path?q=1"));
    }

    #[test]
    fn external_http_url_is_allowed() {
        assert!(allowed("http://example.com"));
    }

    #[test]
    fn slack_workspace_url_is_internal() {
        assert!(!allowed(
            "https://blueprint-finance.slack.com/archives/C123"
        ));
    }

    #[test]
    fn slack_root_url_is_internal() {
        assert!(!allowed("https://slack.com/signin"));
    }

    #[test]
    fn slack_url_detection_matches_only_slack_hosts() {
        assert!(is_slack_url("https://slack.com/signin"));
        assert!(is_slack_url("https://blueprint-finance.slack.com/messages"));
        assert!(!is_slack_url("https://meet.google.com"));
        assert!(!is_slack_url("https://slack.com.evil.example"));
        assert!(!is_slack_url("javascript:alert(1)"));
    }

    #[test]
    fn spotify_url_detection_matches_only_the_web_player_host() {
        assert!(is_spotify_url("https://open.spotify.com"));
        assert!(is_spotify_url("https://open.spotify.com/playlist/xyz"));
        assert!(!is_spotify_url("https://spotify.com"));
        assert!(!is_spotify_url("https://open.spotify.com.evil.example"));
        assert!(!is_spotify_url("javascript:alert(1)"));
    }

    #[test]
    fn slack_hostname_suffix_trick_is_external() {
        assert!(allowed("https://not-slack.com"));
        assert!(allowed("https://slack.com.evil.example"));
    }

    #[test]
    fn non_web_schemes_are_rejected() {
        for url in [
            "javascript:alert(1)",
            "data:text/html,hello",
            "file:///etc/passwd",
            "blob:https://example.com/id",
        ] {
            assert!(!allowed(url), "{url} should not be allowed");
        }
    }
}
