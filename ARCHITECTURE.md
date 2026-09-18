# velora architecture

This document describes the current implementation. Read [CODINGSTYLE.md](CODINGSTYLE.md) before changing code and [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

## Current scope

velora is a TypeScript CLI built with Bun. It supports help, version output, command suggestions, and an interactive setup preview. It checks license access with the Themistic server. It does not register devices, download engines, run models, create API keys, or install a service.

Setup sends the entered key over HTTPS for a signed read-only access check and displays expiry, occupied device slots, and entitled model IDs. It does not persist the key. Selecting a public model opens an availability notice with a way back to the access selection.

## Source layout

| File | Responsibility |
| --- | --- |
| `src/cli.ts` | Configure Commander, register commands, and dispatch arguments. |
| `src/setup.ts` | Own the setup flow, prompt theme, alternate-screen lifecycle, and completion status. |
| `src/set-setup-layout.ts` | Store the title, detail and footer for the current setup step. |
| `src/setup-dimensions.ts` | Define terminal limits and derive available content space from the rendered header. |
| `src/use-setup-screen.ts` | Render the shared frame and footer and subscribe to terminal resizing without restarting prompts. |
| `src/select-option.ts` | Handle setup choices with persistent selection and the shared responsive frame. |
| `src/license-access.ts` | Perform the bounded HTTPS access request, verify Ed25519 signatures and request binding, and validate the returned fields. |
| `src/model-list.ts` | Show a scrollable model list with dividers and overflow indicators, plus paged model details. |
| `src/license-input.ts` | Briefly reveal the last appended character, mask input, and reject an empty or whitespace-only key. |
| `src/header.ts` | Combine the product name, embedded version, and compact mark according to terminal size. |
| `src/style.ts` | Apply terminal styles and the Themistic accent, respecting color environment variables. |
| `src/assets/mark.json` | Store the static Unicode Braille mark derived from the Themistic logo. |
| `src/assets/logo.svg` | Keep an unchanged local copy of the original Themistic logo artwork. |
| `src/assets/SOURCES.md` | Record asset provenance. |
| `tests/cli.test.mjs` | Test the compiled CLI through child processes. |

Each implementation module has one callable public entry point. The command entry file runs directly, without a `main()` wrapper. There is no separate service layer or engine adapter yet.

## Command flow

```text
arguments
  src/cli.ts (Commander)
    help or no arguments -> styled help and header
    version              -> package version
    unknown command      -> error and spelling suggestion
    setup                -> src/setup.ts
```

Commander owns argument parsing and suggestions. `package.json` is the version source for both command output and the header. The source imports use `.js` extensions under the NodeNext TypeScript configuration; they resolve to the TypeScript modules during development and bundling. They do not require duplicate hand-maintained JavaScript files.

## Setup lifecycle

1. Reject execution unless both input and output are interactive terminals with at least 60 columns and 20 rows.
2. Enter the alternate screen, preserving the ordinary terminal view.
3. Draw the access selection and let Inquirer handle keyboard navigation.
4. For public access, show the availability notice and return on Go back.
5. For licensed access, read the key and run a cancellable access check. Failures offer retry or back; verified results show models and offer back or finish.
6. Restore the original screen and cursor in `finally`, then print one summary.

Ctrl+C is identified through Inquirer's `ExitPromptError` and exits with status 130. A terminal resize redraws the active prompt while preserving its state. Unexpected errors propagate after cleanup so their original cause remains available. Successful completion follows a verified valid access response. It does not activate a device or install a model.

`set-setup-layout.ts` stores the current step's labels. Every prompt calls `use-setup-screen.ts`, which subscribes to resize events and redraws the full frame through Inquirer's rendering cycle. The resize listener is removed when the prompt settles. Input, selected models and detail pages remain in prompt state. Below 60 columns or 20 rows, the prompt displays a size notice and suspends normal interaction; Ctrl+C still cancels. The header is compact below 28 rows, and the model table reserves space for at least three models and separate actions.

## Terminal conventions

Terminal control sequences have descriptive names at their point of use. The style function accepts only `accent`, `strong`, or `muted`; numeric style codes stay inside that module:

| Sequence | Purpose |
| --- | --- |
| `ESC[?1049h` / `ESC[?1049l` | Enter / leave the alternate screen. |
| `ESC[H` and `ESC[2J` | Move home and clear the screen. |
| `ESC7` / `ESC8` | Save / restore the cursor around footer rendering. |
| `ESC[row;1H` and `ESC[K` | Position the footer and clear the rest of its line. |
| `ESC[?25h` | Make the cursor visible on exit. |
| `ESC[1m`, `ESC[2m`, `ESC[0m` | Bold, dim, and reset text styling. |

The `accent` style uses `#686BE7`, or `#2525CC` when `COLORFGBG` ends in background index 15. This is a limited theme hint. `NO_COLOR`, `TERM=dumb`, and `FORCE_COLOR=0` disable styling; otherwise a nonzero `FORCE_COLOR` can enable it without a TTY. These switches affect text styling, not the setup's cursor-control sequences.

## Build and dependencies

`bun run start` executes `src/cli.ts`. `bun run check` type-checks without emitting JavaScript. `bun run build` compiles the entry point and its imports into `dist/velora`, including the Bun runtime and imported JSON. Automatic loading of `.env` and Bun configuration is disabled for the compiled executable.

Commander handles commands. `@inquirer/core` provides the prompt state and keyboard primitives for selection, input, progress and model views. TypeScript and Node-compatible type definitions are development dependencies. Their presence does not require users to install Node.js.

`bun link` exposes the built executable as `velora` during local development. Rebuilding updates that executable. Cross-platform release builds and package-manager publishing are future work.

## Data boundaries

The preview holds input in process memory. The last appended printable ASCII character is shown for 600 ms, then masked. Further input masks the previous character immediately. Deletion and navigation hide the revealed character. The prompt effect clears its timer on changes and exit. Masking limits terminal visibility, not memory access. The input is held only for the current access request. JavaScript strings cannot be reliably erased from memory by assigning another value.

Future engines and model weights remain separate from this repository and executable. Device registration, download integrity, and engine startup need explicit integration before any setup step can report success. The local API and optional anonymization mapping are planned behavior, not implemented contracts.

## Current limits and verification

- Setup requires at least 60 columns and 20 rows. Smaller terminals receive a plain instruction before the alternate screen opens, so navigation and cancel hints are not silently truncated.
- Resizing preserves prompt state. Detail text is rewrapped to the new width; on multi-page sections, the page index is retained and clamped to the available pages.
- Unexpected errors propagate after terminal cleanup. Do not include license input in future error messages or diagnostic context.
- Automated tests cover command behavior, color controls, version output, runtime independence, and non-interactive setup rejection.
- Terminal checks also exercised the 60-by-20 layout, public access and Go back, empty license validation, long masked input, Ctrl+C, undersized terminals, and resize cleanup. These were PTY checks, not automated visual assertions or cross-platform verification.

## Adding the next feature

Keep command parsing in the entry point, setup decisions in the setup flow, and terminal rendering in the existing presentation modules. Add engine or license modules when the first real integration needs them. Do not put network calls inside prompt rendering callbacks. Validate external replies at the integration boundary, and only advance to a success state after the requested operation has actually completed.

## License access protocol

The fixed endpoint is `https://api.themistic.com/v1/license/check`, with `operation=access` and `model_id=null`. A fresh random probe identity is used only for this read-only check; it is not a persisted device fingerprint. The response shows total device usage, not recognition of this computer. The public Ed25519 key comes from the existing Themistic engine SDK. Redirects are rejected, requests time out after 15 seconds, and response bodies are limited to 256 KiB. Signatures cover the raw response bytes. Nonce, operation, license key, model ID, and probe identity must match before access is accepted. Signed 429/503 responses bind only the nonce under the server contract. No offline cache is used.

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

`src/open-documentation.ts` restricts destinations to the HTTPS documentation origin and invokes the browser without a shell. macOS uses Safari; Windows and Linux use their system URL handlers. “Sent to browser” confirms the opener completed, not that the page loaded. Browser launch arguments were verified using a test opener on macOS; the placeholder site and other platform handlers are not live-verified.
