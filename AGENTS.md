# AGENTS.md - Pake Project Knowledge Base

> Project-specific Rust + Tauri rules: `.claude/rules/rust.md`. Release runbook: `.claude/skills/release/SKILL.md` (run `/release`).

## Project Identity

**Pake** - Turn any webpage into a lightweight desktop app with one command.

- **Purpose**: Package any website into a ~5MB desktop app (20x smaller than Electron)
- **Stack**: Tauri v2 (Rust) + TypeScript CLI
- **Platforms**: macOS, Windows, Linux
- **Mechanism**: Uses system webview (WebKit on macOS/Linux, WebView2 on Windows)

## Repository Structure

```
Pake/
├── bin/                   # CLI source code (TypeScript)
│   └── cli.ts            # Main CLI entry (Commander.js)
├── src-tauri/             # Tauri Rust application
│   ├── src/              # Rust source code
│   ├── src/app/          # window creation, setup, menu, config, and invokes
│   ├── src/inject/       # injected JS/CSS behavior
│   ├── Cargo.toml        # Rust dependencies and version
│   ├── tauri.conf.json   # Tauri configuration and version
│   └── .cargo/           # Cargo configuration (gitignored)
├── dist/                 # Compiled CLI output
├── docs/                 # Documentation
│   ├── cli-usage.md      # CLI parameters
│   ├── advanced-usage.md # Customization guide
│   └── faq.md           # Troubleshooting
├── scripts/              # Utility scripts
├── tests/                # Unit, integration, and release-flow tests
├── .github/workflows/     # quality/test and release automation
├── default_app_list.json # Popular apps config for release builds
├── package.json          # Node.js dependencies and version
└── rollup.config.js      # CLI build configuration
```

## Development Commands

| Command                              | Purpose                                                         |
| ------------------------------------ | --------------------------------------------------------------- |
| `pnpm install`                       | Install dependencies                                            |
| `pnpm run dev`                       | Tauri development mode                                          |
| `pnpm run cli:dev -- <url>`          | CLI wrapper + Tauri (recommended)                               |
| `pnpm run cli:dev --iterative-build` | Faster dev (skip checks)                                        |
| `pnpm run cli:build`                 | Rollup + TypeScript check (catches type errors Prettier misses) |
| `pnpm run build`                     | Build for current platform                                      |
| `pnpm run build:mac`                 | macOS universal binary                                          |
| `pnpm run format`                    | Format code (prettier + cargo fmt)                              |
| `npx vitest run`                     | Unit and integration tests only (sub-second)                    |
| `pnpm test -- --no-build`            | Full suite minus the multi-arch real build                      |
| `pnpm test`                          | Full suite including release workflow                           |

Keep shared project facts in this file so Codex, Claude Code, and other agents use the same source of truth. `CLAUDE.md` is a symlink to this file, so edit `AGENTS.md` only. Local-only overrides (`CLAUDE.local.md`, `AGENTS.override.md`, `.claude/settings.local.json`) stay ignored.

## Local Hardened Web App Builds

Use these defaults when this local clone is used to package a personal web app, especially for login-heavy sites:

- Build on a per-app branch and use a unique app name and bundle id, such as `Example Hardened` and `com.pake.example.hardened`, so the result does not collide with any installed app.
- Keep `src-tauri/tauri.conf.json` hardened with `"withGlobalTauri": false`.
- Keep `src-tauri/capabilities/default.json` without a `remote` block and with `"permissions": []` unless the user explicitly accepts a narrower native bridge.
- Do not inject Pake's generic helper/style scripts into arbitrary remote sites. In `src-tauri/src/app/window.rs`, prefer only the minimal `window.pakeConfig` initialization unless app-specific injected code has been reviewed.
- Compile and register only native plugins that are actually needed. Avoid exposing or compiling shell, HTTP download, notification, and OAuth plugins for a plain webview wrapper.
- Do not enable `--inject`, proxy URLs, certificate-error bypass, drag/drop, or new-window behavior unless the user asks for that capability and the added risk is called out.
- If doing a smoke launch, use a temporary profile or temporary `HOME` and do not sign into the user's real account unless they explicitly ask.
- For Slack-like apps that need native polish, keep the bridge app-specific and domain-scoped. Slack notifications and dock badges can use a narrow Slack `remote` capability plus exact notification/window badge permissions.
- For Slack external links, keep `slack.com` and `*.slack.com` inside the wrapper, but route external `http`/`https` links through a Rust command that parses the URL, rejects Slack hosts and non-web schemes, then opens through the native opener. Custom commands need a matching file under `src-tauri/permissions/` and a hyphenated permission id in `src-tauri/capabilities/default.json`. Do not grant broad `opener:*`, shell, HTTP, or OAuth permissions to the remote page for this.
- For Google Meet, default to a plain hardened wrapper: no remote IPC capability, no generic injected scripts, and no native notification bridge. Memory measurement is an external acceptance check, not an app feature; use `scripts/measure-macos-app-memory.sh "Google Meet" 5 <samples> <csv> com.pake.googlemeet.hardened pake-googlemeet` and sample baseline, in-call, and post-leave idle. On macOS, WebKit helpers can have `PPID 1`; include helpers by bundle-id cache ownership rather than relying only on child process trees.
- Google Meet needs hardened-runtime media entitlements in addition to `Info.plist` usage strings. Build it with Pake's `--camera --microphone` flags so the CLI writes `com.apple.security.device.camera` and `com.apple.security.device.audio-input` into `src-tauri/entitlements.plist`; without those flags, macOS may not show Camera/Microphone prompts even though the usage descriptions are present.
- The Meet RSS sampler is local tooling only. It must not be injected, bundled, or left running after measurement; a normal Meet build should contain no RAM/RSS listener.
- Slack bridges are intentionally URL-gated in Rust. When switching this local repo between Slack Native and plain apps such as Meet, make sure `src-tauri/capabilities/default.json` matches the current app's bridge needs before building.
- Spotify's web player has three long-uptime failure modes in a packaged WKWebView, all handled by wrapper code that must stay in place: (1) `sp_dc`/`sp_key` login cookies are session-only, so `src-tauri/src/app/cookie_persist.rs` rewrites them persistent or every quit logs the user out; (2) the Connect "dealer" WebSocket can die half-open — no `close` event, the player never reconnects, the backend expires the device registration, and playback commands return 410 Gone until reload; (3) WebKit's HLS loader can wedge — the media element reports playing with a frozen `currentTime` and a buffer that never refills, unrecoverable from page JS (seek and `load()` both fail). `src-tauri/src/inject/spotify_watchdog.js` (URL-gated to `open.spotify.com` in `window.rs`) force-closes silent dealer sockets to trigger Spotify's own reconnect and does a rate-limited reload on frozen playback or repeated 410s; `apps/spotify/Info.plist` disables App Nap. Spotify keeps its playback element detached from the DOM — diagnose via a `HTMLMediaElement.prototype.play` hook, not `querySelector`.

Typical macOS build flow from the repo root:

```bash
corepack pnpm@10.26.2 install
corepack pnpm@10.26.2 run cli:build
node dist/cli.js "https://example.com" \
  --name "Example Hardened" \
  --identifier "com.pake.example.hardened" \
  --icon src-tauri/icons/icon.icns \
  --width 1200 \
  --height 780 \
  --targets app \
  --keep-binary
```

Before handing the app back, verify the generated app-specific config and bundle:

```bash
jq '.app.withGlobalTauri, .identifier, .productName' src-tauri/.pake/tauri.conf.json
jq '.windows[0].url, .inject, .proxy_url, .windows[0].enable_drag_drop, .windows[0].ignore_certificate_errors, .windows[0].new_window' src-tauri/.pake/pake.json
jq '.permissions, has("remote")' src-tauri/capabilities/default.json
codesign --verify --deep --strict --verbose=4 "Example Hardened.app"
strings -a -n 8 "Example Hardened.app/Contents/MacOS/<binary-name>" | rg 'window\.__TAURI__|plugin:shell\|open|download_file|send_notification|tauri_plugin_shell|tauri_plugin_http|tauri_plugin_notification|tauri_plugin_oauth'
spctl --assess --type execute --verbose=4 "Example Hardened.app" || true
```

For ad-hoc local builds, `codesign --verify` should pass and `spctl` may reject the app because it is not Developer ID signed or notarized. Treat that as expected unless the user asked for a notarized distributable.

## Code Conventions

- No Chinese comments in any source (Rust / TypeScript / any file). Comments and identifiers in English; follow the existing language of surrounding prose.

## Task Intake And Investigation

Prefer requests with:

- `Goal`: exact bug, feature, refactor, or review target
- `Scope`: files, directories, or subsystem boundaries to inspect first
- `Repro`: command, input, fixture, or failing test
- `Expected`: expected behavior
- `Actual`: current behavior, error text, or regression note
- `Constraints`: what must not change
- `Verify`: minimum command or test that proves the result

When task scope is incomplete, inspect in this order:

1. CLI entry and option parsing under `bin/cli.ts`, `bin/options/`, and `bin/helpers/`
2. Target TypeScript module under `bin/`
3. Tauri runtime or packaging files under `src-tauri/src/` and `src-tauri/tauri*.conf.json`
4. Narrow tests under `tests/unit/` or `tests/integration/`
5. Release workflow files under `.github/workflows/` only for CI or release issues
6. Docs only if behavior, ownership, or expected usage is still unclear

Execution rules:

- Start with the smallest plausible file set
- Prefer targeted search (`rg <symbol|string> <paths>`) over repository-wide scans
- Ignore generated or output-heavy areas unless the task directly targets them, especially `dist/`, `node_modules/`, `src-tauri/target/`, `.app/`, `src-tauri/icons/`, and `src-tauri/png/`. Exception: `dist/cli.js` is the shipped CLI build artifact (see `package.json` `files`); when you change anything under `bin/`, rebuild it via `pnpm run cli:build` and commit the regenerated `dist/cli.js` alongside the source change
- If a task touches release status, issue closeout, npm delivery, or GitHub assets, verify live surfaces separately: source commit/tag, workflow run, npm registry, GitHub Release/assets, and issue state. Do not let one passing surface imply another
- Keep changes local to one subsystem when possible
- Run the narrowest relevant verification first, expand only if needed
- If key context is missing, make one reasonable assumption and proceed

## Current Risk Areas

- CLI options are user-facing and must stay synchronized across `bin/helpers/cli-program.ts`, `bin/types.ts`, `bin/defaults.ts`, `bin/helpers/merge.ts`, generated `dist/cli.js`, and `docs/cli-usage*.md`.
- Recent window/runtime options include `--incognito`, `--new-window`, `--min-width`, `--min-height`, `--maximize`, multi-window behavior, notification click handling, and Linux/Wayland WebKit compositing defaults.
- `--incognito` intentionally trades persistence for clean private sessions; be careful around login, cookies, local storage, and WeChat-style WebView detection.
- `--new-window` and `--multi-window` do not bypass every provider policy. Google OAuth and similar embedded-WebView restrictions may still require a normal browser or native client.
- macOS auth-popup behavior is fragile. Auth/sign-in URLs that trigger WebKit `SOAuthorization` popup creation should stay in the current window when that path can abort the app; changes in `src-tauri/src/inject/event.js` need targeted tests.
- Notification flows cross injected JS, Tauri invokes, capabilities, and native notification plugins. Verify the Rust capability and JS caller together.
- WebKit compositing behavior is platform-sensitive on Linux/Wayland. Runtime flag decisions live in `src-tauri/src/lib.rs`; keep the default conservative, cover compositor exceptions with unit tests, and document user-facing fallbacks in `docs/faq*.md`.
- Linux AppImage reports often include harmless GTK, appindicator, or GStreamer warnings. Separate optional runtime warnings from the actual symptom before changing code; input/click failures on pure Wayland compositors are not the same class as blank-window failures.
- Release state can be split. npm Trusted Publishing can succeed before the popular-app release workflow finishes, and GitHub Release assets can exist while a workflow run still shows queued or in progress. Report each surface explicitly.

## Platform-Specific Development

### macOS

- Universal builds via `--multi-arch` (Intel + Apple Silicon).
- Icons: `.icns`.
- Title bar can be customized via Tauri window options.

### Windows

- Requires Visual Studio Build Tools to compile.
- Icons: `.ico`.
- MSI installer supported via Tauri bundler.

### Linux

- Multiple package formats: `.deb`, `.AppImage`, `.rpm`.
- Runtime depends on `libwebkit2gtk` and its companion libraries.
- Icons: `.png`.
- WebKit compositing is platform-sensitive on Wayland; see Current Risk Areas before changing defaults.

## Branch Strategy

- `main` - Only branch. All development and releases happen here directly.

## Version Management

Four files must be updated in sync for every release:

| File                        | Field                        |
| --------------------------- | ---------------------------- |
| `package.json`              | `"version"`                  |
| `src-tauri/Cargo.toml`      | `version` under `[package]`  |
| `src-tauri/Cargo.lock`      | `version` for package `pake` |
| `src-tauri/tauri.conf.json` | `"version"`                  |

Tag format: `V0.x.x` (uppercase V). Current version: check `package.json`.

## Release Workflow (CI)

Pushing a `V*` tag triggers `.github/workflows/release.yml`:

1. **release-apps** - reads `default_app_list.json` for app list
2. **create-release** - creates the GitHub Release placeholder
3. **build-cli** - builds and uploads the `dist/` CLI artifact
4. **build-popular-apps** - builds all apps in parallel across macOS/Windows/Linux
5. **publish-docker** - builds and pushes Docker image to GHCR

The workflow can also be triggered manually via `workflow_dispatch` with options to build popular apps or publish Docker independently.

Pushing the same `V*` tag also triggers `.github/workflows/npm-publish.yml`, which publishes `pake-cli` to npm through Trusted Publishing. Configure the npm package's Trusted Publisher as GitHub Actions, `tw93/Pake`, workflow file `npm-publish.yml`, with no environment. Local `npm publish` is only a fallback when CI or npm registry state blocks the trusted path.

Before treating an npm release as shipped, verify both `gh workflow list --all | grep "Publish npm Package"` and `npm view pake-cli@X.Y.Z version`. Prefer `npm view pake-cli@X.Y.Z version gitHead dist.tarball --json` so the published package can be tied back to the intended commit. Do not reply to or close GitHub issues as released until the public registry returns the expected version.

For release follow-through, keep these boundaries explicit:

- `workflow_dispatch` runs on a branch unless a tag ref or input is supplied. Do not infer a release tag from the branch name, run title, or compare UI.
- For CLI/npm issue closeout, the npm registry is the decisive public surface. GitHub app release assets and quality workflows should still be reported, but they are separate surfaces.
- For app-release claims, inspect the GitHub Release directly with `gh release view <tag> --json assets` and check asset count/state instead of trusting source state or workflow names alone.
- If CI pushes an automatic `chore: update contributors [skip ci]` commit after release, fast-forward local `main`; do not move an already pushed release tag to include it.

`.github/workflows/quality-and-test.yml` runs auto-format on push, Rust quality checks, and CLI/build validation across Linux, Windows, and macOS.

### Network Mirror Behavior

Pake uses official npm and Rust sources by default. CN mirrors are explicit opt-in only:

- Set `PAKE_USE_CN_MIRROR=1` only when the user or CI environment intentionally wants npmmirror/rsProxy.
- Do not reintroduce automatic China-domain mirror switching.
- If an install fails against a CN mirror, retry the same install command to separate network availability from a product regression.
- `bin/utils/mirror.ts` and `bin/builders/BaseBuilder.ts` own this behavior; keep docs and tests aligned when changing it.

## CLI Usage Example

```bash
# Install CLI
pnpm install -g pake-cli

# Basic usage
pake https://github.com --name GitHub

# Advanced usage
pake https://weekly.tw93.fun --name Weekly --width 1200 --height 800
```

## Troubleshooting

See `docs/faq.md` for common issues and solutions.

### macOS SDK / Compile Errors

If compilation errors occur (e.g. on macOS beta), create `src-tauri/.cargo/config.toml`:

```toml
[env]
MACOSX_DEPLOYMENT_TARGET = "15.0"
SDKROOT = "/Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs/MacOSX.sdk"
```

This file is already in `.gitignore`.

### `dist/cli.js` out of sync with `bin/`

Symptom: tests or release builds use stale CLI behavior after a `bin/` edit. Fix with `pnpm run cli:build` and commit the regenerated `dist/cli.js`.

### First Tauri build is slow

The first `cargo build` on a fresh clone takes 10+ minutes as Cargo compiles every Tauri dependency from source. Subsequent builds reuse the `src-tauri/target/` cache. This is expected, not a bug.

## Documentation Guidelines

- **Main README**: keep only common, frequently-used parameters to avoid clutter.
- **CLI Documentation** (`docs/cli-usage.md` and locale variants): include **all** CLI parameters with detailed usage examples.
- **Rare or advanced parameters**: should have full documentation in `docs/cli-usage*.md` but minimal or no mention in the main README. Examples: `--title`, `--incognito`, `--system-tray-icon`, `--multi-window`, `--min-width`, `--min-height`.
- **Key configuration files**:
  - `pake.json` - default app configuration.
  - `src-tauri/tauri.conf.json` - shared Tauri settings.
  - `src-tauri/tauri.{macos,windows,linux}.conf.json` - per-platform overrides.
