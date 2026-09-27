# velora architecture

This document describes the current implementation. Read [CODINGSTYLE.md](CODINGSTYLE.md) before changing code and [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

## Current scope

velora is a TypeScript CLI built with Bun. It supports help, version output, command suggestions, and an interactive setup. It checks license access with the Themistic server. It bootstraps a verified standalone engine and uses its local process to list and install models. The engine owns device identity and device-bound requests. It does not run model inference, create API keys, or install a service.

Setup sends the entered key over HTTPS for a signed read-only access check and displays expiry, occupied device slots, and entitled model IDs. It persists verified keys in the system credential store. Selecting a public model opens an availability notice with a way back to the access selection.

## Source layout

```text
src/
  cli.ts       Command registration and startup
  commands/    Doctor and license commands
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
| `src/terminal/set-setup-layout.ts` | Store the title, detail and footer for the current setup step. |
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

Each implementation module has one callable public entry point. The command entry file runs directly, without a `main()` wrapper. The engine bridge lives in `src/engine/`; it opens a bounded JSON-Lines session for each operation and closes the child afterward.

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

Selection and deletion honor the model’s `.update.lock` and the shared `.velora.lock` used by velora installations. Deletion moves the model directory into a private `.delete-*` directory before removing it. Interrupted cleanup leaves that directory outside the model inventory and reports cleanup failure. License storage, device identity and other models are untouched. Linked storage and linked package directories are rejected.

CLI permission reads and writes are shared by startup and Settings through `cli-update-preferences.ts`. Settings show velora and engine permissions together as editable On/Off rows. Enter or Space toggles a row; Save changes persists the draft. Esc discards unsaved changes. Disabling checks also disables automatic installation. Unreadable preference files are marked unavailable and are not overwritten. Each successful scope save updates the baseline so a later failure can be retried without rewriting completed changes. Manual update checks do not change automatic-check consent. CLI checks distinguish an unavailable check from a confirmed current version. `menu/update-menu.ts` keeps installed and available versions in one table, with separate velora and Engine rows. Checking does not replace the view. Esc cancels a pending check and returns after the request settles; unavailable results never claim the installed version is current.

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

Engines and model weights remain separate from this repository and executable. Downloads implement the signed package protocol. velora starts temporary engine processes for license checks and installation; persistent inference and service startup are not implemented yet. The local API and optional anonymization mapping are planned behavior, not implemented contracts.

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

`engine-session.ts` starts the verified executable with `--stdio`, checks version and protocol, and keeps one request in flight. Secrets travel through stdin, never command arguments or diagnostic output. JSON response lines are bounded to 2 MiB and matched to request IDs. stderr is drained without displaying private diagnostics. The process closes after the operation; cancellation terminates it, escalating after one second if necessary. Ordinary requests time out after 30 seconds; installation has a 30-minute limit.

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

`src/commands/doctor.ts` implements `velora doctor`. It reports OS and architecture without claiming model support, looks for an executable in absolute PATH directories without running it, and probes the default data location with a temporary directory and file. The probe is removed afterward. Missing data directories are not created; their nearest existing parent is checked instead.

Default data locations are `~/Library/Application Support/velora` on macOS, `%LOCALAPPDATA%/velora` on Windows (falling back to `~/AppData/Local/velora`), and `$XDG_DATA_HOME/velora` on Linux (falling back to `~/.local/share/velora`). Relative environment paths are ignored. These locations store model packages and preferences. Doctor only probes storage access; it does not install an engine.

The server check makes a GET request to the public `/license/health` endpoint with an eight-second timeout and no redirects. It reports HTTPS reachability and HTTP status, not license validity. No license or device identity is sent. The injected transport lets tests simulate network failures without contacting production. An optional internal data-directory argument isolates storage tests in temporary directories; it is not exposed as a CLI option. Storage failures report the failed operation and filesystem error. Cleanup failures name the remaining probe directory, and do not hide an earlier write failure.

Interactive output updates in the alternate screen, then restores the terminal and prints the final report once. Piped output receives only the final report. Ctrl+C cancels the request and restores the terminal. Completed checks exit normally even when they report action items, so script runners do not add an error to the diagnostic report. Exit code 0 does not imply that all checks passed. Cancellation also exits normally; unexpected unhandled errors still fail the command.

The report reuses `src/terminal/style.ts` and follows the Gallery's `STANDARD.md` and voice examples. No new icons, colours or web components are introduced.

## Engine-managed model installation

`download-model.ts` opens the engine, sends `models` with the key, then `install` with the chosen ID, `<data>/models` root, verified bootstrap package and `progress: true`. The engine performs resolve, package verification, extraction and completion acknowledgement. Its shared runtime lives under `models/engine`; individual packages remain under `models/<id>/installed/<id>/<revision>`. The shared engine is excluded from model lists and retained when a model is deleted.

A successful `ok` reply alone is insufficient: velora checks the model identity, expected local path, `files_verified`, authorized receipt, matching revisions and the engine-owned current record. Only then does it atomically publish `velora.json`. Cleanup errors after publication do not turn a completed installation into an unsuccessful one. Failures before receipt publication leave a new model hidden and eligible for retry. An abruptly terminated engine can leave its own update locks or partial packages; velora does not remove engine-owned locks automatically.

The shared `render-progress.ts` renders measured bytes or an indeterminate animation. The download screen retains bounded status messages below it and redraws on resize. Engine 0.4.2 progress events are opt-in and matched to the install request. Byte counts must be nonnegative, monotonic and bounded by a stable total. `verify`, `extract` and `confirm` are indeterminate phases. The terminal accepts combined or fragmented JSON lines. Engine 0.4.1 finishes through the same protocol but provides no byte events. No simulated percentages or unsupported pause control is shown.

Engine checks use `/license/engine` without a model or device ID and verify the installed package and runtime before reporting its version. The update menu contains only velora and Engine. Startup check results are reused. Selecting an Engine row with an available update opens confirmation; otherwise it checks for updates. Model releases are separate catalog entries, selected through Switch model. Installed models have no update check or replacement action. Automatic installation remains unimplemented.

Tests use synthetic signed packages and local fixture processes. An optional `VELORA_TEST_ENGINE_BINARY` points to a native macOS Engine 0.4.2 for an end-to-end test against a signed loopback server. This exercises velora’s real session, progress, model receipt, inventory and deletion without production credentials. It does not test production downloads or inference.

## License persistence and update permissions

`license-store.ts` wraps Bun 1.3.14's native secrets API, using service `com.themistic.velora` and account `license`. Access is not marked unrestricted. No keys are passed through process arguments or environment variables. Native errors are replaced with safe messages. `@types/bun` supplies the runtime types; the build still produces a standalone executable.

`manage-license.ts` owns the order: normalize input, bootstrap the engine if needed, list license access through the engine, then replace the stored key. Status reads never replace the saved key; the first check can bootstrap the engine. The old key is not deleted before replacement, and rejected checks never reach the credential write. Native credential operations are not cancellable once started, so the terminal waits for completion and reports a successful write accurately even if Ctrl+C arrived during it. No command releases a server-side device slot. Setup and `license-command.ts` share this flow.

`engine-update-preferences.ts` uses the shared atomic preference reader/writer to persist `checkAutomatically` and `installAutomatically` to `<data>/engine-updates.json`. These are shared engine preferences, independent of model selection and deletion. Legacy per-model files remain untouched and do not grant broader permission. Missing shared preferences mean no automatic check. Setup asks only when the shared file is absent; Settings always exposes the engine scope. Automatic installation still has no consumer.

`cli-update.ts` independently queries the public GitHub latest-release endpoint without credentials. Stable version tags are validated and compared using Bun semver; draft, prerelease, old, malformed or oversized results are ignored. `startup-update.ts` records null permissions on the first interactive launch without prompting or requesting releases. On the second interactive launch it asks for check permission and, when enabled, future automatic installation permission. It atomically saves both choices in `<data directory>/cli-updates.json`. No is selected by default. Missing preferences restart the two-launch flow; invalid, unreadable or unwritable preferences grant no permission. Cancellation restores the terminal without checking. The bounded request runs before interactive launches only when `checkAutomatically` is explicitly true. Piped commands neither prompt nor check. `header.ts` displays the available version in its existing fourth logo row or in the compact header, preserving layout height. Doctor displays the same notice. Automatic installation permission is stored but has no consumer yet. Existing boolean check permissions remain valid; enabled checks with no installation choice prompt for that missing choice. No updater runs and no package manager is bypassed.

Verification includes synthetic license rejection and cancellation tests, an isolated native macOS Keychain round trip through a compiled binary, bounded release-response tests, atomic preference-file tests, and PTY checks of the complete setup and license commands. Native Windows/Linux credential stores remain unverified. References: [Bun secrets](https://bun.sh/docs/runtime/secrets), [Bun semver](https://bun.sh/docs/runtime/semver), [GitHub releases API](https://docs.github.com/en/rest/releases/releases).

## Download hardening

Only explicit `DownloadError` messages are displayed verbatim. Transport, parser and filesystem diagnostics cannot leak arbitrary text through the download UI. Known disk-space and permission failures have fixed actionable messages. Storage paths are checked at each managed model-directory level before writing; symbolic links there are rejected. This is not a sandbox against another process running with the same account and filesystem privileges.

Cancellation waits for the in-flight operation. If publication already completed, setup reports that the model is installed instead of implying that cancellation undid it. Cancelling the subsequent preferences questions leaves the installation intact. A failed preferences read or write preserves existing settings and the completed installation, and reports the settings problem. The current local engine protocol has no pause/resume commands. Cancellation stops its process and does not release an activated server-side device slot.

PTY regression tests run actual prompts with isolated fixture modules and temporary storage through Bun's terminal API. They cover unexpected error redaction, disk-full messages, cancellation before installation, cancellation during publication and cancellation after completion. These PTY tests are skipped on Windows. Sudden power loss, native Windows/Linux credential stores, production model inference and automatic engine updates remain outside the verified scope.

## Shared menu navigation

Selection prompts explicitly enable Escape with `back: true`; back navigation is shown in the footer and is not a selectable row. Enter activates the selected action. Model details retain left/right paging and use the shared list renderer and navigation hook for the installation action. Escape also returns from details when the terminal is below the minimum size.
