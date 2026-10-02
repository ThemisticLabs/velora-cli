# Local API discussion

Draft for review. No HTTP server or API-key management is implemented by this document. Authentication and JSON field names still need Manu's decision. Manu selected optional mapping with original text, type and occurrence positions.

## Verified engine behavior

Engine 0.4.4 and the isolated skira7alpha3 installation processed synthetic text successfully. Repeated occurrences of Anna Müller used the same placeholder. Mapping offsets matched the input, restoring placeholders reproduced the original text, empty input succeeded, and shutdown unloaded the model. This is a functional check, not a model-quality evaluation.

Run the check against an existing installation:

```sh
bun run scripts/check-inference.ts /path/to/installed/data
```

The script reads the saved license from the system credential store. It uses the selected model and verified cached engine, downloads no packages, and closes the engine process after the check. Its input is fixed synthetic text. License verification can contact the license server; anonymization runs locally.

## Local access

The listener must bind explicitly to `127.0.0.1`. An IPv6 listener, if needed, must bind to `::1`. Never bind to `0.0.0.0` or `::`. There is no remote-access setting.

Recommendation for discussion: give each application its own local API key, sent in `Authorization: Bearer <key>`. Keys can be named and revoked individually, without changing access for other applications. Loopback binding limits network reachability, but other programs on the device can still make requests. Key creation, storage, revocation and browser access rules need a separate decision.

## Request proposal

The route name is open for discussion. Example: `POST /anonymize`.

```json
{
  "text": "Anna Müller wohnt in Berlin.",
  "include_mapping": false
}
```

Proposed default: omit mapping unless requested. Use the selected model for the first implementation. Whether a request may choose a different installed model remains open.

## Response proposal

Without mapping:

```json
{
  "text": "[PERSON:1] wohnt in [LOCATION:2]."
}
```

With `include_mapping: true`, one possible format is:

```json
{
  "text": "[PERSON:1] wohnt in [LOCATION:2].",
  "mapping": {
    "[PERSON:1]": {
      "text": "Anna Müller",
      "type": "PERSON",
      "occurrences": [{ "start": 0, "end": 11 }]
    },
    "[LOCATION:2]": {
      "text": "Berlin",
      "type": "LOCATION",
      "occurrences": [{ "start": 21, "end": 27 }]
    }
  }
}
```

This is a proposed HTTP shape, not the raw engine result. The engine currently returns `placeholder_text` and numeric string mapping keys. Exposing or adapting that format is still a decision. The offset unit must be defined before the HTTP contract is implemented; non-ASCII cases, including emoji, need verification across the engine and JavaScript clients.

Manu selected mapping with original text, type and occurrence positions. The exact JSON keys and offset unit remain to be agreed. Mapping contains original sensitive text and should only be returned when explicitly requested.

## Remaining decisions

- Route and request field names.
- API-key authentication and browser access policy.
- Response field names and mapping structure, including the agreed text, type and occurrence positions.
- Selected model only, or model choice per request.
- Empty input behavior and text-size limit.
- Error JSON and HTTP statuses for invalid input, invalid API key, unavailable model, license failure and a busy engine.
- Queueing, cancellation and model switching while a request runs.

The API implementation follows these decisions. Background service and startup registration come afterwards.
