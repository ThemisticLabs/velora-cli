# velora

Local anonymization for the tools you already use.

> **Actively developed and maintained by Themistic.** velora is in early development. This repository contains a working CLI foundation and an interactive setup, not a finished release. Verified engine downloads and engine-managed model installation are implemented; a headless local API is available. Interactive service controls and autostart are still being built.

velora is an open-source CLI from Themistic, being built to run model families such as Skira and Veyra on your device and make them available through a local API.
<img width="1179" height="761" alt="velora CLI development screenshot" src="https://github.com/user-attachments/assets/23185312-759a-44a4-94c8-f10075d08203" />
## Planned workflow

The planned workflow will guide you from choosing a model to creating an API key for your tools. velora is designed to guide you through model downloads and license activation, with commands to check, pause, and resume the local service. On macOS, a small menu bar control will keep its status close at hand.

The API will return anonymized text, with the original-value mapping included when requested.

## Development status

The TypeScript CLI currently provides help, version output, suggestions for misspelled commands, and an interactive setup. velora downloads the standalone Themistic Engine, then uses its local JSON-Lines interface to check license access and install models. Verified license keys are saved in the system credential store. The headless service provides the local API. This checkout is a development version.

Development uses Bun. The build produces a standalone executable with its runtime included, so users do not need to install Bun or Node.js. Homebrew, WinGet, and direct release downloads are planned.

To run the development build, follow [CONTRIBUTING.md](CONTRIBUTING.md). Code conventions are documented in [CODINGSTYLE.md](CODINGSTYLE.md).

See [ARCHITECTURE.md](ARCHITECTURE.md) for the current implementation and its boundaries.

**Settings → Local API port** lets you edit the port or choose **Reset to default** (`8001`). Enter saves an edited port; Esc discards the edit. Saving shows **Saved.** in the port menu. `velora doctor` checks whether the saved port can currently be bound on loopback. This setting does not start a server. Start the headless service to bind this port. Its current behavior is recorded in [the local API contract](docs/local-api-draft.md).

The CLI and its models are distributed separately. The shared engine downloads licensed model data from the Themistic license server. Users do not need Python or pip. The planned public Veyra1 model will offer a path without a license key.

## Main menu

Run `velora` to open the menu. On first use, it guides you through license setup and model installation. On later launches, velora checks the saved license before opening the menu. Expired, revoked or missing keys offer Change license and Check again. If verification is unavailable, you can still open the menu to manage settings; this does not grant model access.

The menu shows the selected model and current service state, followed by **Start** or **Stop**, **API keys**, then **Settings**. Service status refreshes while the main menu is open, including changes made from another terminal. Start uses the same independent service as `velora serve start --headless`; opening the menu does not start it. Stop waits for active requests. Ctrl+C closes only the interactive session, including during a service startup or shutdown wait. Use `velora settings` to open the settings page directly. Settings let you change your license, switch between installed models, install another model, delete a model after confirmation, edit update permissions, and check for velora and engine updates. Permissions are edited together with On/Off rows and an explicit Save changes action. Esc goes back and discards unsaved edits; Ctrl+C closes velora. Selection is saved locally. Installed-model lists show model versions. New model versions are separate choices, not updates to an installed model. Update checks show installed and available versions separately. Available shows `Not checked`, a newer version, `Up to date` after a successful check, or `Unavailable` when verification fails. The engine runs temporarily for license checks and installation. Selecting a model does not load it for inference.

Deleting a model removes its local package. The shared engine, its update permissions, saved license and device identity remain. Update checks and permissions for velora and the engine stay separate; automatic velora installation is available with explicit consent. Automatic engine installation is not connected.

## Independent service

The independent service process can be started, checked and stopped:

```sh
velora serve start --headless
velora serve status
velora serve stop
```

The service survives closing the terminal. Start reads the saved license, reuses the verified installed engine and loads the selected installed model once. It reports ready only after the engine confirms the model and engine version. Repeated starts reuse that instance. Startup does not download packages; complete setup and select an installed model first. Status distinguishes starting, ready, stopping and failed. An engine crash requires an explicit stop and restart. Stop unloads the model and closes the engine.

Stop the service before switching or deleting a model. Model changes and service startup share an exclusive lock, so a running service cannot retain a model whose installation is being deleted. Switching the saved selection does not reload a running engine.

The service exposes POST /anonymize only on 127.0.0.1, using the port saved in Settings (8001 by default). Status shows the actual address. Create an application API key in the interactive menu, then use it:

```sh
curl http://127.0.0.1:8001/anonymize \
  -H "Authorization: Bearer $VELORA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hallo Anna Müller.","include_mapping":true}'
```

The response contains text and, when requested, mapping with original values, types and input occurrences. Positions count Unicode code points, including one position per emoji. The complete JSON body may contain at most 1.6 MiB. One authorized request is processed at a time; busy requests receive 429 with Retry-After. Keys are checked on every request. Browser access is blocked. API keys separate application access; they do not encrypt requests or responses. Processing is local, but engine license checks may use the network.

Stop waits for active processing and response completion before closing the engine. A disconnected client does not cancel inference. See [the API contract](docs/local-api-draft.md) for validation, deadlines and errors. The macOS menubar controls the same service. Operating-system autostart is not registered yet.

## Application keys

Open **API keys** in the main menu for the key table. Choose **Add API key** to open a popup, enter a name and an optional note, then select **Create key**. The new key appears immediately in the popup and is copied to the clipboard automatically. It stays visible until you close the popup, including when copying fails. Keys cannot be retrieved later. Select an existing row to revoke that application's key after confirmation.

API keys identify applications and separate their access. They do not encrypt requests, responses or processing. Key metadata and SHA-256 hashes are stored in `api-keys.json` and a recovery copy with restricted file permissions. Plaintext keys are never saved. Both copies carry a revision and checksum; the latest valid revision is used if one copy is damaged. If both are unreadable, changes are refused. This is a file store, not a database. Names and notes are not encrypted. License keys remain in the system credential store. Creating an application key does not start the HTTP service.

On macOS, opening the interactive CLI or starting the headless service creates one independent TC menu bar item. Its popover shows the service status and Start/Stop, Open velora and Settings. The logo opens themistic.com. Closing the CLI or stopping the service leaves these controls available.

Open velora reuses the registered interactive terminal session. Settings opens the same session on its settings page; a running installation finishes before navigation. Without a session, the configured shell-script handler opens the terminal with its normal shell configuration and starts velora. Ghostty and Apple Terminal support exact session reuse. Terminal automation may require macOS permission. No autostart is registered.

## Setup

Run `velora setup` in an interactive terminal to choose license access or a public model. The last character typed at the end of the license key is visible for 600 ms before it is masked. On first use, the key authorizes a verified standalone engine download. The engine then checks your licensed models through the server. The result shows expiry, device capacity, and entitled models. Verified license keys are saved in the system credential store. Setup can reuse the saved license or replace it after another successful check. The access check does not activate a device.

Failed checks offer Try again; press Esc to return. Enter opens a model. Use the left/right arrows to read its details, then select Install model with Enter. Esc returns to the model list. Installed models are excluded from the installation list.

After confirmation, the engine downloads and verifies the model and obtains the installation receipt. Model downloads can register this device with the license. Model installation requires engine 0.4.4 or later with support for separate model installation. Download progress appears above the status messages. Verification and confirmation use an animated status. Ctrl+C stops the engine process; partially installed files and engine locks may remain and need inspection before retrying. Pause and resume are not supported by the engine protocol. Only confirmed installations appear in the model menu. Existing installations are not replaced. Public Veyra1 installation is not available yet.

Press F1 for documentation for the current step or selected model. Model and license links use the published documentation; see [ARCHITECTURE.md](ARCHITECTURE.md#contextual-documentation).

## Check your installation

Run `velora doctor`, or `bun run start doctor` from the source checkout. It reports your system, checks whether the global command is in PATH, tests storage access and checks license-server reachability and validates your saved license through the installed engine. Missing licenses show a warning; invalid licenses show an error. Doctor also verifies the installed engine protocol, loads the selected model and runs a short synthetic inference request. It reports the engine and model versions, then closes its temporary engine session. Missing prerequisites appear as warnings instead of successful checks. Doctor does not download an engine or model.

Checks that need attention include a next step. A completed report exits normally, even when a check needs attention. Read the individual results; exit code 0 does not mean every check passed. These checks do not verify engine or model readiness.

## Saved licenses and updates

`velora license set` asks for a key in the masked terminal input, verifies it without registering a device, then saves it in the system credential store. The first check may download the engine. An invalid key or failed verification does not replace the saved license. `velora license status` checks validity and device capacity without displaying the key or registering a device. Changing a license does not release the old license's device slot.

Storage uses Bun's native secrets API: Keychain on macOS, Credential Manager on Windows, and a running Secret Service on Linux. There is no plaintext fallback. macOS may request permission to access the Keychain, particularly when moving between development and compiled executables.

After a successful model download, setup asks once whether velora may check for shared engine updates at startup and saves the choice in `<data>/engine-updates.json`. Settings can change this independently of the selected model. Earlier per-model preferences are not treated as consent for the shared engine. Automatic installation remains unavailable; its saved permission is for future use.

The first interactive launch records a pending choice without contacting GitHub. On the second interactive launch, velora asks whether it may check GitHub for new versions on startup and, if allowed, whether it may install signed velora updates automatically. No is selected by default for both questions.

The choices are saved in `cli-updates.json` in the platform data directory, separately from engine permissions. Only explicit consent enables the check on subsequent interactive launches, with a 1.5-second request timeout. Use Settings → Update permissions to change these choices, then select Save changes. Unreadable or invalid preferences disable checks.

A newer version appears in the header. Offline, unavailable, malformed and rate-limited responses do not block normal use beyond that timeout. Piped commands keep their existing output and do not check for updates. When opening the interactive menu with automatic installation enabled, a newer stable release is downloaded, signature-checked and tested before velora closes for installation. Explicit commands such as doctor, help and version continue normally. You can also confirm installation in Settings → Check for updates. The installer replaces only the standalone executable and retains a verified backup for rollback. Source runs are never replaced. Existing check permission is preserved; users who previously allowed checks are asked only for the missing installation choice.

## Releases

The GitHub Actions pipeline builds standalone binaries for macOS, Linux and Windows, runs native checks, and publishes version-tagged releases with SHA-256 checksums and an Ed25519-signed release manifest. See [RELEASE.md](RELEASE.md) for signing, installation, rollback and the remaining OS signing limits.

## Engine integration

The current integration follows the [License API guide](https://docs.themistic.com/velora/license-api/). Initial program downloads use `/license/engine` without a device ID. The engine owns the existing device identity and model installation; velora does not generate a second identity. Signatures, archive inventory, paths, checksums and executable permissions are checked before starting downloaded code.

Engine packages currently target Apple Silicon on macOS 14+, Windows x64, and Linux x64/ARM64 with glibc 2.38+. A platform supported by the CLI build is not necessarily supported by the engine. Model availability comes from your license, not a hard-coded model list.

A verified cached engine is reused. Engine checks use `/license/engine` and show available versions in the header and Settings. Manual engine checks also work without an installed model. Startup check results are reused in Settings. Select the Engine row to confirm an available update and view download progress. Engine replacement keeps installed models. Automatic installation is not connected.

## One engine for your models

velora uses one engine for all installed models. Installing or switching a model does not install another engine. If a model needs a newer engine, update it in Settings, then try again.

**Settings → Manage models** groups switching, installing another model and deleting a model. New model versions are separate choices. Installed models are not updated in place. Switching saves your selection; it does not yet start local processing.

**Settings → Doctor** runs the same checks as `velora doctor`, with a progress bar, the current check and results below it. Doctor, download results and update messages share status colors: green for success, orange for warnings and red for errors. The percentage counts completed checks, not elapsed time. Completed results start at the top. Use ↑/↓ to scroll and Home/End to jump to the first or last result. Enter returns when checks finish; Esc cancels and returns to Settings. Ctrl+C quits velora.

Older installations may still contain an unused second engine directory. It is left in place until a separate cleanup is reviewed. See [ARCHITECTURE.md](ARCHITECTURE.md) for storage and protocol details.
