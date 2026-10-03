# Local API plan

Agreed HTTP contract and remaining lifecycle decisions, 3 October 2026. The HTTP server, persistent inference service and operating-system autostart are not implemented. API-key management, saved port settings and an engine inference check are available.

## Local access

The API binds only to `127.0.0.1`. Its default address is `http://127.0.0.1:8001`. Settings can change the port, but cannot enable remote access. Never bind to `0.0.0.0` or `::`. IPv6 support is outside the first implementation.

Each application uses its own named API key:

```http
Authorization: Bearer velora_…
Content-Type: application/json
```

The main menu provides key creation and individual revocation. Keys have a name and optional note. A new key is shown immediately and copied to the clipboard. Only SHA-256 digests and metadata are persisted; plaintext keys cannot be retrieved later.

API keys authenticate requests and let users manage access separately for each application. They do not encrypt text, mappings or responses. Requests use HTTP over loopback, and anonymization happens locally. License checks can contact the license server; local processing does not mean that every operation is offline.

Browser access and Origin handling remain to be decided. Loopback binding alone does not prevent other programs on the device from making requests.

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

Mapping keys are the complete placeholders used in the response text. Each entry contains the original text, its type and all occurrences represented by that placeholder. Positions refer to the input text, start at zero and use an exclusive end. The offset unit for emoji and other non-BMP characters still needs to be agreed and verified against the engine.

The example shows the HTTP format, not a guaranteed prediction for every model. The engine returns `placeholder_text` and numeric string mapping keys; velora adapts those fields to the agreed HTTP format.

Mapping contains sensitive original values. It is returned only when requested and is not persisted by velora. Requests, original text, mappings and API keys must not appear in logs. Empty input behavior and unknown request fields remain to be decided.

## Request limits and concurrency

The entire UTF-8 JSON request body is limited to **1.6 MiB**. The implementation uses `floor(1.6 × 1024 × 1024)`, or **1,677,721 bytes**. This is a byte limit, not a token limit. There is no 32K-token limit.

Enforce the limit while reading the body, including requests without a reliable `Content-Length`. Reject larger bodies with HTTP `413`. Never silently truncate input.

The engine protocol currently accepts request lines up to 2 MiB. Before sending a request, check the actual serialized engine message, including its envelope and line terminator. JSON escaping can expand the message, so an HTTP body below 1.6 MiB does not by itself guarantee that the engine request fits. Reject an oversized engine message with `413` before sending it. Keep this protocol check separate from the HTTP body limit.

Process one anonymization request at a time. While the engine is busy, reject another processing request with `429` and `Retry-After`. Do not create an unbounded queue. The retry delay remains to be chosen. This concurrency rule is separate from the request-size limit.

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

Before implementation, finish the status and code list for malformed JSON, invalid fields, missing or revoked API keys, unavailable engine or model, license failure, unsupported content type, unknown routes and request timeout.

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

Ctrl+C only disconnects and closes the interactive CLI; processing continues in the service. A deadline for explicit service shutdown remains to be chosen so a stuck engine cannot prevent Stop indefinitely.

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

Provisional command spelling for review:

```sh
velora serve start --headless
```

The requirement is agreed; the exact command spelling is not final. Do not add multiple synonymous commands before choosing one.

Optional autostart launches the same service headlessly at the appropriate operating-system startup event. It requires explicit user consent and a saved preference. Autostart must use the saved port and selected model, respect existing-instance detection and leave the interactive terminal closed. Registration alone does not prove that the service started; verify its actual state.

Autostart is not implemented. For the macOS menubar, a user-login service is the proposed first approach; system boot before login has different UI and credential availability. Choose that boundary explicitly before registration. Explicit Stop must not be immediately undone by an automatic restart policy. Whether autostart stays enabled for the next login after a manual Stop still needs a decision.

## Next planning step: active requests and lifecycle changes

The following are proposals for discussion, not approved behavior:

1. Define the explicit Stop deadline and what happens when an HTTP client disconnects, the engine crashes or a request times out. Ctrl+C in the interactive CLI leaves the service and active requests running.
2. Define visible starting, ready, busy, stopping and failed states, including feedback when startup fails. Decide pause behavior separately.
3. Define model switching: finish or cancel active work, load the next model, and retain the previous selection if loading fails.
4. Define when license validity is checked during a long-running session, including offline behavior. Use the engine's entitlement rules rather than inventing a separate policy in the API.
5. Decide whether a saved port change restarts the API immediately or requires an explicit restart.
6. Design local service control and interactive-session discovery. The service owns the API, engine and menubar; the CLI attaches to it. Verify configured terminal discovery and exact tab activation on macOS.
7. Choose the final headless command and autostart event. Decide next-login behavior after manual Stop and crash-restart behavior.

Resolve the offset unit, browser access, validation details, error statuses, retry delay and timeout before implementing the endpoint. Operating-system service registration and optional autostart follow after independent service control and the local API work and their behavior has been tested.
