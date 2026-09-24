# velora architecture

This document describes the current implementation. Read [CODINGSTYLE.md](CODINGSTYLE.md) before changing code and [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

## Current scope

velora is a TypeScript CLI built with Bun. It supports help, version output, command suggestions, and an interactive setup. It checks license access with the Themistic server. After explicit confirmation it registers the engine-compatible device identity and downloads a verified model package. It does not run models, create API keys, or install a service.

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
  downloads/   Signed package transfer and verification
  updates/     CLI release checks and engine update permissions
  terminal/    Shared header, colors, layout and resizing
  system/      Data paths, device identity and browser opening
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
| `src/license/license-access.ts` | Perform the bounded HTTPS access request, verify Ed25519 signatures and request binding, and validate the returned fields. |
| `src/setup/model-list.ts` | Show a scrollable model list with dividers and overflow indicators, plus paged model details. |
| `src/setup/license-input.ts` | Briefly reveal the last appended character, mask input, and reject an empty or whitespace-only key. |
| `src/terminal/header.ts` | Combine the product name, embedded version, and compact mark according to terminal size. |
| `src/terminal/style.ts` | Apply terminal styles and the Themistic accent, respecting color environment variables. |
| `src/assets/mark.json` | Store the static Unicode Braille mark derived from the Themistic TC logo. |
| `src/assets/logo.svg` | Keep an unchanged local copy of the original Themistic logo artwork. |
| `src/assets/SOURCES.md` | Record asset provenance. |
| `tests/cli.test.mjs` | Test the compiled CLI through child processes. |

Each implementation module has one callable public entry point. The command entry file runs directly, without a `main()` wrapper. There is no separate service layer or engine adapter yet.

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

`menu/main-menu.ts` owns the interactive session. It reads the system credential store once at startup and runs setup only when no key is saved or `velora setup` was requested. It does not perform a network license check just to open the menu. Existing startup update consent remains separate.

`settings-menu.ts` dispatches actions. `model-settings.ts` handles selection and confirmed deletion; `update-settings.ts` edits permissions. Shared prompts keep navigation and the footer stable and scroll when choices do not fit. Esc returns to the previous menu and cancels license input before any verification or storage write. Settings and model lists retain their selection when returning. Ctrl+C closes the entire session. Content and footer share the same left inset; empty subtitles do not reserve a blank row. `terminal/run-terminal-task.ts` keeps asynchronous work cancellable and waits for pending native writes before restoring the terminal.

`models/installed-models.ts` reads each model's `current.json` and checks its package directory. New downloads persist the verified model display name; older installations use their model ID. `selected-model.json` records the choice atomically. A single existing model is selected when there is no selection file. This is package selection, not engine startup or inference readiness.

Selection and deletion honor the model's `.update.lock`. Deletion moves the model directory into a private `.delete-*` directory before removing it. Interrupted cleanup leaves that directory outside the model inventory and reports cleanup failure. License storage, device identity and other models are untouched. Linked storage and linked package directories are rejected.

CLI permission reads and writes are shared by startup and Settings through `cli-update-preferences.ts`. Settings show velora and engine permissions together as editable On/Off rows. Enter or Space toggles a row; Save changes persists the draft. Esc discards unsaved changes. Disabling checks also disables automatic installation. Unreadable preference files are marked unavailable and are not overwritten. Each successful scope save updates the baseline so a later failure can be retried without rewriting completed changes. Manual update checks do not change automatic-check consent. Model checks use the existing signed catalog protocol and compare release sequences. They do not download or install a package. CLI checks distinguish an unavailable check from a confirmed current version. `menu/update-menu.ts` keeps installed and available versions in one table, with velora separated from the model and engine package. Checking does not replace the view. Esc cancels a pending check and returns after the request settles; unavailable results never claim the installed version is current.

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

Engines and model weights remain separate from this repository and executable. Downloads implement the existing signed package protocol; engine startup remains unimplemented. The local API and optional anonymization mapping are planned behavior, not implemented contracts.

## Current limits and verification

- Setup requires at least 60 columns and 20 rows. Smaller terminals receive a plain instruction before the alternate screen opens, so navigation and cancel hints are not silently truncated.
- Resizing preserves prompt state. Detail text is rewrapped to the new width; on multi-page sections, the page index is retained and clamped to the available pages.
- Menu failures use public messages after terminal cleanup. Do not include license input in error messages or diagnostic context.
- Automated tests cover command behavior, color controls, version output, runtime independence, and non-interactive setup rejection.
- Terminal checks also exercised the 60-by-20 layout, public access and Esc navigation, empty license validation, long masked input, Ctrl+C, undersized terminals, and resize cleanup. Automated PTY tests also check model-detail navigation and permission rows, including one heading per group. These do not replace visual inspection or cross-platform verification.

## Adding the next feature

Keep command parsing in the entry point, setup decisions in the setup flow, and terminal rendering in the existing presentation modules. Reuse the existing license, download and model modules. Add engine runtime integration when implementing model execution. Do not put network calls inside prompt rendering callbacks. Validate external replies at the integration boundary, and only advance to a success state after the requested operation has actually completed.

## License access protocol

The fixed endpoint is `https://api.themistic.com/v1/license/check`, with `operation=access` and `model_id=null`. The CLI passes the engine-compatible device fingerprint. The response shows total device usage; this access check does not register a device. The public Ed25519 key comes from the existing Themistic engine SDK. Redirects are rejected, requests time out after 15 seconds, and response bodies are limited to 256 KiB. Signatures cover the raw response bytes. Nonce, operation, license key, model ID, and device identity must match before access is accepted. Signed 429/503 responses bind only the nonce under the server contract. No offline cache is used.

Tests use an injected transport and test signing key; production exposes no endpoint or trust-key command-line override.

Model descriptions are optional signed API fields. Older servers keep working with an explicit unavailable-description fallback. The CLI rejects control characters and oversized metadata before terminal rendering. License input normalizes letters to uppercase; the value submitted to the API uses the same normalized form.

## Contextual documentation

F1 opens documentation without changing the active input or selection. The footer displays the shortcut in every normal setup view. The shared screen hook handles the key; model selection overrides the destination with the highlighted model ID. No license key, device identity or input text is included in the URL.

These routes are agreed placeholders until the documentation site is published:

| Context | URL |
| --- | --- |
| Setup and navigation actions | `https://docs.themistic.com/velora/setup` |
| License input, verification and errors | `https://docs.themistic.com/licenses` |
| Highlighted model or its detail pages | `https://docs.themistic.com/models/<model-id>` |

`src/system/open-documentation.ts` restricts destinations to the HTTPS documentation origin and invokes the browser without a shell. macOS uses Safari; Windows and Linux use their system URL handlers. The opening status clears when the opener completes; this does not confirm that the page loaded. Browser launch arguments were verified using a test opener on macOS; the placeholder site and other platform handlers are not live-verified.

## Installation checks

`src/commands/doctor.ts` implements `velora doctor`. It reports OS and architecture without claiming model support, looks for an executable in absolute PATH directories without running it, and probes the default data location with a temporary directory and file. The probe is removed afterward. Missing data directories are not created; their nearest existing parent is checked instead.

Default data locations are `~/Library/Application Support/velora` on macOS, `%LOCALAPPDATA%/velora` on Windows (falling back to `~/AppData/Local/velora`), and `$XDG_DATA_HOME/velora` on Linux (falling back to `~/.local/share/velora`). Relative environment paths are ignored. These locations store model packages and preferences. Doctor only probes storage access; it does not install an engine.

The server check makes a GET request to the public license-check endpoint with an eight-second timeout and no redirects. It reports HTTPS reachability and HTTP status, not license validity. No license or device identity is sent. The injected transport lets tests simulate network failures without contacting production. An optional internal data-directory argument isolates storage tests in temporary directories; it is not exposed as a CLI option. Storage failures report the failed operation and filesystem error. Cleanup failures name the remaining probe directory, and do not hide an earlier write failure.

Interactive output updates in the alternate screen, then restores the terminal and prints the final report once. Piped output receives only the final report. Ctrl+C cancels the request and restores the terminal. Completed checks exit normally even when they report action items, so script runners do not add an error to the diagnostic report. Exit code 0 does not imply that all checks passed. Cancellation also exits normally; unexpected unhandled errors still fail the command.

The report reuses `src/terminal/style.ts` and follows the Gallery's `STANDARD.md` and voice examples. No new icons, colours or web components are introduced.

## Verified model downloads

`package-request.ts` sends bounded, signed catalog and file requests to the existing `/v1/license/check` endpoint. It checks the Ed25519 signature and every request binding, including the fresh nonce and file range. File chunks are limited to 1 MiB. `package-release.ts` validates catalog identities, file names, sizes, hashes and optional engine versions.

`device-fingerprint.ts` follows the engine client identity: SHA-256 of IOPlatformUUID on macOS, `/etc/machine-id` where available, otherwise the existing `~/.config/lizenz-client/geräte_id`. An existing fallback is read without creating temporary files or requiring write access. Only a missing file triggers creation; unreadable or empty identities are not replaced. A new fallback is published using an exclusive hard link, matching the engine's race-safe creation. License access remains read-only; catalog and file operations can register a device. Cancelling a transfer does not undo that server-side registration.

`download-model.ts` installs under `<data directory>/models/<model-id>`. It takes `.update.lock`, downloads into its own temporary directory, verifies every file hash, the manifest signature, exact file membership, model and engine identities, and license configuration. It rechecks the catalog before publishing the package under `installed/<model-id>/<revision>` and replacing `current.json` by rename. The state preserves `engine_version`, model version, revision, sequence and `highest_sequences`, compatible with the engine updater's installation layout. Older releases without an engine version remain supported. Existing installations and package targets are refused; package replacement and crash recovery are later work. Manual update checks are implemented separately in `updates/model-update.ts`. A crash may leave a lock or unreferenced package that needs inspection.

`download-screen.ts` uses the existing setup prompt lifecycle and screen layout. The progress bar is based on received package bytes; verification has its own log state. Logs are bounded and wrapped. Pause stops between requests, cancellation aborts network requests and waits for filesystem cleanup, and resize preserves the download state. Once `current.json` is published, cleanup failures preserve the successful installation result. The UI reports the cleanup problem separately; every cleanup operation is attempted even if another fails. Before publication, cleanup does not replace the original installation error. No downloaded code is executed. API initialization, model inference and service installation remain separate future steps.

The isolated download tests use freshly generated signing keys, synthetic encrypted-file bytes and an injected transport. No customer license or production device is used. The terminal layout adapts the Gallery upload-progress concept to existing CLI styles.

## License persistence and update permissions

`license-store.ts` wraps Bun 1.3.14's native secrets API, using service `com.themistic.velora` and account `license`. Access is not marked unrestricted. No keys are passed through process arguments or environment variables. Native errors are replaced with safe messages. `@types/bun` supplies the runtime types; the build still produces a standalone executable.

`manage-license.ts` owns the order: normalize input, resolve the existing engine device identity, verify access, then replace the stored key. Status reads never write. The old key is not deleted before replacement, and rejected checks never reach the credential write. Native credential operations are not cancellable once started, so the terminal waits for completion and reports a successful write accurately even if Ctrl+C arrived during it. No command releases a server-side device slot. Setup and `license-command.ts` share this flow.

`engine-update-preferences.ts` persists `checkAutomatically` and `installAutomatically` to `<data directory>/models/<model-id>/engine-updates.json` using a flushed temporary file and rename. Automatic installation requires automatic checks. These values are permissions for the engine itself, not for velora updates or switching to another model. No engine scheduler or preference consumer has been wired yet; absence of settings grants no permission. A future engine bridge must read and apply them before automatic operations.

`cli-update.ts` independently queries the public GitHub latest-release endpoint without credentials. Stable version tags are validated and compared using Bun semver; draft, prerelease, old, malformed or oversized results are ignored. `startup-update.ts` records null permissions on the first interactive launch without prompting or requesting releases. On the second interactive launch it asks for check permission and, when enabled, future automatic installation permission. It atomically saves both choices in `<data directory>/cli-updates.json`. No is selected by default. Missing preferences restart the two-launch flow; invalid, unreadable or unwritable preferences grant no permission. Cancellation restores the terminal without checking. The bounded request runs before interactive launches only when `checkAutomatically` is explicitly true. Piped commands neither prompt nor check. `header.ts` displays the available version in its existing fourth logo row or in the compact header, preserving layout height. Doctor displays the same notice. Automatic installation permission is stored but has no consumer yet. Existing boolean check permissions remain valid; enabled checks with no installation choice prompt for that missing choice. No updater runs and no package manager is bypassed.

Verification includes synthetic license rejection and cancellation tests, an isolated native macOS Keychain round trip through a compiled binary, bounded release-response tests, atomic preference-file tests, and PTY checks of the complete setup and license commands. Native Windows/Linux credential stores remain unverified. References: [Bun secrets](https://bun.sh/docs/runtime/secrets), [Bun semver](https://bun.sh/docs/runtime/semver), [GitHub releases API](https://docs.github.com/en/rest/releases/releases).

## Download hardening

Only explicit `DownloadError` messages are displayed verbatim. Transport, parser and filesystem diagnostics cannot leak arbitrary text through the download UI. Known disk-space and permission failures have fixed actionable messages. Storage paths are checked at each managed model-directory level before writing; symbolic links there are rejected. This is not a sandbox against another process running with the same account and filesystem privileges.

Cancellation waits for the in-flight operation. If publication already completed, setup reports that the model is installed instead of implying that cancellation undid it. Cancelling the subsequent preferences questions leaves the installation intact. A failed preferences write preserves existing settings and reports that they were not changed. Pause is honored before the first catalog request, so a paused transfer does not begin device registration.

PTY regression tests run actual prompts with isolated fixture modules and temporary storage through Bun's terminal API. They cover unexpected error redaction, disk-full messages, cancellation before installation, cancellation during publication and cancellation after completion. These PTY tests are skipped on Windows. Sudden power loss, native Windows/Linux credential stores, production model inference and automatic engine updates remain outside the verified scope.

## Shared menu navigation

Selection prompts explicitly enable Escape with `back: true`; back navigation is shown in the footer and is not a selectable row. Enter activates the selected action. Model details retain left/right paging and use the shared list renderer and navigation hook for the installation action. Escape also returns from details when the terminal is below the minimum size.
