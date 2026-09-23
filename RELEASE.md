# Releasing velora

The release workflow builds standalone executables for macOS arm64 and x64, Linux arm64 and x64, and Windows x64. Users do not need Bun or Node.js. Homebrew, winget, npm publishing, services and uninstallers are separate work.

## Before publishing

1. Update `version` in `package.json`. Use a stable version such as `0.1.0` or a prerelease such as `0.1.0-rc.1`.
2. Run `bun install --frozen-lockfile`, `bun run check`, `bun run test` and `bun run release:build`.
3. Review and commit the intended changes. Push only when the release is approved.
4. Create and push the matching tag, for example `v0.1.0`. Pushing a `v*` tag starts the publishing workflow.

A mismatched tag fails before builds begin. Branch pushes, pull requests and manual runs of Build and test produce CI artifacts without creating a GitHub release. Windows ARM64 and Linux musl are not release targets.

## Build and publication

`.github/workflows/build.yml` reads the matrix from `scripts/release-targets.ts`. Each native runner installs Bun 1.3.14, installs the frozen lockfile, typechecks and builds its release executable once. The test suite exercises that exact binary through `VELORA_TEST_BINARY`. The release binary is also run with `--version` and `--help` through pipes, so smoke checks cannot prompt or contact the update server. PTY tests are explicitly skipped on Windows.

`.github/workflows/release.yml` calls that workflow for the tag. Only when every matrix job succeeds does the publish job download all five binaries. `scripts/release-manifest.ts` refuses missing, empty, linked or unexpected assets and produces:

- `release.json`: schema version, package version, platform, architecture, byte size and SHA-256 for each executable.
- `SHA256SUMS`: the same hashes in the standard checksum-file format.

Metadata is written to temporary files and renamed into place. Existing output symlinks are replaced without writing to their targets.

The workflow creates a draft release, uploads all assets, then publishes it. Prerelease tags remain prereleases and do not become the latest stable version. Stable releases are marked latest. The built-in `GITHUB_TOKEN` gets write access only in the publishing job; build jobs have read access. Actions are pinned to commit hashes. No personal token or model license is required.

An existing release is not overwritten. If an upload fails, inspect the remaining draft and remove that incomplete draft before rerunning the failed publish job. Do not replace assets on an already published release; create a new version. CI artifacts expire after seven days, so rerun the complete workflow if they are no longer available.

## Download names

| Platform | Executable |
| --- | --- |
| macOS Apple Silicon | `velora-darwin-arm64` |
| macOS Intel | `velora-darwin-x64` |
| Linux ARM64, glibc | `velora-linux-arm64` |
| Linux x64, glibc | `velora-linux-x64` |
| Windows x64 | `velora-windows-x64.exe` |

Download the executable for your platform and verify its hash against `SHA256SUMS`. On macOS and Linux, rename it to `velora` and give it execute permission with `chmod +x velora`. On Windows, rename it to `velora.exe`. Place it in a directory on PATH.

These are raw executables. The pipeline does not install anything on a user's machine. It does not provide Apple Developer ID signing, notarization or Windows Authenticode signing; OS download warnings may apply. A successful native smoke check is not an end-to-end verification of credential stores, licensed model execution or service integration.

## Updates

The CLI checks GitHub's latest stable release only after user consent. The stable asset names and manifest provide the delivery format for automatic installation. The installer is not connected yet; this pipeline alone does not replace the running CLI. GitHub also exposes SHA-256 digests for uploaded release assets.

For release integrity beyond checksums, enable immutable releases in the repository settings before publication. This is a repository setting, not something the workflow enables. The draft-first upload sequence supports it.

References: [Bun standalone executables](https://bun.sh/docs/bundler/executables), [GitHub hosted runners](https://docs.github.com/en/actions/reference/runners/github-hosted-runners), [GitHub release assets](https://docs.github.com/en/rest/releases/assets), [immutable releases](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases).
