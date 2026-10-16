# Use velora

[Overview](../README.md) · [Setup](setup.md) · [Updates](updates.md)

## Main menu

The menu shows the selected model and current service state, followed by **Start** or **Stop**, **Anonymize text**, **API keys**, then **Settings**. Service status refreshes while the main menu is open, including changes made from another terminal. Start uses the same independent service as `velora serve start --headless`; opening the menu does not start it. Stop waits for active requests. Ctrl+C closes only the interactive session, including during a service startup or shutdown wait.

Use `velora settings` to open the settings page directly. Settings let you change your license, switch between installed models, install another model, delete a model after confirmation, edit update permissions, and check for velora and engine updates. Permissions are edited together with On/Off rows and an explicit Save changes action. Esc goes back and discards unsaved edits; Ctrl+C closes velora.

Selection is saved locally. Installed-model lists show model versions. New model versions are separate choices, not updates to an installed model. Update checks show installed and available versions separately. Available shows `Not checked`, a newer version, `Up to date` after a successful check, or `Unavailable` when verification fails. The engine runs temporarily for license checks and installation. Selecting a model does not load it for inference.

## Anonymize text

Choose **Anonymize text** in the main menu to enter a single line. If the service is stopped, the screen offers **Start service** before asking for text. Start failures show the service error before returning to the menu. Enter submits the text; Esc returns. The input accepts up to 4096 characters, scrolls horizontally and supports ←/→, Home/End, Backspace and Delete. Errors offer a retry and keep the entered text available for editing.

The result supports ↑/↓ scrolling and Home/End. Press **M** to toggle the mapping, **C** to copy the anonymized text, Enter for another input or Esc to return. Mapping shows original values; copying always copies only the anonymized text. Input and results are not saved by the menu.

For UTF-8 files, multiline text or pipelines, use the running service from your terminal:

```sh
velora anonymize input.txt
velora anonymize < input.txt > anonymized.txt
printf 'Hallo Anna Müller.' | velora anonymize --json
velora anonymize input.txt --mapping > result.json
```

With no file argument or with `-`, the command reads stdin until EOF. A file argument reads that file. Plain output preserves the returned text without adding a newline. `--json` returns a JSON object containing `text`; `--mapping` adds the original-value mapping and implies JSON output. Progress and errors do not appear on stdout. The command writes no files itself; shell redirection chooses where output is saved.

Start the service with `velora serve start --headless` first. If status reports `failed`, inspect `velora serve status`, then run `velora serve stop` before starting it again. While the service is loading or stopping, wait for that operation to finish. The command reuses its loaded model and authenticates using the current private service record. It does not create an application API key, read the license store, download packages or start a second engine. Other applications still use their application API keys.

Input must be valid UTF-8 and fit both the 1.6 MiB raw-input limit and the 1.6 MiB encoded JSON body limit. JSON escaping can make the encoded body larger than the file. The service also enforces its existing engine-message limit and single processing slot. Oversized or invalid input, service errors and output-pipe failures exit with code 1 and a plain stderr message. SIGINT uses 130 and SIGTERM uses 143. Cancellation closes the client wait; an engine request already running in the independent service may finish and continues to occupy the processing slot until it settles.

## Manage models

**Settings → Manage models** groups switching, installing another model and deleting a model. New model versions are separate choices. Installed models are not updated in place. Stop the service before switching or deleting a model. Switching saves your selection; start the service separately to load it.

Deleting a model removes its local package. The shared engine, its update permissions, saved license and device identity remain. Update checks and permissions for velora and the engine stay separate; automatic velora installation is available with explicit consent. Automatic engine installation is not connected.

<img width="1055" height="711" alt="VeloraCliSettings" src="https://github.com/user-attachments/assets/697fffd2-32e6-45d7-881f-dbcad5608634" />

## Model commands

List, install and select models without opening the interactive menu:

```sh
velora models list
velora models list --available
velora models install skira7alpha
velora models select skira7alpha
```

`list` reads installed models locally and marks the selected model. Add `--available` to check the models included in your saved license, including download availability and installation status. Both forms accept `--json`; progress and errors go to stderr so stdout contains only the JSON array. A failed command exits nonzero.

Online checks and installation use the license saved by `velora license set`. They may download the verified standalone engine first. License keys are not accepted as command arguments. Model identifiers come from `list --available`; the example requires that model to be included in your license.

`install` downloads and verifies the model without prompting and may register this device with your license. An already installed model is kept. Installing another model preserves the current selection, including an automatically selected single model; use `select` to change it. A single installed model is selected automatically when no selection has been saved. Stop the service before changing the selection. These commands do not start or reload the service. After selection, use `velora serve start --headless` to load the model and start the API.

Ctrl+C cancels an online operation with exit code 130; SIGTERM uses 143. Partial downloads and engine locks may remain after interruption. Inspect them before retrying. If installation finishes before cancellation completes, the command reports the installed model and keeps the cancellation exit code. If installation succeeds but cleanup fails, the command reports the installed model and exits nonzero with a cleanup warning.

## Independent service

The independent service process can be started, checked and stopped:

```sh
velora serve start --headless
velora serve status
velora serve stop
```

The service survives closing the terminal. On macOS, Start opens the menu bar controls before loading the model. Start reads the saved license, reuses the verified installed engine and loads the selected installed model once. It reports ready only after the engine confirms the model and engine version. Repeated starts reuse that instance. Startup does not download packages; complete setup and select an installed model first. Status distinguishes starting, ready, stopping and failed. An engine crash requires an explicit stop and restart. Stop unloads the model and closes the engine.

Stop the service before switching or deleting a model. Model changes and service startup share an exclusive lock, so a running service cannot retain a model whose installation is being deleted. Switching the saved selection does not reload a running engine.

The service exposes POST /anonymize only on 127.0.0.1, using the port saved in Settings (8001 by default). Status shows the actual address. Create an application API key in the interactive menu, then use it:

```sh
curl http://127.0.0.1:8001/anonymize \
  -H "Authorization: Bearer $VELORA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hallo Anna Müller.","include_mapping":true}'
```

The response contains text and, when requested, mapping with original values, types and input occurrences. Positions count Unicode code points, including one position per emoji. The complete JSON body may contain at most 1.6 MiB. One authorized request is processed at a time; busy requests receive 429 with Retry-After. Keys are checked on every request. Browser access is blocked. API keys separate application access; they do not encrypt requests or responses. Processing is local, but engine license checks may use the network.

Stop waits for active processing and response completion before closing the engine. A disconnected client does not cancel inference. See [the API contract](local-api-draft.md) for validation, deadlines and errors. The macOS menubar controls the same service. macOS start at login can be enabled during setup or in Settings.

## Local API port

**Settings → Local API port** lets you edit the port or choose **Reset to default** (`8001`). Enter saves an edited port; Esc discards the edit. Saving shows **Saved.** in the port menu. `velora doctor` checks whether the saved port can currently be bound on loopback. This setting does not start or restart a server. A running service keeps its current port until you stop and start it. Its current behavior is recorded in [the local API contract](local-api-draft.md).

## Application keys

Open **API keys** in the main menu for the key table. Choose **Add API key** to open a popup, enter a name and an optional note, then select **Create key**. The new key appears immediately in the popup and is copied to the clipboard automatically. It stays visible until you close the popup, including when copying fails. Keys cannot be retrieved later. Select an existing row to revoke that application's key after confirmation.

<img width="1055" height="711" alt="VeloraCliApiKeys" src="https://github.com/user-attachments/assets/24531d5b-6e66-4c71-bc08-d4816c18c094" />


API keys identify applications and separate their access. They do not encrypt requests, responses or processing. Key metadata and SHA-256 hashes are stored in `api-keys.json` and a recovery copy with restricted file permissions. Plaintext keys are never saved. Both copies carry a revision and checksum; the latest valid revision is used if one copy is damaged. If both are unreadable, changes are refused. This is a file store, not a database. Names and notes are not encrypted. License keys remain in the system credential store. Creating an application key does not start the HTTP service.

## macOS menu bar and start at login

On macOS, starting velora creates one independent TC menu bar item before the command runs, including headless service starts. Its popover shows the service status, Start/Stop and Open velora. Bottom icon buttons open Settings and quit velora. Quit stops the service, closes the interactive session and removes the menu bar item. A Finder/Spotlight launcher is not available yet; after quitting, run velora to reopen it. The logo opens themistic.com. Closing the CLI or stopping the service leaves these controls available.

Open velora reuses the registered interactive terminal session. Settings opens the same session on its settings page; a running installation finishes before navigation. Without a session, the configured shell-script handler opens the terminal with its normal shell configuration and starts velora. Ghostty and Apple Terminal support exact session reuse. Terminal automation may require macOS permission. Start at login is registered only after the user enables it.

On macOS, **Start at login** registers a user LaunchAgent for `velora serve start --headless`. It takes effect at the next login and does not start the service during setup. A saved license and installed model are required to start the API. Change this later under **Settings → Start at login**. Windows and Linux autostart are not implemented yet.

## Check your installation

Run `velora doctor`, or `bun run start doctor` from the source checkout. It reports your system, checks whether the global command is in PATH, tests storage access and checks license-server reachability and validates your saved license through the installed engine. Missing licenses show a warning; invalid licenses show an error. Doctor also verifies the installed engine protocol, loads the selected model and runs a short synthetic inference request. It reports the engine and model versions, then closes its temporary engine session. Missing prerequisites appear as warnings instead of successful checks. Doctor does not download an engine or model.

Checks that need attention include a next step. A completed report exits normally, even when a check needs attention. Read the individual results; exit code 0 does not mean every check passed. Successful runtime checks verify this diagnostic engine session, not the readiness of a separately running service.

**Settings → Doctor** runs the same checks as `velora doctor`, with a progress bar, the current check and results below it. Doctor, download results and update messages share status colors: green for success, orange for warnings and red for errors. The percentage counts completed checks, not elapsed time. Completed results start at the top. Use ↑/↓ to scroll and Home/End to jump to the first or last result. Enter returns when checks finish; Esc cancels and returns to Settings. Ctrl+C quits velora.
