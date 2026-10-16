# Set up velora

[Overview](../README.md) · [Usage](usage.md) · [Updates](updates.md)

## First launch

Run `velora` to open the menu. First setup begins with an application API key, automatic update choices and start at login, followed by a short interactive guide covering the macOS menu bar and terminal controls. License setup and model installation come last. Finished introductory steps are saved in `setup.json`, so closing an unfinished setup does not repeat them. `velora setup` reviews these choices without deleting existing keys or preferences. Keys use the same creation popup as the main menu: the new key is shown immediately and copied when the clipboard is available.

## License and model installation

License setup offers **Use a license**, **Get license**, then **Use a public model**. Purchases are not available yet; Get license shows that message, and Esc returns to the selection. When the purchase link is available, this option will open it in your browser.

Run `velora setup` in an interactive terminal to choose license access or a public model. The last character typed at the end of the license key is visible for 600 ms before it is masked. On first use, the key authorizes a verified standalone engine download. The engine then checks your licensed models through the server. The result shows expiry, device capacity, and entitled models. Verified license keys are saved in the system credential store. Setup can reuse the saved license or replace it after another successful check. The access check does not activate a device.

Failed checks offer Try again; press Esc to return. Enter opens a model. Use the left/right arrows to read its details, then select Install model with Enter. Esc returns to the model list. Installed models are excluded from the installation list.

After confirmation, the engine downloads and verifies the model and obtains the installation receipt. Model downloads can register this device with the license. The engine must advertise the `install_model` capability; velora does not fall back to the retired combined installation operation. Download progress appears above the status messages. Verification and confirmation use an animated status. Ctrl+C stops the engine process; partially installed files and engine locks may remain and need inspection before retrying. Pause and resume are not supported by the engine protocol. Only confirmed installations appear in the model menu. Existing installations are not replaced. Public Veyra1 installation is not available yet.

Press F1 for documentation for the current step or selected model. Model and license links use the published documentation; see [ARCHITECTURE.md](../ARCHITECTURE.md#contextual-documentation).

On later launches, velora checks the saved license before opening the menu. Expired, revoked or missing keys offer Change license and Check again. If verification is unavailable, you can still open the menu to manage settings; this does not grant model access.

## Saved license

`velora license set` asks for a key in the masked terminal input, verifies it without registering a device, then saves it in the system credential store. The first check may download the engine. An invalid key or failed verification does not replace the saved license. `velora license status` checks validity and device capacity without displaying the key or registering a device. Changing a license does not release the old license's device slot.

Storage uses Bun's native secrets API: Keychain on macOS, Credential Manager on Windows, and a running Secret Service on Linux. There is no plaintext fallback. macOS may request permission to access the Keychain, particularly when moving between development and compiled executables.

## Shared engine and supported platforms

The CLI and its models are distributed separately. The shared engine downloads licensed model data from the Themistic license server. Users do not need Python or pip. The planned public Veyra1 model will offer a path without a license key.

velora uses one engine for all installed models. Installing or switching a model does not install another engine. If a model needs a newer engine, update it in Settings, then try again.

The current integration follows the [License API guide](https://docs.themistic.com/velora/license-api/). Initial program downloads use `/license/engine` without a device ID. The engine owns the existing device identity and model installation; velora does not generate a second identity. Signatures, archive inventory, paths, checksums and executable permissions are checked before starting downloaded code.

Engine packages currently target Apple Silicon on macOS 14+, Windows x64, and Linux x64/ARM64 with glibc 2.38+. A platform supported by the CLI build is not necessarily supported by the engine. Model availability comes from your license, not a hard-coded model list.

Older installations may still contain an unused second engine directory. It is left in place until a separate cleanup is reviewed. See [ARCHITECTURE.md](../ARCHITECTURE.md) for storage and protocol details.
