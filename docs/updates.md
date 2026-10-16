# Update velora and the engine

[Overview](../README.md) · [Setup](setup.md) · [Usage](usage.md)

## Update permissions

Setup collects velora and shared engine update permissions before license setup and model installation. Choices are saved in `<data>/cli-updates.json` and `<data>/engine-updates.json`. Settings can change this independently of the selected model. Earlier per-model preferences are not treated as consent for the shared engine. Automatic engine installation remains unavailable; its saved permission is for future use. Automatic velora installation is implemented separately and requires explicit consent.

The introductory setup asks whether velora may check GitHub for new versions on startup and install signed releases automatically. Checks and installation start Off. The engine has its own rows. Save and continue confirms setup choices; Save changes applies them in Settings. Esc discards unsaved edits. Startup never asks these questions ahead of the setup.

The choices are saved in `cli-updates.json` in the platform data directory, separately from engine permissions. Only explicit consent enables the check on subsequent interactive launches, with a 1.5-second request timeout. Use Settings → Update permissions to change these choices, then select Save changes. Unreadable or invalid preferences disable checks.

## velora updates

A newer version appears in the header. Offline, unavailable, malformed and rate-limited responses do not block normal use beyond that timeout. Piped commands keep their existing output and do not check for updates. When opening the interactive menu with automatic installation enabled, a newer stable release is downloaded, signature-checked and tested before velora closes for installation. Explicit commands such as doctor, help and version continue normally. You can also confirm installation in Settings → Check for updates. The installer replaces only the standalone executable and retains a verified backup for rollback. Source runs are never replaced. Existing check permission is preserved; users who previously allowed checks are asked only for the missing installation choice.

## Engine updates

A verified cached engine is reused. Engine checks use `/license/engine` and show available versions in the header and Settings. Manual engine checks also work without an installed model. Startup check results are reused in Settings. Select the Engine row to confirm an available update and view download progress. Engine replacement keeps installed models. Automatic engine installation is not connected.

## Release installation and recovery

See [RELEASE.md](../RELEASE.md) for standalone downloads, signed release manifests, installation and rollback. Package-manager distribution remains separate work.
