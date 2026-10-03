# Local API plan

HTTP contract, first implementation and remaining lifecycle work, 3 October 2026. The independent service now loads the selected model and serves POST /anonymize through the configured loopback port. API-key management, saved port settings and an engine inference check are available. Interactive Start/Stop, service-owned menubar and operating-system autostart are not connected yet.

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

`text` is a required string. `include_mapping` is an optional boolean and defaults to `false`. The API uses the model selected in velora. Requests cannot select or change a model.

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

Enforce the limit while reading the body, including requests without a reliable `Content-Length`. Reject larger bodies with HTTP `413`. Never silently truncate input.

The engine protocol currently accepts request lines up to 2 MiB. Before sending a request, check the actual serialized engine message, including its envelope and line terminator. JSON escaping can expand the message, so an HTTP body below 1.6 MiB does not by itself guarantee that the engine request fits. Reject an oversized engine message with `413` before sending it. Keep this protocol check separate from the HTTP body limit.

Process one anonymization request at a time. While the engine is busy, reject another processing request with `429` and `Retry-After`. Do not create an unbounded queue. Retry-After is 1 second. The slot includes reading an authorized request body; uploads have a 15-second absolute deadline and a 15-second idle timeout. This concurrency rule is separate from the request-size limit.

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

Agreed statuses:

| HTTP status | Condition |
| --- | --- |
| `413` | HTTP body or serialized engine request is too large |
| `429` | Another anonymization request is being processed; include `Retry-After` |
| `503` | The engine crashes during processing; return a readable error if the client is still connected |

Additional implemented errors:

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

Do not silently choose another port or stop another process. Other bind failures need their own error. Applying a port change to a running server still needs a restart policy.

## Engine check

The existing project check records successful synthetic inference with engine 0.4.4 and an isolated skira7alpha3 installation. Repeated occurrences shared a placeholder, mapping positions matched the input, replacing placeholders restored the original text, empty input succeeded and shutdown unloaded the model. This is a functional check, not a model-quality evaluation. It was not repeated as part of this documentation change.

Run against an existing installation:

```sh
bun run scripts/check-inference.ts /path/to/installed/data
```

The script reads the saved license from the system credential store, uses the selected installed model and cached verified engine, downloads no packages and closes the engine process afterwards. Input is fixed synthetic text. License verification can contact the license server.

## Interactive start and stop

Opening `velora` connects the interactive session to the existing velora service, if one is running. Otherwise the main menu shows **Start**. Opening the menu alone does not start the API. Start launches the independent service, which binds the configured local port and loads the selected model into one engine process. Keep that process ready for subsequent requests instead of loading the model for every request.

Once startup succeeds, the same action becomes **Stop**. Stop shuts down the service, including its API, engine and menubar helper, while keeping the interactive menu open. The action returns to **Start** after shutdown completes. Ctrl+C closes only the interactive session. It does not stop an already running service or cancel its active request. Closing the terminal also leaves the independent service running.

The interactive CLI controls the same service used by headless startup. It must not own the service lifetime or create another engine when attaching. The implementation will be built in small steps: service ownership and local control, API startup and shutdown, interactive controls, menubar controls, then operating-system autostart.

## Stop during an active request

Stop stops accepting new anonymization work and lets the active request finish. After its response completes, shut down the listener and engine and return the menu action to **Start**. Show a stopping state while waiting; do not claim that shutdown has completed early.

Ctrl+C only disconnects and closes the interactive CLI; processing continues in the service. If graceful Stop exceeds its waiting deadline, offer an explicit forced Stop. Never automatically cancel the active request merely because the Stop deadline passed. The control command waits up to 60 seconds for its acknowledgement and never automatically force-stops a request. If it times out, the service may still be draining; inspect status. A forced Stop action is not implemented yet.

## Menubar: Open velora

The macOS menubar menu includes **Open velora**.

- If an interactive velora session exists, bring its terminal tab or window to the foreground. Do not launch another session.
- If no interactive session exists, open velora interactively in the user's configured terminal. Use Ghostty when that is the configured terminal; do not always force Apple Terminal.
- When an interactive session opens, check whether the velora API service is already running. Connect to the existing velora instance rather than starting a second API listener or engine. An occupied port alone is not proof that velora owns it.
- Concurrent starts must be coordinated, including simultaneous clicks on **Open velora**. Validate session ownership and process liveness rather than trusting a stale PID file.

The service owns the menubar helper. Its menu offers **Open velora** and **Stop**, so users can reopen the interactive CLI or stop the headless service. Explicit Stop drains the active request, then closes the API, engine and menubar helper. Restarting after service shutdown is available through the interactive CLI or a headless terminal command.

The current helper still has only an icon, no menu actions, and closes with the CLI. Moving its ownership to the service is planned work, not existing behavior.

Terminal selection and exact tab activation need a small macOS compatibility check. Do not assume macOS provides a universal default-terminal preference or that activating a terminal application selects the correct tab. Resolve the user's configured launch handler and support explicit terminal selection only if discovery is unavailable. That fallback is a proposal, not an approved additional setting.

## Headless startup and autostart

The service runs independently of a terminal. A headless start command must return only after service startup succeeds or report a startup failure. Users can then close the terminal without stopping the service. Running the command when velora is already running must not start another instance.

The first service-core implementation provides:

```sh
velora serve start --headless
velora serve status
velora serve stop
```

Start now opens the verified cached engine and loads the selected installed model once using the saved license. The service retains that session until Stop, reports starting or failed states and confirms model ID and engine version before reporting ready. It does not download packages. Its local API binds before model loading; port conflicts fail without loading an engine. Model-load failure releases the HTTP port. Ready reports the actual bound port. Stop closes the listener to new connections, waits for active processing and response completion, then closes the engine. Private status stays reachable and reports stopping during that wait. Start/Stop in the interactive menu, service-owned menubar and autostart are still planned.

Optional autostart launches the same service headlessly at the appropriate operating-system startup event. It requires explicit user consent and a saved preference. Autostart must use the saved port and selected model, respect existing-instance detection and leave the interactive terminal closed. Registration alone does not prove that the service started; verify its actual state.

Autostart is not implemented. For the macOS menubar, a user-login service is the proposed first approach; system boot before login has different UI and credential availability. Choose that boundary explicitly before registration. Manual Stop leaves autostart enabled for the next login. It must not immediately restart the service in the current session.

## Agreed lifecycle behavior

- Model changes wait for the active anonymization request to finish before switching models. Requests must not race with model loading.
- Changing the port saves the setting and offers a service restart. Saving alone must not silently restart the running service.
- A crashed service reports a failure and requires a manual restart. Do not create an automatic restart loop.
- Manual Stop keeps autostart enabled for the next login.
- If Stop takes too long, offer a forced Stop that requires an explicit user action. Do not automatically abandon the active request.
- Interactive CLI and menubar controls use the same local service-control implementation. Do not introduce a second public TCP port for management.

These are agreed requirements, not implemented behavior.

## Failures during a request

If the engine crashes during anonymization, return HTTP `503` with the agreed error shape when the client is still connected. Do not expose raw engine exceptions or return an incomplete result. Report the engine failure through service status so the interactive CLI does not continue to show it as ready. Recovery requires a manual restart.

If the HTTP client disconnects, discard its result. Do not interrupt the shared engine process solely because that client disconnected. Keep the engine busy until processing actually finishes or fails; another request must not begin while that work is still running. An explicit service Stop still waits for that work, even though its client has disconnected.

## Remaining decisions and implementation checks

1. Revisit the first implementation defaults of a 60-second control wait, a 30-second engine request deadline and Retry-After of 1 second when adding interactive lifecycle controls. Add an explicit forced Stop action.
2. Define visible starting, ready, busy, stopping and failed states, including startup failure feedback. Decide pause behavior separately.
3. Define recovery if loading another model fails and how selected-model persistence relates to the model actually loaded by the service.
4. Define when license validity is checked during a long-running session, including offline behavior. Use the engine's entitlement rules rather than inventing a separate policy in the API.
5. Design local service control and interactive-session discovery. Verify configured terminal discovery and exact tab activation on macOS.
6. Choose the autostart event and coordinate service lifetime with executable updates.

Unicode code-point offsets, blocked browser access, strict validation and the error list above are the defaults of the first HTTP implementation. These choices can be revised before wider use. Operating-system service registration and optional autostart follow after independent service control and the local API work and their behavior has been tested.
