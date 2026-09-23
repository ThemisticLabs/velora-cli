# Contributing to velora

Help make local anonymization easier to set up and use. Clear bug reports, thoughtful suggestions, documentation improvements, and focused code changes are welcome.

## Start with the current state

velora is in early development. The CLI supports help, version output, command suggestions, saved licenses and verified model installation. The service and local API are not implemented yet.

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
  src/
    cli.ts          CLI entry point
    commands/       Doctor and license commands
    setup/          Guided setup and model selection
    license/        Verification and credential storage
    downloads/      Package downloads and integrity checks
    updates/        CLI release checks and engine permissions
    terminal/       Shared terminal rendering
    system/         Platform integration
    assets/         Brand assets
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

## Setup

Run `velora setup` in an interactive terminal to choose license access or a public model. The last character typed at the end of the license key is visible for 600 ms before it is masked. The key is sent to the Themistic license server for a signed access check. The result shows expiry, device capacity, and entitled models. Verified keys are saved in the system credential store. Setup can reuse the saved license or replace it after another successful check. The access check does not activate a device. Failed checks offer Try again and Go back. Open a model and press I to install. After confirmation, the download registers this device with the license, displays byte-based progress and logs, and verifies the signed package. Space pauses after the current request; Ctrl+C cancels and removes temporary files. Existing installations are not replaced. Public Veyra1 installation is not available yet. Press Ctrl+C to cancel.

The interactive setup uses the terminal’s alternate screen. Each step replaces the previous view. Completion and Ctrl+C restore the original terminal with one summary. `src/terminal/set-setup-layout.ts` stores the current step heading; `src/terminal/use-setup-screen.ts` redraws the frame and footer when terminal dimensions change. Prompts retain their input and selection state.


The header uses a small static Unicode Braille mark derived from the supplied Themistic TC SVG logo. Setup uses a compact text header below 28 rows. There is no startup delay. Setup requires at least 60 columns and 20 rows.

The footer follows the terminal height. Resizing preserves the current input, selection and detail view. Below the minimum size, a notice replaces the content until the terminal is enlarged. Model tables show at least three models when available, with more rows in taller terminals.

License letters are normalized to uppercase as you type or paste. Model details come from the signed API response. List entries have full-width dividers and short descriptions; More above and More below indicate hidden entries. Enter opens a model; left/right arrows page through its overview, strengths, limitations, and installation status. Enter returns to the list.

Press F1 to open documentation for the current setup step or selected model. The links currently use placeholder routes on `docs.themistic.com`; see [ARCHITECTURE.md](ARCHITECTURE.md#contextual-documentation). Letters such as D remain ordinary input in license keys.

## Saved licenses and updates

`velora license set` asks for a key in the masked terminal input, verifies it without registering a device, then saves it in the system credential store. An invalid key or failed verification does not replace the saved license. `velora license status` checks validity and device capacity without displaying the key or registering a device. Changing a license does not release the old license's device slot.

Storage uses Bun's native secrets API: Keychain on macOS, Credential Manager on Windows, and a running Secret Service on Linux. There is no plaintext fallback. macOS may request permission to access the Keychain, particularly when moving between development and compiled executables.

After a successful model download, setup asks whether the engine may check for its own updates and, if allowed, whether it may install them automatically. These permissions are saved per model in `engine-updates.json`. The automatic engine updater is not connected yet; saving permission does not start a background task.

The first interactive launch records a pending choice without contacting GitHub. On the second interactive launch, velora asks whether it may check GitHub for new versions on startup and, if allowed, whether it may install updates automatically when that feature becomes available. No is selected by default for both questions. The choices are saved in `cli-updates.json` in the platform data directory, separately from engine permissions. Only explicit consent enables the check on subsequent interactive launches, with a 1.5-second request timeout. Set `checkAutomatically` to `false` in this file to disable checks; remove the file to restart the two-launch consent flow. Unreadable or invalid preferences disable checks. A newer version appears in the header. Offline, unavailable, malformed and rate-limited responses do not block normal use beyond that timeout. Piped commands keep their existing output and do not check for updates. Automatic installation permission is stored as `installAutomatically`; there is no CLI installer yet. Existing check permission is preserved; users who previously allowed checks are asked only for the missing installation choice.

Run `bun run start setup` to test license access and model installation.
