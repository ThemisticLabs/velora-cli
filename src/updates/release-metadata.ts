import DownloadError from '../downloads/download-error.js';
import { verify } from 'node:crypto';
import { RELEASE_PUBLIC_KEY } from './release-public-key.js';

export default function releaseMetadata(bytes: Uint8Array, signature: Uint8Array, version: string, platform = process.platform, arch = process.arch, publicKey = RELEASE_PUBLIC_KEY): { name: string; size: number; sha256: string } {
    var MAX_MANIFEST_BYTES = 128 * 1024;
    var MAX_BINARY_BYTES = 256 * 1024 ** 2;
    if (bytes.length > MAX_MANIFEST_BYTES || signature.length !== 64 || !verify(null, bytes, publicKey, signature)) {
        throw new DownloadError('The update signature is invalid. Your current version was kept.');
    }
    var manifest: unknown = JSON.parse(Buffer.from(bytes).toString('utf8'));
    if (!manifest || typeof manifest !== 'object' || !('schemaVersion' in manifest) || manifest.schemaVersion !== 1 ||
        !('version' in manifest) || manifest.version !== version || !('assets' in manifest) || !Array.isArray(manifest.assets)) {
        throw new DownloadError('The update metadata does not match the requested release.');
    }
    var system: string = platform;
    if (system === 'win32') { system = 'windows'; }
    var name = 'velora-' + system + '-' + arch;
    if (platform === 'win32') { name += '.exe'; }
    var asset: { name: string; size: number; sha256: string } | undefined;
    for (var entry of manifest.assets) {
        if (!entry || typeof entry !== 'object' || entry.platform !== platform || entry.arch !== arch) { continue; }
        if (asset || entry.name !== name || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > MAX_BINARY_BYTES ||
            typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) {
            throw new DownloadError('The update contains an invalid platform asset.');
        }
        asset = { name: entry.name, size: entry.size, sha256: entry.sha256 };
    }
    if (!asset) { throw new DownloadError('No update is available for this platform.'); }
    return asset;
}
