# Local API contract

This document describes the implemented HTTP contract and service lifecycle. The independent service loads the selected model and serves `POST /anonymize` through the configured loopback port. Interactive Start/Stop and macOS menubar controls use the same service. macOS start at login is registered only when the user enables it; Windows/Linux autostart remain unimplemented. Remaining work is listed at the end.

## Local access

The API binds only to `127.0.0.1`. Its default address is `http://127.0.0.1:8001`. Settings can change the port, but cannot enable remote access. Never bind to `0.0.0.0` or `::`. IPv6 support is outside the first implementation.

Each application uses its own named API key:

```http
Authorization: Bearer velora_…
Content-Type: application/json
```

The main menu provides key creation and individual revocation. Keys have a name and optional note. A new key is shown immediately and copied to the clipboard. Only SHA-256 digests and metadata are persisted; plaintext keys cannot be retrieved later.

API keys authenticate requests and let users manage access separately for each application. They do not encrypt text, mappings or responses. Requests use HTTP over loopback, and anonymization happens locally. License checks can contact the license server; local processing does not mean that every operation is offline.

The first implementation rejects requests containing Origin or Sec-Fetch-Site and provides no CORS permission. Browser access is not enabled. Host must exactly match 127.0.0.1:{running port}; DNS names are rejected. Loopback binding alone does not prevent other programs on the device from making requests.

## Anonymize text

Use `POST /anonymize`. There is no `/v1` prefix.

```json
{
  "text": "Hallo Anna Müller.",
  "include_mapping": false
}
```

`text` is a required string. `include_mapping` is an optional boolean and defaults to `false`. The API uses the model selected when the service starts. Requests cannot select or change a model.

A successful response without mapping contains only the anonymized text:

```json
{
  "text": "Hallo [PERSON:1]."
}
```

With `include_mapping: true`:

```json
{
  "text": "Hallo [PERSON:1].",
  "mapping": {
    "[PERSON:1]": {
      "original": "Anna Müller",
      "type": "PERSON",
      "occurrences": [
        {
          "start": 6,
          "end": 17
        }
      ]
    }
  }
}
```

Mapping keys are the complete placeholders used in the response text. Each entry contains the original text, its type and all occurrences represented by that placeholder. Positions refer to the input text, start at zero and use an exclusive end. The first implementation preserves Unicode code-point positions from the engine. An emoji counts as one character; these are not JavaScript UTF-16 string indices. For JavaScript slicing, use Array.from(input).slice(start, end).

The example shows the HTTP format, not a guaranteed prediction for every model. The engine returns `placeholder_text` and numeric string mapping keys; velora adapts those fields to the agreed HTTP format.

Mapping contains sensitive original values. It is returned only when requested and is not persisted by velora. Requests, original text, mappings and API keys do not appear in API logs. Empty text is accepted; unknown fields, malformed UTF-8, unpaired Unicode surrogates and invalid field types return 400. If the engine groups different original spellings under one ID, velora splits them into separate placeholders so each original field matches all its occurrences. It verifies every input occurrence and the full placeholder output before returning a result.

## Request limits and concurrency

The entire UTF-8 JSON request body is limited to **1.6 MiB**. The implementation uses `floor(1.6 × 1024 × 1024)`, or **1,677,721 bytes**. This is a byte limit, not a token limit. There is no 32K-token limit.

The server enforces the limit while reading the body, including requests without a reliable `Content-Length`. Larger bodies receive HTTP `413`. Input is never silently truncated.

The engine bridge limits outgoing request lines to 2 MiB. It checks the serialized engine message, including its envelope and line terminator, before writing it. JSON escaping can expand the message, so an HTTP body below 1.6 MiB does not by itself guarantee that the engine request fits. An oversized engine message receives `413` before it is sent. This protocol check is separate from the HTTP body limit.

The server processes one anonymization request at a time. While the slot is occupied, another authorized processing request receives `429` and `Retry-After: 1`; requests are not queued. The slot includes reading the authorized request body, with a 15-second absolute upload deadline. The listener also has a 15-second transport idle timeout, disabled for a request once its processing slot is acquired. This concurrency rule is separate from the request-size limit.

## Errors

Errors use one JSON shape:

```json
{
  "error": {
    "code": "invalid_request",
    "message": "Provide text as a string."
  }
}
```

Codes identify the error for applications. Messages describe the problem and a useful next step. Do not return raw engine exceptions, local paths, license keys, API keys or input text.

Implemented errors:

| HTTP status | Code | Condition |
| --- | --- | --- |
| 400 | invalid_json, invalid_request, request_interrupted | Invalid or incomplete input |
| 401 | invalid_api_key | Missing, invalid or revoked application key |
| 403 | local_access_only, browser_access_denied | Wrong Host or browser request |
| 404 | route_not_found | Unknown path or query string |
| 405 | method_not_allowed | Use POST; response includes Allow |
| 408 | body_timeout | Body upload exceeded 15 seconds |
| 413 | request_too_large | HTTP body or encoded engine message too large |
| 415 | unsupported_content_type, unsupported_content_encoding | Use uncompressed UTF-8 JSON |
| 429 | engine_busy | One processing slot is occupied |
| 503 | key_store_unavailable, service_unavailable, license_unavailable, engine_unavailable | Storage, readiness, authorization or engine failure |
| 504 | processing_timeout | Engine exceeded its existing 30-second request deadline |

Keys are verified from the current store for each request, so revocation does not require a restart. The engine enforces license authorization during processing. A protocol timeout terminates the engine and leaves the service failed until manual restart. An oversized encoded message is rejected before writing to the child and does not terminate an otherwise healthy engine.

## Port settings and startup

Settings provides **Local API port** and **Reset to default**. The default is `8001`. Enter saves the edited port to `<data>/api.json`; Esc discards the edit. Reset saves the default immediately. Both actions show **Saved.** within the same menu. Valid ports range from `1` to `65535`.

The menu displays the saved address without claiming that a listener is running. Startup and Doctor can check current port availability. A probe cannot reserve the port; the actual bind remains authoritative.

At API startup, bind the saved port or the default if no port is saved. Handle a bind conflict before loading the model for API use. Keep the API stopped and Settings reachable:

> The local API could not start because port {port} is already in use. Choose another port in Settings, then try again.

The service does not silently choose another port or stop another process. Other bind failures have a separate error. Saving or resetting the port does not affect a running listener and does not offer an automatic restart. Run `velora serve stop`, wait for shutdown, then `velora serve start --headless` to apply the saved port. `velora serve status` reports the actual bound address.

## Engine check

For an explicitly authorized inference check against an existing installation:

```sh
bun run scripts/check-inference.ts /path/to/installed/data
```

The script reads the saved license from the system credential store, uses the selected installed model and cached verified engine, downloads no packages and closes the engine process afterwards. It checks fixed synthetic input, mapping positions, placeholder round trips, empty input and shutdown. License verification can contact the license server. This is a direct engine check, not a model-quality evaluation or an HTTP API test.

The optional native protocol smoke test in `tests/native-engine.test.ts` is different: it requires Engine 0.4.4 and checks the handshake and rejected installation requests. It does not install a model or run inference. Synthetic service/API tests and successful protocol checks do not establish native end-to-end acceptance; see [the release acceptance checks](../RELEASE.md#release-acceptance).

## Interactive start and stop

Opening `velora` connects the interactive session to the existing velora service, if one is running. Otherwise the main menu shows **Start**. Opening the menu alone does not start the API. Start launches the independent service, which binds the configured local port and loads the selected model into one engine process. Keep that process ready for subsequent requests instead of loading the model for every request.

Once startup succeeds, the same action becomes **Stop**. Stop shuts down the service, including its API and engine, while keeping the interactive menu open. The action returns to **Start** after shutdown completes. Ctrl+C closes only the interactive session. It does not stop an already running service or cancel its active request. Closing the terminal also leaves the independent service running.

The interactive CLI controls the same service used by headless startup. It does not own the service lifetime or create another engine when attaching. Service ownership, the local control channel, HTTP startup and shutdown, interactive controls, macOS menubar controls and optional macOS start at login are implemented.

## Stop during an active request

Stop stops accepting new anonymization work and lets the active request finish. After its response completes, shut down the listener and engine and return the menu action to **Start**. Show a stopping state while waiting; do not claim that shutdown has completed early.

Ctrl+C only disconnects and closes the interactive CLI; processing continues in the service. The control command waits up to 60 seconds for its acknowledgement and never automatically force-stops a request. If it times out, the service may still be draining; inspect status. A forced Stop action is not implemented. Any future forced Stop must require an explicit user action.

## Menubar: Open velora

The macOS menubar menu includes **Open velora**.

- If an interactive velora session exists, bring its terminal tab or window to the foreground. Do not launch another session.
- If no interactive session exists, open velora interactively in the user's configured terminal. Use Ghostty when that is the configured terminal; do not always force Apple Terminal.
- When an interactive session opens, check whether the velora API service is already running. Connect to the existing velora instance rather than starting a second API listener or engine. An occupied port alone is not proof that velora owns it.
- Concurrent starts must be coordinated, including simultaneous clicks on **Open velora**. Validate session ownership and process liveness rather than trusting a stale PID file.

The independent menubar helper shows service status above Start/Stop, followed by Open velora and Settings. The TC logo opens https://themistic.com. Stop drains processing and closes the API and engine; the helper stays available so Start can launch the service again.

Open velora authenticates the existing interactive session through a private Unix socket and focuses its exact Ghostty surface or Apple Terminal tab. Settings requests the settings page in that session. Navigation waits for an active installation or write to finish. Without a registered session, the configured shell-script handler launches a normal terminal window and starts the CLI. The terminal uses its own shell configuration and color environment. Unsupported terminal handlers report an opening failure instead of silently choosing another application.

Opening the menu or menubar does not register autostart. Registration requires an explicit choice in setup or Settings.

## Headless startup and autostart

The service runs independently of a terminal. A headless start command must return only after service startup succeeds or report a startup failure. Users can then close the terminal without stopping the service. Running the command when velora is already running must not start another instance.

The CLI provides:

```sh
velora serve start --headless
velora serve status
velora serve stop
```

Start opens the verified cached engine and loads the selected installed model once using the saved license. The service retains that session until Stop, reports starting or failed states and confirms model ID and engine version before reporting ready. It does not download packages. Its local API binds before model loading; port conflicts fail without loading an engine. Model-load failure releases the HTTP port. Ready reports the actual bound port. Stop closes the listener to new connections, waits for active processing and response completion, then closes the engine. Private status stays reachable and reports stopping during that wait. Start/Stop in the interactive menu uses the same service control and displays its current status. Ctrl+C closes only the interactive session and cancels its control wait. The independent macOS menubar controls the same service and remains available after Stop.

Optional autostart launches the same service headlessly at the appropriate operating-system startup event. It requires explicit user consent and a saved preference. Autostart must use the saved port and selected model, respect existing-instance detection and leave the interactive terminal closed. Registration alone does not prove that the service started; verify its actual state.

macOS start at login writes a user LaunchAgent after explicit selection in setup or Settings. It runs the public headless command at the next login, without immediately starting a service during registration. Windows/Linux registration and a complete logout/login acceptance check remain open. Manual Stop leaves autostart enabled for the next login. It must not immediately restart the service in the current session.

## Model selection and lifecycle

Stop the service before switching or deleting a model. Selection and deletion acquire the same ownership lock as the service, so they fail while it is starting, running, stopping or retaining ownership after a failure. They do not queue a model change behind an active request. Graceful Stop drains the request; selection and the next Start happen afterward.

`velora models list` and `velora models list --json` read the local inventory without a license check. `velora models install <id>` can add another licensed model without changing the effective selection or reloading the running engine. An automatically selected single model is saved before installing another package. `velora models select <id>` persists a choice only while the service is stopped. See [Model commands](usage.md#model-commands) for online listing, installation and cancellation behavior.

There is no automatic restart loop. Manual Stop keeps macOS start at login enabled for the next login. CLI and menubar controls share the private local service-control implementation; management does not open a second public TCP port.

## Failures during a request

If the engine crashes during anonymization, return HTTP `503` with the agreed error shape when the client is still connected. Do not expose raw engine exceptions or return an incomplete result. Report the engine failure through service status so the interactive CLI does not continue to show it as ready. Recovery requires a manual restart.

If the HTTP client disconnects, discard its result. Do not interrupt the shared engine process solely because that client disconnected. Keep the engine busy until processing actually finishes or fails; another request must not begin while that work is still running. An explicit service Stop still waits for that work, even though its client has disconnected.

## Remaining work and acceptance

- A forced Stop action is not implemented. The existing 60-second control wait does not cancel active inference when it expires.
- Model changes require Stop, selection and Start. Live model switching and rollback after a failed replacement load are not implemented.
- Port changes require a manual Stop and Start; the settings menu has no restart action.
- Pause/resume and a separate busy state in service status are not implemented. Concurrent HTTP work receives `429`; service status still reports running while inference is active.
- Windows/Linux autostart and a complete macOS logout/login acceptance check remain open. The updater does not restart an already running service into the new executable.
- The engine owns license authorization during processing. Native acceptance must cover expiry, denied access and connection failures during a long-running session; the API does not add an independent entitlement policy.
- Native credential stores, model installation, configured-terminal activation and the HTTP service need acceptance on their supported platforms. Fixture tests and a design preview do not establish that acceptance. Follow [RELEASE.md](../RELEASE.md#release-acceptance).
