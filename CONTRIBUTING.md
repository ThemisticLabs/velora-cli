# Contributing to velora

Help make local anonymization easier to set up and use. Clear bug reports, thoughtful suggestions, documentation improvements, and focused code changes are welcome.

## Start with the current state

velora is in early development. The CLI supports help, version output, command suggestions, saved licenses and verified model installation. The service and local API are not implemented yet.

Use Bun 1.3.14 or newer for development. Users of the compiled CLI do not need Bun or Node.js installed:

```sh
bun install --frozen-lockfile
bun run check
bun run test
./dist/velora --help
```

To make your development build available as `velora` from any directory, run `bun link` after building. Rebuild after changing source files. Remove the global link with `bun unlink` from the project directory when you no longer need it.

For a new feature or a change to commands, API responses, or model handling, open an issue before starting substantial work. Describe the task you want to complete, where the current approach falls short, and what you propose. Small documentation corrections can go straight to a pull request.

## Find your way around

Read [ARCHITECTURE.md](ARCHITECTURE.md) for the current modules, setup lifecycle, terminal conventions, and known limitations.

```text
velora-cli/
  src/
    cli.ts          CLI entry point
    commands/       Doctor and license commands
    menu/           Main menu and settings
    models/         Installed model selection and deletion
    setup/          Guided setup and model selection
    license/        Verification and credential storage
    downloads/      Package downloads and integrity checks
    updates/        CLI release checks and engine permissions
    terminal/       Shared terminal rendering
    system/         Platform integration
    assets/         Brand assets
  scripts/          Release builds and metadata
  tests/            Automated behavior tests
  README.md         Product overview and development status
  CONTRIBUTING.md   Contribution guide and code conventions
  CODINGSTYLE.md    Full TypeScript and JavaScript style guide
```

The build creates a standalone executable in `dist/velora`, with the Bun runtime and package version embedded. Model engines remain separate downloads. The release workflow builds and checks macOS, Linux and Windows binaries on native runners. Package-manager distribution remains separate work. See [RELEASE.md](RELEASE.md) for release preparation and verification limits.

Start with `src/cli.ts` for the command-line entry point. `tests/cli.test.mjs` checks the compiled CLI as a separate process. Add folders as features need them, rather than creating empty modules in advance. Generated build output belongs in `dist/` and is not committed.

## Report a problem

Include the steps to reproduce it, what you expected, and what happened. For runtime problems, include your operating system, velora version, and the relevant error message when available.

Use invented examples. Keep license keys, API keys, credentials, and personal data out of issues, logs, screenshots, and test fixtures.

## Make a focused change

1. Fork the repository and create a branch for your change.
2. Keep the change limited to one clear purpose. Follow the patterns in the files you touch and reuse existing code where it fits.
3. Check the affected behavior. Run `bun run check` and `bun run test` for code changes, and update documentation when behavior changes.
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

## Interactive development checks

Run `bun run start` for the main menu or `bun run start setup` for setup without rebuilding the standalone executable. For the user workflow, license storage and update behavior, see [README.md](README.md#setup). Keep that description in one place when behavior changes.

Use a terminal of at least 60 columns and 20 rows. Check arrow-key selection, Enter to activate, Esc to return, and Ctrl+C to close. Model details use left/right arrows for pages and Enter for Install model when a download is available. F1 opens the contextual documentation route.

Check resizing, long labels, empty lists, and scroll indicators. Model lists must keep at least three entries visible at the minimum terminal size when available. Reuse `render-list.ts`, `use-list-navigation.ts` and `select-option.ts` for lists and actions; `use-setup-screen.ts` owns the shared frame, footer and resize handling.

The header uses the supplied Themistic TC mark and becomes compact below 28 rows. Prompts retain their state during resizing; below the minimum size, a notice replaces their content. See [ARCHITECTURE.md](ARCHITECTURE.md#terminal-conventions) for rendering details.

## Main menu checks

Run `bun run start` in a terminal. A saved license opens the main menu; without one, setup runs first. Use Settings for model management, license changes and update permissions. Esc returns one level in menus and cancels license entry without checking or saving a key. Permission edits remain a draft until Save changes. Ctrl+C restores the terminal. Selection means a local package has been chosen, not that the engine is running.

Menu tests use isolated credential and network fixtures. Storage tests cover selection persistence, deletion scope, held installation locks, missing packages and symlinks. Keep tests away from real licenses and installed models.
