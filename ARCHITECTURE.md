# velora architecture

This document describes the current implementation. Read [CODINGSTYLE.md](CODINGSTYLE.md) before changing code and [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow.

## Current scope

velora is a TypeScript CLI built with Bun. It supports help, version output, command suggestions, and an interactive setup preview. It does not yet contact the license server, register devices, download engines, run models, create API keys, or install a service.

The preview accepts a non-empty license key, masks its display, and ends with an explicit message that verification is not connected. It does not persist or transmit the key. Selecting a public model opens an availability notice with a way back to the access selection.

## Source layout

| File | Responsibility |
| --- | --- |
| `src/cli.ts` | Configure Commander, register commands, and dispatch arguments. |
| `src/setup.ts` | Own the setup flow, prompt theme, alternate-screen lifecycle, and completion status. |
| `src/render-setup.ts` | Draw the setup header, text, dividers, and positioned footer. |
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
5. For licensed access, draw the license step and await non-empty masked input.
6. Restore the original screen and cursor in `finally`, then print one summary.

Ctrl+C is identified through Inquirer's `ExitPromptError` and exits with status 130. A terminal resize aborts the active prompt, restores the terminal, and exits with status 1 and a restart instruction. Unexpected errors propagate after cleanup so their original cause remains available. Successful preview completion exits normally; it does not imply a valid license.

`render-setup.ts` owns the surrounding layout, while Inquirer owns the active prompt and its redraws. The footer is placed on the penultimate terminal row when a step opens. The header falls back to the product name below 40 columns or 24 rows. A resize listener cancels the prompt instead of letting it continue with stale layout coordinates. License masking is capped to the available line width without truncating the underlying key. Live layout reflow is not implemented.

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

Commander handles commands. `@inquirer/select` handles selection prompts; `@inquirer/core` provides the custom input prompt primitives. TypeScript and Node-compatible type definitions are development dependencies. Their presence does not require users to install Node.js.

`bun link` exposes the built executable as `velora` during local development. Rebuilding updates that executable. Cross-platform release builds and package-manager publishing are future work.

## Data boundaries

The preview holds input in process memory. The last appended printable ASCII character is shown for 600 ms, then masked. Further input masks the previous character immediately. Deletion and navigation hide the revealed character. The prompt effect clears its timer on changes and exit. Masking limits terminal visibility, not memory access. The preview discards the prompt result. JavaScript strings cannot be reliably erased from memory by assigning another value.

Future engines and model weights remain separate from this repository and executable. License verification, device registration, download integrity, and engine startup need explicit integration before any setup step can report success. The local API and optional anonymization mapping are planned behavior, not implemented contracts.

## Current limits and verification

- Setup requires at least 60 columns and 20 rows. Smaller terminals receive a plain instruction before the alternate screen opens, so navigation and cancel hints are not silently truncated.
- Resizing ends the preview with a restart instruction. Keeping prompt state during live reflow remains future work.
- Unexpected errors propagate after terminal cleanup. Do not include license input in future error messages or diagnostic context.
- Automated tests cover command behavior, color controls, version output, runtime independence, and non-interactive setup rejection.
- Terminal checks also exercised the 60-by-20 layout, public access and Go back, empty license validation, long masked input, Ctrl+C, undersized terminals, and resize cleanup. These were PTY checks, not automated visual assertions or cross-platform verification.

## Adding the next feature

Keep command parsing in the entry point, setup decisions in the setup flow, and terminal rendering in the existing presentation modules. Add engine or license modules when the first real integration needs them. Do not put network calls inside prompt rendering callbacks. Validate external replies at the integration boundary, and only advance to a success state after the requested operation has actually completed.
