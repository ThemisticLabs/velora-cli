# velora

Local anonymization for the tools you already use.

> **Actively developed and maintained by Themistic.** velora is in early development. This repository contains a working CLI foundation and an interactive setup, not a finished release. Signed model downloads are implemented; the local API and service setup are still being built.

velora is an open-source CLI from Themistic, being built to run model families such as Skira and Veyra on your device and make them available through a local API.
<img width="1179" height="761" alt="velora CLI development screenshot" src="https://github.com/user-attachments/assets/23185312-759a-44a4-94c8-f10075d08203" />
## Planned workflow

The planned workflow will guide you from choosing a model to creating an API key for your tools. velora is designed to guide you through model downloads and license activation, with commands to check, pause, and resume the local service. On macOS, a small menu bar control will keep its status close at hand.

The API will return anonymized text, with the original-value mapping included when requested.

## Development status

The TypeScript CLI currently provides help, version output, suggestions for misspelled commands, and an interactive setup. License access is checked with the Themistic server; verified keys are saved in the system credential store. Model packages can be downloaded and verified. The local API is not available yet. This checkout is a development version.

Development uses Bun. The build produces a standalone executable with its runtime included, so users do not need to install Bun or Node.js. Homebrew, WinGet, and direct release downloads are planned.

To run the development build, follow [CONTRIBUTING.md](CONTRIBUTING.md). Code conventions are documented in [CODINGSTYLE.md](CODINGSTYLE.md).

See [ARCHITECTURE.md](ARCHITECTURE.md) for the current implementation and its boundaries.

The CLI and its models are distributed separately. Licensed models use the Themistic license server to download their engine packages. The planned public Veyra1 model will offer a path without a license key.

## Main menu

Run `velora` to open the menu. On first use, it guides you through license setup and model installation. A saved license takes you directly to the menu on later launches.

The menu shows the selected model and **Settings**. Settings let you change your license, switch between installed models, install another model, delete a model after confirmation, edit update permissions, and check for velora or model package updates. Permissions are edited together with On/Off rows and an explicit Save changes action. Esc goes back and discards unsaved edits; Ctrl+C closes velora. Selection is saved locally. Installed-model lists show model and engine versions. Update checks show installed and available versions separately. The engine is not running yet, so selection does not mean a model is loaded.

Deleting a model removes its local package and engine preferences. Your saved license and device identity remain. Update checks and permissions for velora and the engine stay separate; automatic installation is not implemented yet.

## Setup

Run `velora setup` in an interactive terminal to choose license access or a public model. The last character typed at the end of the license key is visible for 600 ms before it is masked. The key is sent to the Themistic license server for a signed access check. The result shows expiry, device capacity, and entitled models. Verified keys are saved in the system credential store. Setup can reuse the saved license or replace it after another successful check. The access check does not activate a device.

Failed checks offer Try again; press Esc to return. Enter opens a model. Use the left/right arrows to read its details, then select Install model with Enter. Esc returns to the model list. Installed models are excluded from the installation list.

After confirmation, the download registers this device with the license, displays byte-based progress and logs, and verifies the signed package. Space pauses after the current request; Ctrl+C cancels an unfinished download and removes its temporary files. A package already installed is preserved. Existing installations are not replaced. Public Veyra1 installation is not available yet.

Press F1 for documentation for the current step or selected model. The documentation routes are placeholders; see [ARCHITECTURE.md](ARCHITECTURE.md#contextual-documentation).

## Check your installation

Run `velora doctor`, or `bun run start doctor` from the source checkout. It reports your system, checks whether the global command is in PATH, tests storage access and contacts the license server without a license key.

Checks that need attention include a next step. A completed report exits normally, even when a check needs attention. Read the individual results; exit code 0 does not mean every check passed. These checks do not verify engine or model readiness.

## Saved licenses and updates

`velora license set` asks for a key in the masked terminal input, verifies it without registering a device, then saves it in the system credential store. An invalid key or failed verification does not replace the saved license. `velora license status` checks validity and device capacity without displaying the key or registering a device. Changing a license does not release the old license's device slot.

Storage uses Bun's native secrets API: Keychain on macOS, Credential Manager on Windows, and a running Secret Service on Linux. There is no plaintext fallback. macOS may request permission to access the Keychain, particularly when moving between development and compiled executables.

After a successful model download, setup asks whether the engine may check for its own updates and, if allowed, whether it may install them automatically. These permissions are saved per model in `engine-updates.json`. The automatic engine updater is not connected yet; saving permission does not start a background task.

The first interactive launch records a pending choice without contacting GitHub. On the second interactive launch, velora asks whether it may check GitHub for new versions on startup and, if allowed, whether it may install updates automatically when that feature becomes available. No is selected by default for both questions.

The choices are saved in `cli-updates.json` in the platform data directory, separately from engine permissions. Only explicit consent enables the check on subsequent interactive launches, with a 1.5-second request timeout. Use Settings → Update permissions to change these choices, then select Save changes. Unreadable or invalid preferences disable checks.

A newer version appears in the header. Offline, unavailable, malformed and rate-limited responses do not block normal use beyond that timeout. Piped commands keep their existing output and do not check for updates. Automatic installation permission is stored as `installAutomatically`; there is no CLI installer yet. Existing check permission is preserved; users who previously allowed checks are asked only for the missing installation choice.

## Releases

The GitHub Actions pipeline builds standalone binaries for macOS, Linux and Windows, runs native checks, and publishes version-tagged releases with SHA-256 checksums. See [RELEASE.md](RELEASE.md) for the release process and current signing limits.
