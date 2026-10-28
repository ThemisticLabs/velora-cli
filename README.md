# velora

Local anonymization for the tools you already use.

velora is a command-line tool from Themistic that gives your applications a local API for anonymizing text. Send a piece of text over HTTP and receive a version with recognized sensitive values replaced by placeholders. When needed, request a mapping of those placeholders to the original values and their positions in the input.

Use it from a script, an internal tool, or your application's text-processing step before deciding what to store or send elsewhere. The selected model runs on your device. License checks and model downloads can contact the Themistic server; text sent for anonymization is processed locally.

velora handles setup, model installation and the service lifecycle. The shared Themistic Engine handles model execution, with model families such as Skira and Veyra supplied as separate packages. Which models you can install comes from your license.

**Development preview.** See [development status](#development-status) for implemented features and remaining release checks.

<img width="1179" height="761" alt="velora CLI development screenshot" src="https://github.com/user-attachments/assets/23185312-759a-44a4-94c8-f10075d08203" />

## What it provides

- **Guided setup.** Create an application API key, choose update permissions, verify a license and download a model from one terminal flow.
- **Direct anonymization.** Try a line of text in the menu, process a UTF-8 file or pipe text through `velora anonymize`.
- **A local HTTP API.** Send JSON to `POST /anonymize`. Each application uses its own API key, and responses can include the original-value mapping when requested.
- **An independent service.** Load a model once and keep it ready for requests. Closing the terminal or the interactive menu leaves the service running.
- **Model management.** List, install and select models through commands, or use Settings to switch and delete installed models. One shared engine serves your installed models.
- **macOS controls.** Start and stop the service from the menu bar, reopen the interactive CLI, or enable start at login explicitly.

## Get started

You need a license that includes a downloadable model. License purchases through the CLI and public model installation are not available yet.

The engine supports Apple Silicon on macOS 14+, Windows x64, and Linux x64/ARM64 with glibc 2.38+. The CLI also has a macOS Intel build, but the engine does not currently support that target. Check the [setup guide](docs/setup.md) for model and credential-store requirements.

For a source checkout, install Git and Bun 1.3.14 or newer, then link and launch velora:

```sh
git clone https://github.com/ThemisticLabs/velora-cli.git
cd velora-cli
bun install --frozen-lockfile
bun link
velora
```

Run `bun link` without a package name inside the checkout. It makes the TypeScript entry point available as `velora` on Windows, macOS and Linux; source changes take effect on the next launch. This development command requires Bun. For standalone binaries, follow [release installation](RELEASE.md#download-names). Compiled builds include their runtime, so users do not need Bun, Node.js, Python or pip.

On first launch, setup offers application API key creation, update choices, optional macOS start at login and a short usage guide. License verification and model installation follow. The application API key is shown once and copied when the clipboard is available. Save it for the application that will call the API.

The license key authorizes model access and is saved in the system credential store. The application API key authenticates requests to your local service. These are separate keys with separate purposes.

After installation, select **Start** in the menu or run:

```sh
velora serve start --headless
```

Start reports ready after the selected model is loaded and shows the actual API address. The default is `http://127.0.0.1:8001`. If setup or startup fails, `velora doctor` checks storage, the saved license, engine and selected model and reports a next step for checks that need attention.

## Anonymize text from the terminal

With the service running, process a UTF-8 file or stdin:

```sh
velora anonymize input.txt > anonymized.txt
printf 'Hallo Anna Müller.' | velora anonymize
velora anonymize input.txt --mapping > result.json
```

The default output is the anonymized text, with no status messages on stdout. `--json` returns a JSON response; `--mapping` includes original values and occurrences and implies JSON output. These local commands authenticate through the private service record, so you do not need to copy an application API key into your shell.

For a quick interactive test, choose **Anonymize text** in the main menu. Start the service when offered, enter one line and inspect the result. You can show the mapping, copy the anonymized text or try another input. Use the command for files and multiline text. See [Usage](docs/usage.md#anonymize-text) for limits and cancellation.

## Call the API from your application

Set `VELORA_API_KEY` to the application API key shown during setup, then send a request from your local application or terminal:

```sh
curl http://127.0.0.1:8001/anonymize \
  -H "Authorization: Bearer $VELORA_API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"text":"Hallo Anna Müller.","include_mapping":true}'
```

For a model that recognizes the name as `PERSON`, a response looks like this:

```json
{
  "text": "Hallo [PERSON:1].",
  "mapping": {
    "[PERSON:1]": {
      "original": "Anna Müller",
      "type": "PERSON",
      "occurrences": [
        { "start": 6, "end": 17 }
      ]
    }
  }
}
```

Recognized entities and labels depend on the selected model. Omit `include_mapping` or set it to `false` to receive only `text`. Mapping contains the original values, so request it only when your application needs them.

The API binds to `127.0.0.1` and checks application keys on every request. Browser access is blocked. Request bodies are limited to 1.6 MiB, and one authorized request is processed at a time; concurrent work receives `429`. API keys control access and do not encrypt requests. See the [API contract](docs/local-api-draft.md) for Unicode positions, validation and error responses.

## Models and service controls

Use `velora` for the interactive menu or `velora settings` to open Settings directly. You can also manage models without entering the menu:

```sh
velora models list
velora models list --available
velora models install skira7alpha
velora serve stop
velora models select skira7alpha
velora serve start --headless
```

Replace `skira7alpha` with an identifier returned for your license by `list --available`. Local listing works without a license check; both listing forms support `--json`. Installation may register this device with the license and preserves the current model selection. Stop the service before selecting or deleting a model, then start it again to load your choice.

`velora serve status` reports the current service state. `velora serve stop` waits for active processing before unloading the model. Ctrl+C in the interactive CLI closes that session while the service continues running. On macOS, the menu bar controls the same service; its Quit action also stops the service and closes the interactive session.

## Development status

velora is actively developed and maintained by Themistic. Guided setup, verified engine and model installation, application API keys, the local API, service controls and signed CLI update installation are implemented. Automatic updates require explicit consent; automatic engine installation is not connected yet.

This is a development version. Native platform acceptance and package-manager distribution remain in progress. Windows/Linux autostart, pause/resume and public Veyra1 installation are not implemented. The [release guide](RELEASE.md#release-acceptance) records the checks needed before production approval.

## Further reading

- [Setup](docs/setup.md): first launch, licenses, model installation and supported platforms.
- [Usage](docs/usage.md): menus, API keys, model commands, service controls, macOS integration and Doctor.
- [Updates](docs/updates.md): separate permissions and update behavior for velora and the shared engine.

For development, start with [Contributing](CONTRIBUTING.md), [Architecture](ARCHITECTURE.md) and [Coding style](CODINGSTYLE.md). [Releasing velora](RELEASE.md) covers builds, signing, installation and rollback.
