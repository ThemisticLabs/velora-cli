# Contributing to velora

Help make local anonymization easier to set up and use. Clear bug reports, thoughtful suggestions, documentation improvements, and focused code changes are welcome.

## Start with the current state

velora is in early development. The CLI currently supports help, version output, and suggestions for misspelled commands and options. Model setup, the service, and the local API are not implemented yet.

Use Bun 1.3.14 or newer for development. Users of the compiled CLI do not need Bun or Node.js installed:

```sh
bun install --frozen-lockfile
bun run build
bun run test
bun run check
./dist/velora --help
```

To make your development build available as `velora` from any directory, run `bun link` after building. Rebuild after changing source files. Remove the global link with `bun unlink` from the project directory when you no longer need it.

For a new feature or a change to commands, API responses, or model handling, open an issue before starting substantial work. Describe the task you want to complete, where the current approach falls short, and what you propose. Small documentation corrections can go straight to a pull request.

## Find your way around

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the current modules, setup lifecycle, terminal conventions, and known limitations.

```text
velora-cli/
  src/              TypeScript implementation
  tests/            Automated behavior tests
  README.md         Product overview and development status
  CONTRIBUTING.md   Contribution guide and code conventions
  CODINGSTYLE.md    Full TypeScript and JavaScript style guide
```

The build creates a standalone executable in `dist/velora`, with the Bun runtime and package version embedded. Model engines remain separate downloads. macOS is currently verified; Windows and Linux releases and package-manager distribution will follow.

Start with `src/cli.ts` for the command-line entry point. `tests/cli.test.mjs` checks the compiled CLI as a separate process. Add folders as features need them, rather than creating empty modules in advance. Generated build output belongs in `dist/` and is not committed.

## Report a problem

Include the steps to reproduce it, what you expected, and what happened. For runtime problems, include your operating system, velora version, and the relevant error message when available.

Use invented examples. Keep license keys, API keys, credentials, and personal data out of issues, logs, screenshots, and test fixtures.

## Make a focused change

1. Fork the repository and create a branch for your change.
2. Keep the change limited to one clear purpose. Follow the patterns in the files you touch and reuse existing code where it fits.
3. Check the affected behavior. Run the relevant project checks once they exist, and update documentation when behavior changes.
4. Open a pull request explaining the problem, the resulting behavior, and how you checked it. State any checks you could not run.

Keep unrelated formatting and refactoring out of the pull request. For bug fixes, add a regression test when it can meaningfully catch the problem. Review may lead to a smaller first change or a different approach.

## Keep TypeScript easy to follow

The project favors direct control flow and small, readable changes:

Read [CODINGSTYLE.md](CODINGSTYLE.md) for the full conventions and an example.

- Use guard clauses for early exits. Avoid nested failure branches and unnecessary `main()` wrappers.
- Use `var`, with uppercase names for constants. Declare variables where their values are assigned.
- Use descriptive English names and classic loops instead of `.map()`, `.filter()`, or `.join()`. Avoid ternary expressions.
- Give each module one clear responsibility and one callable public entry point. Place private helpers below the main flow, in the order they are used.
- Keep one-off logic inline. Extract helpers when the same logic is needed in at least three places, and check for an existing solution first.
- Calculate shared intermediate results once and pass them on.
- Validate user input and external responses at their boundaries. Add comments only when the reason behind the code is not apparent.
- Build for the current requirement. Avoid abstractions for features that have not been agreed on.

If a language or framework constraint calls for an exception, explain it in the pull request.

## Write for the person using it

User-facing text and documentation are in English. Lead with the useful outcome, then give the concrete action or detail. Keep command names and terminology consistent.

Errors should explain the current state and a way forward without blaming the user. Distinguish planned features from working behavior, and only report success when the action has been confirmed.

## Respect the model boundary

velora is the CLI product. Skira and Veyra are model families it is intended to support. The CLI and engine packages are distributed separately.

Do not add model weights, licensed engine packages, or credentials to this repository. Changes to model integration should preserve the engine's license and device-registration contract.

## Terminal colors

Help uses the Themistic Gallery accents: `#686BE7` by default and `#2525CC` when `COLORFGBG` reports background index 15 (white). This is a limited hint, not full terminal-theme detection. RGB colors require a true-color terminal. Other text follows the user's terminal palette.

Piped output is plain. `NO_COLOR`, `TERM=dumb`, and `FORCE_COLOR=0` disable colors; `FORCE_COLOR=1` enables them otherwise. The palette comes from the Themistic Gallery design standard; no extra color dependency is used.

## Setup preview

Run `velora setup` in an interactive terminal to choose license access or a public model. The last character typed at the end of the license key is visible for 600 ms before it is masked. Verification is not connected yet: the key is neither sent nor saved, and no device is activated. Public Veyra1 installation is not available in this preview. Press Ctrl+C to cancel.

The interactive setup uses the terminal’s alternate screen. Each step replaces the previous view. Completion and Ctrl+C restore the original terminal with one summary. `src/render-setup.ts` owns the setup layout; prompts handle keyboard input.


The header uses a small static Unicode dot mark on the left, derived from the original Themistic SVG logo. It remains visible during setup. There is no startup animation or delay. Terminals below 24 rows show the product name alone. Setup requires at least 60 columns and 20 rows.

The setup footer is positioned on the penultimate terminal row when each step opens. Prompt validation does not move it. Below 24 terminal rows, the header shows only the product name; larger terminals use a four-row logo. Resizing cancels the preview, restores the terminal, and asks you to run setup again. Live reflow with preserved input is not implemented.
