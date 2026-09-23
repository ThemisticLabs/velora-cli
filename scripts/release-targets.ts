export var RELEASE_TARGETS = [
    { platform: 'darwin', arch: 'arm64', runner: 'macos-15', target: 'bun-darwin-arm64', asset: 'velora-darwin-arm64' },
    { platform: 'darwin', arch: 'x64', runner: 'macos-15-intel', target: 'bun-darwin-x64', asset: 'velora-darwin-x64' },
    { platform: 'linux', arch: 'arm64', runner: 'ubuntu-24.04-arm', target: 'bun-linux-arm64', asset: 'velora-linux-arm64' },
    { platform: 'linux', arch: 'x64', runner: 'ubuntu-24.04', target: 'bun-linux-x64-baseline', asset: 'velora-linux-x64' },
    { platform: 'win32', arch: 'x64', runner: 'windows-2025', target: 'bun-windows-x64-baseline', asset: 'velora-windows-x64.exe' }
];
