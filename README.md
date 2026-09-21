
# velora

Local anonymization for the tools you already use.

> **Actively developed and maintained by Themistic.** velora is in early development. This repository contains a working CLI foundation and an interactive setup preview, not a finished release. Model downloads and the local API are still being built.

velora is an open-source CLI from Themistic, being built to run model families such as Skira and Veyra on your device and make them available through a local API.
<img width="1179" height="761" alt="VeloraCli" src="https://github.com/user-attachments/assets/23185312-759a-44a4-94c8-f10075d08203" />
## A clear path from setup to your first result

Choose a model, follow its setup, and create an API key for your tools. velora is designed to guide you through model downloads and license activation, with commands to check, pause, and resume the local service. On macOS, a small menu bar control will keep its status close at hand.

The API will return anonymized text, with the original-value mapping included when requested.

## Development status

The TypeScript CLI currently provides help, version output, suggestions for misspelled commands, and an interactive setup preview. License access is checked with the Themistic server; the key is not saved. Model installation and the local API are not available yet, and there is no published release.

Development uses Bun. The build produces a standalone executable with its runtime included, so users do not need to install Bun or Node.js. Homebrew, WinGet, and direct release downloads are planned.

To run the development build, follow [CONTRIBUTING.md](CONTRIBUTING.md). Code conventions are documented in [CODINGSTYLE.md](CODINGSTYLE.md).

See [ARCHITECTURE.md](ARCHITECTURE.md) for the current implementation and its boundaries.

The CLI and its models are distributed separately. Licensed models will use the Themistic license server to download their engine packages. The planned public Veyra1 model will offer a path without a license key.

## Setup preview

Run `velora setup` in an interactive terminal to choose license access or a public model. The last character typed at the end of the license key is visible for 600 ms before it is masked. The key is sent to the Themistic license server for a signed access check. The result shows expiry, device capacity, and entitled models. The key is not saved and no device is activated. Failed checks offer Try again and Go back. Model downloads are not connected yet. Public Veyra1 installation is not available in this preview. Press Ctrl+C to cancel.

## Check your installation

Run `velora doctor`, or `bun run start doctor` from the source checkout. It reports your system, checks whether the global command is in PATH, tests storage access and contacts the license server without a license key.

Checks that need attention include a next step. A completed report exits normally, even when a check needs attention. Read the individual results; exit code 0 does not mean every check passed. These checks do not verify engine or model readiness.
