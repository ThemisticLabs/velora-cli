# velora architecture

This document describes the current implementation. Read [CODINGSTYLE.md](CODINGSTYLE.md) before changing code and [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

## Current scope

velora is a TypeScript CLI built with Bun. It supports help, version output, command suggestions, and an interactive setup. It checks license access with the Themistic server. It bootstraps a verified standalone engine and uses its local process to list and install models. The engine owns device identity and device-bound requests. It runs temporary engine operations for setup and diagnostics and manages local application keys. It provides an independent service process with local start, status and stop controls and a persistent engine session for the selected model. It exposes a loopback HTTP API through the headless service. It does not register an operating-system service.

Setup sends the entered key over HTTPS for a signed read-only access check and displays expiry, occupied device slots, and entitled model IDs. It persists verified keys in the system credential store. Selecting a public model opens an availability notice with a way back to the access selection.

## Source layout

```text
src/
  cli.ts       Command registration and startup
  api/         Loopback HTTP listener, response adaptation, keys and port
  commands/    Doctor, license and service commands
  service/     Independent worker and private local lifecycle control
  menu/        Main menu, settings and cancellable menu tasks
  models/      Installed package inventory, selection and deletion
  setup/       Guided installation and model selection
  license/     Access verification and secure license storage
  downloads/   Signed bootstrap transport and model installation orchestration
  engine/      Runtime detection, verified extraction and local engine sessions
  updates/     CLI release checks and engine update permissions
  terminal/    Shared header, colors, layout and resizing
  system/      Data paths and browser opening
  assets/      Original logo, terminal mark and provenance
```

Tests stay under `tests/` and exercise these modules or the compiled CLI. `src/cli.ts` remains the only application entry point.

| File | Responsibility |
| --- | --- |
| `src/cli.ts` | Configure Commander, register commands, and dispatch arguments. |
| `src/setup/setup.ts` | Own the setup flow, prompt theme, model access checks and update permission prompts. |
| `src/terminal/set-setup-layout.ts` | Store the screen title, detail, F1 target and shared default footer. |
| `src/terminal/setup-dimensions.ts` | Define terminal limits and derive available content space from the rendered header. |
| `src/terminal/use-setup-screen.ts` | Render the shared frame and footer and subscribe to terminal resizing without restarting prompts. |
| `src/setup/select-option.ts` | Connect menu choices and model tables to the shared list and responsive frame. |
| `src/terminal/render-list.ts` | Render list columns, grouped dividers, scroll indicators and separate actions for model lists, updates and permissions. |
| `src/terminal/use-list-navigation.ts` | Handle shared selection, arrow keys, activation and Escape navigation. |
| `src/license/license-access.ts` | Ask the local engine for licensed models and validate the display fields. |
| `src/setup/model-list.ts` | Show a scrollable model list with dividers and overflow indicators, plus paged model details. |
| `src/setup/license-input.ts` | Briefly reveal the last appended character, mask input, and reject an empty or whitespace-only key. |
| `src/terminal/header.ts` | Combine the product name, embedded version, and compact mark according to terminal size. |
| `src/terminal/style.ts` | Apply terminal styles and the Themistic accent, respecting color environment variables. |
| `src/assets/mark.json` | Store the static Unicode Braille mark derived from the Themistic TC logo. |
| `src/assets/logo.svg` | Keep an unchanged local copy of the original Themistic logo artwork. |
| `src/assets/SOURCES.md` | Record asset provenance. |
| `tests/cli.test.mjs` | Test the compiled CLI through child processes. |

Each implementation module has one callable public entry point. The command entry file runs directly, without a `main()` wrapper. The engine bridge lives in `src/engine/`; it uses bounded JSON-Lines sessions. Setup and diagnostics close their temporary sessions afterward. The independent service retains its session until Stop.

## Command flow

```text
arguments
  src/cli.ts (Commander)
    help or piped input  -> styled help and header
    no arguments (TTY)   -> first setup or main menu
    version              -> package version
    unknown command      -> error and spelling suggestion
    setup                -> setup, then main menu
```

Commander owns argument parsing and suggestions. `package.json` is the version source for both command output and the header. The source imports use `.js` extensions under the NodeNext TypeScript configuration; they resolve to the TypeScript modules during development and bundling. They do not require duplicate hand-maintained JavaScript files.

## Setup lifecycle

1. Reject execution unless both input and output are interactive terminals with at least 60 columns and 20 rows.
2. Enter the alternate screen, preserving the ordinary terminal view.
3. Draw the access selection and let Inquirer handle keyboard navigation.
4. For public access, show the availability notice and return on Esc.
5. For licensed access, read the key and run a cancellable access check. Failures offer retry or back; verified results show models and offer back or finish.
6. Return to the main menu after setup. The menu owns the alternate screen and restores it once on exit.

Ctrl+C is identified through Inquirer's `ExitPromptError` and ends interactive setup normally with status 0, so script runners do not report a failure for a deliberate cancellation. A terminal resize redraws the active prompt while preserving its state. The menu reports unexpected failures without exposing raw exception details. Download completion follows package and manifest verification, a final catalog check, and publication of the installation state. Cancelling waits for download cleanup before leaving the alternate screen.

`set-setup-layout.ts` stores the current step's labels. Every prompt calls `use-setup-screen.ts`, which subscribes to resize events and redraws the full frame through Inquirer's rendering cycle. The resize listener is removed when the prompt settles. Input, selected models and detail pages remain in prompt state. Below 60 columns or 20 rows, the prompt displays a size notice and suspends normal interaction; Ctrl+C still cancels. The header is compact below 28 rows, and the model table reserves space for at least three models and separate actions.

## Main menu and settings

`menu/main-menu.ts` owns the interactive session. It reads the system credential store once at startup and runs setup only when no key is saved or `velora setup` was requested. For a returning user, `startup-license.ts` verifies the saved key before opening the menu. Invalid keys offer replacement, retry or menu access for recovery. Offline or unverifiable responses never mean the license is expired. The key is replaced only after verification succeeds. Esc in replacement input returns to the existing recovery screen without another check. Continuing without verification skips the automatic engine update request for that launch. Existing startup update consent remains separate.

`settings-menu.ts` dispatches actions. `model-settings.ts` handles selection and confirmed deletion; `update-settings.ts` edits permissions. Shared prompts keep navigation and the footer stable and scroll when choices do not fit. Esc returns to the previous menu and cancels license input before any verification or storage write. Settings and model lists retain their selection when returning. Ctrl+C closes the entire session. Content and footer share the same left inset; empty subtitles do not reserve a blank row. `terminal/run-terminal-task.ts` keeps asynchronous work cancellable and waits for pending native writes before restoring the terminal.

`models/installed-models.ts` reads each model's `current.json` and checks its package directory. Engine installations retain their engine-owned `current.json`. velora writes a separate `velora.json` only after a verified completion receipt. It adds display name, model version and engine revision without changing the engine state format. Unconfirmed engine installations stay hidden and can be retried. Older CLI installations remain readable. `selected-model.json` records the choice atomically. A single existing model is selected when there is no selection file. This is package selection, not engine startup or inference readiness.

Selection and deletion acquire the same `.service.lock` as the independent worker for their entire operation. A running or starting service blocks both actions with a request to stop it first. The shared lease also prevents a worker from loading the model during deletion or selection. This is a temporary safety boundary until service-managed model switching is connected. Selection and deletion honor the model’s `.update.lock` and the shared `.velora.lock` used by velora installations. Deletion closes the model lock's file handle before moving the directory so Windows can rename it. The lock file remains in place during the move, and the shared lock stays open until cleanup completes. Deletion moves the model directory into a private `.delete-*` directory before removing it. Interrupted cleanup leaves that directory outside the model inventory and reports cleanup failure. License storage, device identity and other models are untouched. Linked storage and linked package directories are rejected.

CLI permission reads and writes are shared by startup and Settings through `cli-update-preferences.ts`. Settings show velora and engine permissions together as editable On/Off rows. Enter or Space toggles a row; Save changes persists the draft. Esc discards unsaved changes. Disabling checks also disables automatic installation. Unreadable preference files are marked unavailable and are not overwritten. Selecting Save retries their read; recovered preferences appear for review before the user confirms them, while edits to readable scopes are preserved. Each successful scope save updates the baseline so a later failure can be retried without rewriting completed changes. Manual update checks do not change automatic-check consent. CLI checks distinguish an unavailable check from a confirmed current version. `menu/update-menu.ts` keeps installed and available versions in one table, with separate velora and Engine rows. Checking does not replace the view. Esc cancels a pending check and returns after the request settles; unavailable results never claim the installed version is current.

## Terminal conventions

Terminal control sequences have descriptive names at their point of use. The style function accepts `accent`, `strong`, `muted`, and `divider`; numeric style codes stay inside that module:

| Sequence | Purpose |
| --- | --- |
| `ESC[?1049h` / `ESC[?1049l` | Enter / leave the alternate screen. |
| `ESC[H` and `ESC[2J` | Move home and clear the screen. |
| `ESC[?25l` / `ESC[?25h` | Hide the cursor in menus and restore it for input or exit. |
| `ESC[1m`, `ESC[2m`, `ESC[0m` | Bold, dim, and reset text styling. |

The `accent` style uses `#686BE7`, or `#2525CC` when `COLORFGBG` ends in background index 15. This is a limited theme hint. `NO_COLOR`, `TERM=dumb`, and `FORCE_COLOR=0` disable styling; otherwise a nonzero `FORCE_COLOR` can enable it without a TTY. These switches affect text styling, not the setup's cursor-control sequences.

## Build and dependencies

`bun run start` executes `src/cli.ts`. `bun run check` type-checks without emitting JavaScript. `bun run build` compiles the entry point and its imports into `dist/velora`, including the Bun runtime and imported JSON. Automatic loading of `.env` and Bun configuration is disabled for the compiled executable.

Commander handles commands. `@inquirer/core` provides the prompt state and keyboard primitives for selection, input, progress and model views. TypeScript and Node-compatible type definitions are development dependencies. Their presence does not require users to install Node.js.

`bun link` exposes the built executable as `velora` during local development. Rebuilding updates that executable. The release workflows build and test the targets listed in `scripts/release-targets.ts` on native runners. Release planning, binary smoke checks and checksum generation live in `scripts/`. Publishing package-manager entries is future work. See [RELEASE.md](RELEASE.md).

## Data boundaries

The license prompt holds input in process memory. The last appended printable ASCII character is shown for 600 ms, then masked. Further input masks the previous character immediately. Deletion and navigation hide the revealed character. The prompt effect clears its timer on changes and exit. Masking limits terminal visibility, not memory access. After successful verification, the key is persisted through the operating system credential store. It also remains in process memory during access checks and confirmed downloads. velora never writes it to a plaintext file. JavaScript strings cannot be reliably erased from memory by assigning another value.

Engines and model weights remain separate from this repository and executable. Downloads implement the signed package protocol. velora starts temporary engine processes for license checks and installation. The independent headless service keeps a verified engine session loaded for the local HTTP API and its optional anonymization mapping, as described below.

## Current limits and verification

- Setup requires at least 60 columns and 20 rows. Smaller terminals receive a plain instruction before the alternate screen opens, so navigation and cancel hints are not silently truncated.
- Resizing preserves prompt state. Detail text is rewrapped to the new width; on multi-page sections, the page index is retained and clamped to the available pages.
- Menu failures use public messages after terminal cleanup. Do not include license input in error messages or diagnostic context.
- Automated tests cover command behavior, color controls, version output, runtime independence, and non-interactive setup rejection.
- Terminal checks also exercised the 60-by-20 layout, public access and Esc navigation, empty license validation, long masked input, Ctrl+C, undersized terminals, and resize cleanup. Automated PTY tests also check model-detail navigation and permission rows, including one heading per group. These do not replace visual inspection or cross-platform verification.

## Adding the next feature

Keep command parsing in the entry point, setup decisions in the setup flow, and terminal rendering in the existing presentation modules. Reuse the existing license, download and model modules. Keep model execution separate from the existing engine bootstrap and installation bridge. Do not put network calls inside prompt rendering callbacks. Validate external replies at the integration boundary, and only advance to a success state after the requested operation has actually completed.

## Engine bootstrap and license access

The public contract is [docs.themistic.com/velora/license-api](https://docs.themistic.com/velora/license-api/). `bootstrap-engine.ts` detects the actual OS target, sends the license, fresh nonce and platform to `/license/engine`, and downloads the returned standalone package. No device identity or model ID is sent during this initial download. The Ed25519 key is pinned in `package-request.ts`. Raw response signatures and every sent binding are verified; files use bounded 1 MiB requests with exact size and range checks. Redirects are rejected and requests have a 60-second timeout.

`engine-runtime.ts` verifies the manifest, package hashes and signed inventory. ZIP entries must match that inventory exactly: no traversal, duplicate names, links, special files, unexpected members or oversized output. Extraction is streamed through yauzl, limited to 20,000 files and 4 GiB, and restores signed executable permissions. Cached runtimes are rechecked before execution. These checks do not isolate files from another process with the same user privileges.

Bootstrap publishes `<data>/engine/<revision>/{package,runtime}` and `engine/bootstrap.json` under an exclusive bootstrap lock. Manual updates resolve and verify a strictly newer version and sequence before publishing the pointer. The requested version must still match the signed plan. Failed downloads do not publish the pointer; previous revision directories remain intact. Existing cached engines are reused without an automatic replacement check. Source/build availability does not prove production publication.

`engine-session.ts` starts the verified executable with `--stdio`, checks version and protocol, and keeps one request in flight. Secrets travel through stdin, never command arguments or diagnostic output. JSON response lines are bounded to 2 MiB and matched to request IDs. stderr is discarded directly without a pipe, so private diagnostics cannot block protocol responses. The process closes after the operation; cancellation terminates it, escalating after one second if necessary. Ordinary requests time out after 30 seconds; installation has a 30-minute limit.

`license-access.ts` asks the engine for `models`, validates display fields and device counts, and returns the existing UI shape. `manage-license.ts` stores a new key only after that succeeds. The engine keeps its own stable device identity. No second CLI fingerprint implementation remains. Device slots are not activated by bootstrap or model listing. The local protocol currently returns only `license_denied`, without a reason. After that error, a signed `/license/engine` resolve identifies expired, revoked or unknown keys. Transport failures remain unverified, not invalid. Unsigned 429/503 responses are treated as service unavailability, never authorization. HTTP 429 honors bounded Retry-After delays with at most two cancellable retries.

## Contextual documentation

F1 opens documentation without changing the active input or selection. The footer displays the shortcut in every normal setup view. The shared screen hook handles the key; model selection overrides the destination with the highlighted model ID. No license key, device identity or input text is included in the URL.

The opener uses the published routes recorded in `src/system/documentation-path.ts`. Add a model route there once its page is published. Unknown model IDs open the model overview; unfinished setup, settings and update routes open the velora overview. No availability request is made when pressing F1.

| Context | URL |
| --- | --- |
| Setup and navigation actions | `https://docs.themistic.com/velora/` |
| License input, verification and errors | `https://docs.themistic.com/velora/license-api/` |
| Highlighted model or its detail pages | `https://docs.themistic.com/velora/models/<model-id>/` |

`src/system/open-documentation.ts` restricts destinations to the HTTPS documentation origin and invokes the browser without a shell. macOS uses Safari; Windows and Linux use their system URL handlers. The opening status clears when the opener completes; this does not confirm that the page loaded. Browser launch arguments were verified using a test opener on macOS; the Nivora, Skira 7 Alpha 4, Skira 6.1 and license routes were checked against the public documentation. Other platform handlers are not guaranteed by the opener.

## Installation checks

`menu/doctor-screen.ts` runs Doctor inside Settings using the shared progress bar and responsive frame. Doctor publishes check snapshots instead of printing its command report in this mode. The bar counts completed checks, including action items; it does not estimate remaining time or imply that every check passed. Esc cancels through the supplied signal and waits for work to settle. While checks run, the viewport follows the latest output. Completed results start at the top and support ↑/↓ scrolling and Home/End jumps, with indicators for hidden results. Resizing clamps the viewport to the available result lines. Results remain visible until Enter or Esc. The standalone command keeps its existing diagnostic report.

`menu/manage-models.ts` groups switching, installing and deleting. It reuses the existing model list, setup flow and deletion confirmation. Install is available in the management menu rather than duplicated inside the switch list.

`src/commands/doctor.ts` implements `velora doctor`. It reports OS and architecture without claiming model support, looks for an executable in absolute PATH directories without running it, and probes the default data location with a temporary directory and file. The probe is removed afterward. Missing data directories are not created; their nearest existing parent is checked instead.

Default data locations are `~/Library/Application Support/velora` on macOS, `%LOCALAPPDATA%/velora` on Windows (falling back to `~/AppData/Local/velora`), and `$XDG_DATA_HOME/velora` on Linux (falling back to `~/.local/share/velora`). Relative environment paths are ignored. These locations store model packages and preferences. Doctor probes storage access and the local API port; it does not install an engine.

Doctor reads the saved port through `api/api-settings.ts`, using `8001` when no setting exists. It attempts a temporary, exclusive TCP bind on `127.0.0.1` and closes the listener before proceeding. A free port reports **Available now**, an occupied port directs the user to Settings, and configuration or other bind errors report a separate failure. The check starts no HTTP API and reserves no port for later use. API startup must still handle its own bind result.

The server check makes a GET request to the public `/license/health` endpoint with an eight-second timeout and no redirects. It reports HTTPS reachability and HTTP status, not license validity. This reachability request sends no license or device identity. `commands/doctor-engine.ts` runs Engine, License, Selected model and Inference checks through one temporary engine session. It reads the credential store, verifies the installed runtime and protocol handshake, validates license access, loads the selected model and checks the reported model and engine versions against their installation records. A short synthetic prediction must return text and a mapping object. Dependent checks report warnings when prerequisites fail. The session closes in a finally block on completion, failure or cancellation; no model or engine is downloaded. The License result reports expiry and device usage. An absent license is a warning; denied or unverified access is an error. The check requires an existing engine record and uses installed-only bootstrap, so it cannot download an engine. The injected transport lets tests simulate network failures without contacting production. An optional internal data-directory argument isolates storage tests in temporary directories; it is not exposed as a CLI option. Storage failures report the failed operation and filesystem error. Cleanup failures name the remaining probe directory, and do not hide an earlier write failure.

Interactive output updates in the alternate screen, then restores the terminal and prints the final report once. Piped output receives only the final report. Ctrl+C cancels the request and restores the terminal. Completed checks exit normally even when they report warnings or errors, so script runners do not add an error to the diagnostic report. Exit code 0 does not imply that all checks passed. Runtime cancellation is caught by the Doctor command after its session cleanup and exits normally; unexpected unhandled errors still fail the command.

The report reuses `src/terminal/style.ts` and follows the Gallery's `STANDARD.md` and voice examples. Status colors distinguish OK (green), warnings (orange), and errors (red). Downloads, update checks and update permissions use the same shared styles. Download logs carry their severity separately from the message; colors are applied after sanitizing and wrapping the text. `downloads/download-failure.ts` maps storage errors and safe download errors to user-facing messages, hiding unexpected backend diagnostics. Screen layouts accept an optional status tone for outcome headings and details, reset it on every screen change, and wrap details to preserve the full correction hint. The shared style function honors disabled colors. No new icons or web components are introduced.

## Engine-managed model installation

`download-model.ts` opens the verified shared engine and sends `models` with the key. It then sends `install_model` with the model ID, `<data>/models` root, `engine_package`, `engine_runtime` and `progress: true`. `engine-session.ts` requires `version.capabilities` to include `install_model` before sending that request. There is no fallback to the combined `install` operation. Older engines can still check license access but cannot install models through this flow.

The engine verifies the supplied package and runtime, downloads only model files, obtains the server receipt and then activates the model. `engine_update_required` directs the user to update the engine separately. velora requires `engine_changed: false` and a returned engine version and receipt revision matching its running installation. The shared engine remains under `<data>/engine`; model packages live under `<data>/models/<id>/installed/<id>/<revision>`. Legacy `models/engine` directories are ignored and preserved, not migrated or deleted.

A successful `ok` reply alone is insufficient: velora checks the model identity, expected local path, `files_verified`, authorized receipt, matching revisions and the engine-owned current record. Only then does it atomically publish `velora.json`. Cleanup errors after publication do not turn a completed installation into an unsuccessful one. Failures before receipt publication leave a new model hidden and eligible for retry. An abruptly terminated engine can leave its own update locks or partial packages; velora does not remove engine-owned locks automatically.

The shared `render-progress.ts` renders measured bytes or an indeterminate animation. The screen retains bounded status messages below it and redraws on resize. Progress events are accepted only for the pending `install_model` request. Byte counts must be nonnegative, monotonic and bounded by a stable total. Verification and confirmation use indeterminate progress. Combined or fragmented JSON lines are supported. No simulated percentages or pause control are shown.

Engine checks use `/license/engine` without a model or device ID and verify the installed package and runtime before reporting its version. The update menu contains only velora and Engine. Startup check results are reused. Selecting an Engine row with an available update opens confirmation; otherwise it checks for updates. Model releases are separate catalog entries, selected through Switch model. Installed models have no update check or replacement action. Automatic installation remains unimplemented.

Tests use synthetic signed packages and fixture processes for installation receipts, progress and capability checks. A process integration test runs the complete CLI installation flow through engine-session, checks progress and inventory publication, rejects unconfirmed receipts and checks that no second engine directory is created. Its engine process is synthetic, so it does not prove native engine downloads. The TypeScript check includes tests and fixtures. An optional `VELORA_TEST_ENGINE_BINARY` points to a native engine 0.4.4 executable for a protocol smoke test. It checks the handshake and rejection of the retired combined installation operation without a license or network request. It does not verify native model installation, production downloads or inference. Those require a separate end-to-end test.

## License persistence and update permissions

`license-store.ts` wraps Bun 1.3.14's native secrets API, using service `com.themistic.velora` and account `license`. Access is not marked unrestricted. No keys are passed through process arguments or environment variables. Native errors are replaced with safe messages. `@types/bun` supplies the runtime types; the build still produces a standalone executable.

`manage-license.ts` owns the order: normalize input, bootstrap the engine if needed, list license access through the engine, then replace the stored key. Status reads never replace the saved key; the first check can bootstrap the engine. The old key is not deleted before replacement, and rejected checks never reach the credential write. Native credential operations are not cancellable once started, so the terminal waits for completion and reports a successful write accurately even if Ctrl+C arrived during it. No command releases a server-side device slot. Setup and `license-command.ts` share this flow.

`engine-update-preferences.ts` uses the shared atomic preference reader/writer to persist `checkAutomatically` and `installAutomatically` to `<data>/engine-updates.json`. These are shared engine preferences, independent of model selection and deletion. Legacy per-model files remain untouched and do not grant broader permission. Missing shared preferences mean no automatic check. Introductory setup and Settings expose the shared engine scope and preserve existing choices. Automatic installation still has no consumer.

`cli-update.ts` independently queries the public GitHub latest-release endpoint without credentials. Stable version tags are validated and compared using Bun semver; draft, prerelease, old, malformed or oversized results are ignored. `startup-update.ts` consumes saved permissions from `<data directory>/cli-updates.json` without prompting or writing pending choices. Introductory setup and Settings collect check and installation consent through the shared permissions table. Both choices start Off. Missing, invalid or unreadable preferences grant no permission. The bounded request runs before interactive launches only when `checkAutomatically` is explicitly true. Piped commands neither prompt nor check. `header.ts` displays the available version in its existing fourth logo row or in the compact header, preserving layout height. The interactive Doctor screen keeps the same header notice. Automatic installation calls the same signed installer as the Updates menu and runs only when opening the interactive menu. Explicit commands such as doctor, help and version continue normally. Existing boolean check permissions remain valid. Setup and Settings collect installation consent; startup consumes saved permissions without prompting. Development source is never replaced. The standalone executable must be installed in a writable directory. Package-manager integration remains separate.

Verification includes synthetic license rejection and cancellation tests, an isolated native macOS Keychain round trip through a compiled binary, bounded release-response tests, atomic preference-file tests, and PTY checks of the complete setup and license commands. Native Windows/Linux credential stores remain unverified. References: [Bun secrets](https://bun.sh/docs/runtime/secrets), [Bun semver](https://bun.sh/docs/runtime/semver), [GitHub releases API](https://docs.github.com/en/rest/releases/releases).

## Download hardening

Only explicit `DownloadError` messages are displayed verbatim. Transport, parser and filesystem diagnostics cannot leak arbitrary text through the download UI. Known disk-space and permission failures have fixed actionable messages. Storage paths are checked at each managed model-directory level before writing; symbolic links there are rejected. This is not a sandbox against another process running with the same account and filesystem privileges.

Cancellation waits for the in-flight operation. If publication already completed, setup reports that the model is installed instead of implying that cancellation undid it. Update permissions are collected before license setup and installation. Cancelling a later step leaves completed installations and saved preferences intact. The current local engine protocol has no pause/resume commands. Cancellation stops its process and does not release an activated server-side device slot.

PTY regression tests run actual prompts with isolated fixture modules and temporary storage through Bun's terminal API. They cover unexpected error redaction, disk-full messages, cancellation before installation, cancellation during publication and cancellation after completion. These PTY tests are skipped on Windows. Sudden power loss, native Windows/Linux credential stores, production model inference and automatic engine updates remain outside the verified scope.

## Shared menu navigation

`setSetupLayout(title, detail, documentationPath, footer)` uses the shared menu footer when the fourth argument is omitted. The third argument sets the documentation path for that screen; the fourth overrides navigation hints for input, loading or confirmation. Each call resets both fields, so an override does not leak into the next screen.

```ts
setSetupLayout('Settings / Manage models', '', '/velora/models');
setSetupLayout('License', '', '/velora/license-api/', 'Enter Continue · Esc Back · Ctrl+C Quit');
```

Selection prompts explicitly enable Escape with `back: true`; back navigation is shown in the footer and is not a selectable row. Enter activates the selected action. The shared list navigation wraps from the first item to the last with Up, and from the last to the first with Down, including separate actions. Model details retain left/right paging and use the shared list renderer and navigation hook for the installation action. Escape also returns from details when the terminal is below the minimum size.

## Local API port

`api/api-settings.ts` reads and atomically replaces `<data>/api.json`. A missing file returns the provisional default port `8001` without creating storage. Invalid or unreadable settings fail rather than silently selecting another port. Writes use the existing temporary-file and rename pattern and reject a linked storage directory.

`menu/api-settings.ts` edits the port through the shared terminal frame. The port menu offers editing and Reset to default. Enter saves an edited port; Esc discards the edit and returns to the menu. Reset immediately saves the default. Saved feedback stays in the existing hint row, keeping the menu and footer stable. Invalid input stays in the editor for correction; failed saves show an error in the menu. Settings displays the configured loopback address. The independent service binds the saved port on startup and reports conflicts without choosing another port. Saving the setting does not restart a running service. See `docs/local-api-draft.md` for the local API contract.

## Application keys and popups

`api/api-keys.ts` owns local application-key metadata, generation, verification and revocation. Each key contains 32 random bytes encoded as base64url with a `velora_` prefix. Only SHA-256 digests, UUIDs, names, notes and creation times are persisted. Reads validate the stored schema and reject linked or oversized files. Mutations hold an exclusive `.api-keys.lock`. Schema version 1 stores a monotonic revision and SHA-256 checksum over the revision and records. Legacy arrays remain readable and migrate on the next write. Both staged copies are synced before publication. Publishing and syncing `api-keys.json.backup` commits the revision; refreshing `api-keys.json` follows. Reads select the newest valid copy, so an interrupted primary refresh preserves creates and revocations. Two corrupt copies fail closed. Each copy contains hashes and metadata, never plaintext keys. The shared directory lock publishes complete owner records atomically. Writers reclaim records only when their owner process has exited. Old or invalid lock files require inspection; reads still work. Verification uses constant-time digest comparisons. The local HTTP listener uses this verifier for each request.

`menu/api-keys.ts` uses the existing shared list renderer for Name, Note and Created columns. Add and revoke use `terminal/popup.ts`, a reusable form prompt rendered over a dimmed table. Popup fields, submit action, busy state, result and errors share one implementation. Tab and arrow keys move between fields and the action, Enter advances or submits, and Esc cancels before submission or closes a result. Resizing recalculates the panel. Repeated submissions are blocked while saving.

`system/copy-clipboard.ts` sends values through stdin to pbcopy on macOS, Set-Clipboard on Windows, or wl-copy/xclip on Linux. No key appears in process arguments. The popup displays the new key immediately, before the clipboard operation completes, and keeps it visible until closed. Subsequent listing never returns plaintext. A native macOS copy/paste round trip was checked; native Windows/Linux helpers remain unverified. API keys separate application access and do not encrypt processing.

## macOS menu bar

`system/menu-bar.ts` launches one detached `--menubar-worker` per storage directory. The existing directory lease prevents duplicate helpers. The worker uses the same `service-control.ts` as the CLI and keeps status polling separate from serialized button actions. Closing the CLI or stopping the service does not close the menubar.

`assets/menu-bar.jxa` uses bundled AppKit and WebKit to display an NSPopover. `menu-bar.markup` contains the approved compact controls, the existing TC logo and Gallery icons. Web content cannot make network requests, load remote resources or navigate to arbitrary pages. Only the four fixed actions reach the worker. Native assets are embedded in compiled releases and materialized in a private temporary directory; no compiler or downloaded UI runtime is needed.

`interactive-session.ts` registers the exact Ghostty surface ID or Apple Terminal tty through a private Unix socket. A random bearer token and mode 0600 protect the endpoint; a directory lease coordinates session ownership and stale socket recovery. `open-interactive.ts` resolves the configured shell-script handler. It focuses an authenticated existing session or starts the CLI in a normal terminal window. The helper's noninteractive `NO_COLOR` and `TERM` values are not inherited by the new terminal. Session startup remains serialized while registration is pending.

Settings requests interrupt idle selection prompts through `interactive-navigation.ts`. The main menu consumes the request and opens Settings. Active downloads, credential operations and popups complete before navigation, so a menubar click does not cancel writes. The public CLI entry point starts the helper before command routing, including help, version, Doctor and headless starts. Internal worker and updater entry points do not recursively launch another helper.


## Signed CLI installation and recovery

`release-public-key.ts` pins the Ed25519 trust key. The release workflow signs the exact `release.json` bytes with its protected signing secret. `release-metadata.ts` verifies the signature before using asset sizes and hashes, requires the requested version and selects one matching platform asset. Downloads are bounded and use HTTPS. The installer accepts only a newer stable release; a recorded installed or rejected version cannot be replayed. An invalid signature never reaches execution.

`install-cli-update.ts` resolves the compiled executable, acquires an exclusive update lock and stages the verified binary beside it, on the same filesystem. Files are synced before use. The staged version performs a bounded, read-only self-test of API keys, API settings, update permissions and model selection. This does not test credentials, the engine or inference. Source runs refuse installation. Both build commands set `VELORA_COMPILED=true`; runtime detection does not depend on the logo or embedded assets.

`launch-update-worker.ts` starts the verified staged executable as a detached helper. It saves its PID and acknowledges readiness before the CLI closes. `apply-cli-update.ts` waits for that process to exit, checks the original and candidate hashes again, copies and verifies the original backup, records the installing phase, then atomically replaces the executable while preserving its POSIX permissions. It tests the installed executable before recording success. A failed test restores the verified original. An unrelated executable replacement is preserved rather than overwritten.

A durable journal beside the executable records prepared, installing, installed, restored or failed state. On the next interactive launch, `recover-cli-update.ts` detects an interrupted transaction, verifies the recovery executable and starts a restoration helper. Backups and transaction files remain beside the executable for inspection. The updater does not remove or migrate user data, model packages, credentials or device identity. It does not install a background service.

`system/sync-directory.ts` syncs directory entries on macOS/Linux. Windows file contents are synced, but this runtime does not provide the same directory-sync guarantee. Atomic rename and recovery tests do not prove survival of every disk fault or power loss. Dead process owners are reclaimed even if no journal was written. Invalid legacy lock files require manual inspection. A failed restoration is reported; there is no claim that recovery always succeeds. Backups are retained and are not an independent backup of user data.

Native compiled helper tests cover installation, failed installed-binary tests, interrupted installation, changed targets, signed metadata rejection and preservation of data. The current local run verifies the development host only; the native CI matrix must verify Windows and Linux before release.


## Independent service and engine lifetime

`service/service-control.ts` owns start, status and stop. The compiled CLI starts itself with an internal worker argument; development runs start the source with Bun. The child is detached with no inherited terminal streams. Start waits for an authenticated ready response after the selected model loads before reporting success. Concurrent starters may launch workers, but only one worker acquires `.service.lock`; all starters discover the same surviving instance. A failed or timed-out launch terminates only the child it created. If an observed starting service stops, Start aborts immediately instead of waiting for the loading deadline.

`service/service-worker.ts` owns the lifetime and uses the existing directory lock. It publishes `service.json` atomically with a PID and a fresh 32-byte control token. That token is separate from application API keys and is never sent through command arguments or displayed. POSIX record files use `0600`. Process death permits a later worker to reclaim the stale lease. User data is not deleted to recover a service.

`service/service-paths.ts` names the record, lease and control endpoint. macOS/Linux use a Unix socket inside an owner-checked `0700` temporary directory; the socket uses `0600`. Its name is derived from the resolved data directory to avoid long home-directory socket paths. Windows uses a named pipe. The persisted token authenticates status and stop commands on both transports. Control does not open a TCP port. This is a same-user control channel, not a boundary against malicious code already running as that user.

`service/service-request.ts` bounds control records and messages and applies a response timeout. It validates the returned instance PID. Missing records or records whose process has exited mean stopped; invalid records or an unreachable live process fail closed. Status distinguishes starting, running, stopping and failed and validates the model ID and engine version in a running response. Stop acknowledges completion after shutting down the engine, closing the listener and releasing service ownership. Credential-store failures retain their safe recovery message, without exposing native error details. A Stop during startup aborts model loading and waits for process cleanup; a pending credential read does not prevent cancellation.

`commands/service-command.ts` provides `velora serve start --headless`, `velora serve status` and `velora serve stop`. Output reports the loaded model, engine version and actual loopback HTTP port. Tests use isolated storage and include concurrent starts, a launcher exiting before later control, SIGKILL recovery, rejected unauthenticated control and a compiled worker without Bun on PATH. Native Windows/Linux behavior still requires their CI jobs.

`service/service-engine.ts` reads the selected installed model and the saved license, then opens the verified cached engine with `installedOnly`. It does not bootstrap downloads. It sends one `load` request and checks the returned model ID and engine version before publishing readiness. The session stays open for subsequent operations; Stop sends `shutdown` and closes the child even if shutdown fails. Unexpected engine exit changes service status to failed and requires manual Stop and restart. Startup has a two-minute limit, which is cleared after loading so it cannot terminate an otherwise healthy persistent session.

Protocol tests use a compiled synthetic engine child and isolated storage. They cover a retained session, repeated starts without reloading, shutdown, engine exit, cancellation during a credential prompt, missing prerequisites and mismatched load responses. They do not evaluate real model weights or inference quality.

The main menu uses service-control for Start/Stop and refreshes status through the shared selection prompt. Menu navigation remains usable while status refreshes; polls run sequentially and stop when leaving the prompt. Abort signals cancel control waits without stopping the independent worker or interrupting its active inference. `velora settings` opens Settings after the normal startup checks. The independent menubar helper has its own ownership lock. macOS start at login uses a user LaunchAgent running the same public headless command; it activates at the next login. Existing registration is parsed with macOS plutil and checked for the expected label, headless command and RunAtLoad flag. Windows/Linux autostart remain unimplemented. Ready confirms model loading and a bound HTTP listener.


## Local HTTP API

`api/api-server.ts` binds Bun's native HTTP listener only to 127.0.0.1 using the saved port. Binding happens before engine loading. Failed model startup closes the listener; private service control remains available for recovery. The listener reads bodies through a bounded streaming reader instead of loading an arbitrary full body. The stream enforces 1,677,721 bytes and an absolute 15-second upload deadline. The transport limit is bypassed so oversize errors use the same JSON contract; streamed bytes remain bounded by the API reader. See [Bun streams](https://bun.sh/docs/runtime/streams) for the runtime's reader and backpressure behavior.

The only route is POST /anonymize. Exact Host, browser headers, Bearer authorization, UTF-8 JSON, allowed fields and body size are validated. API-key verification uses the existing store on each request and fails closed if both saved copies are unreadable. No request text, mapping, key or raw engine exception is logged or persisted by the HTTP layer.

One processing slot covers body reading and prediction. A second request gets 429 and Retry-After: 1, without a queue. Client disconnection does not release that slot until engine processing settles. Stop closes the HTTP listener to new connections and waits for active processing and responses before engine shutdown. Private control remains reachable during draining and reports stopping. The existing engine request deadline is 30 seconds; a timeout kills the engine, returns 504 when possible and requires manual restart. Control waits up to 60 seconds without forcing cancellation.

`api/anonymize-response.ts` validates engine output against Unicode code-point offsets and the original input. It checks occurrence values, non-overlap and the complete placeholder reconstruction. Different spellings grouped by the engine are split into separate placeholders without colliding with input placeholders or existing IDs. The HTTP result contains only text and optional mapping, with full placeholder keys and original, type and occurrences fields. These checks validate consistency, not the model's recognition quality.

HTTP tests use real loopback listeners and isolated key stores, including exact-size and chunked bodies, Unicode, revocation, engine failures, client disconnect and draining. A service test runs HTTP prediction through a compiled synthetic engine child. Real model weights and native Windows/Linux HTTP behavior still need separate acceptance checks. Native Windows/Linux lifecycle acceptance remains separate from the local macOS checks.


## Introductory setup

`setup/onboarding.ts` keeps the sequence explicit: application key, update permissions, macOS start at login, then a five-page usage guide including macOS menu bar controls. It runs inside the shared alternate screen before `main-menu.ts` reads the credential store. The interactive terminal is registered before the introduction, so menubar Open and Quit work throughout setup. Settings requests wait until startup completes. The existing `setup/setup.ts` handles license verification and model installation afterward; adding another model does not repeat introductory questions.

`setup/setup-progress.ts` stores only the completed introductory step in `setup.json`, using the existing restricted temporary-file, fsync and atomic-rename pattern. Corrupt progress is reported without resetting it. API keys and update permissions remain in their existing stores. Skipping key creation is explicit. Closing a cancelled key popup stays on that step, and existing keys can be reused. `velora setup` reviews the introduction; normal launches resume or skip it when complete.

`menu/api-keys.ts` supports creating one key with its existing popup. `menu/update-settings.ts` uses the same grouped permission table in setup and Settings. The shared switch-list prompt renders update permissions and start at login through the existing list renderer and keyboard navigation. Setup initially selects Save and continue; no separate button style is used. Save and continue closes the setup step and persists explicit On/Off decisions, including untouched defaults. Startup update checking only consumes existing consent and never prompts before the introduction. Engine automatic-install permission remains a stored choice; installation is not implemented.

`system/autostart.ts` mirrors Backbone's LaunchAgent approach without adding a Tauri runtime. It writes `~/Library/LaunchAgents/com.themistic.velora.plist` with absolute command arguments and RunAtLoad, without KeepAlive or immediate launchctl registration. Source runs include Bun and the source entry point; compiled builds invoke their executable. Settings can remove the registration for future logins. No service is started or stopped by changing this choice. Tests validate isolated registrations with plutil on macOS; a full logout/login cycle is not part of the automated checks.

`terminal/set-setup-layout.ts` owns optional footer actions. License documentation targets automatically receive F2 Get license key; the shared screen handles that key without modifying license input. `system/license-purchase.ts` reports purchases unavailable while its approved URL is unset. A future configured URL must be HTTPS on the approved Themistic host and is opened by the platform browser command. No purchase is simulated.
