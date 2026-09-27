import DownloadError from './download-error.js';

export type PackageRelease = {
    model_id: string;
    revision: string;
    version: string;
    engine_version: string;
    artifact_kind: 'engine';
    engine_api: number;
    distribution: 'standalone-v1';
    runtime_target: string;
    sequence: number;
    enabled: boolean;
    files: Record<string, { size: number; sha256: string }>;
};

export default function packageRelease(value: unknown, target: string): PackageRelease {
    if (!isRecord(value) || value.model_id !== 'themistic-engine' || value.artifact_kind !== 'engine' ||
        value.engine_api !== 1 || value.distribution !== 'standalone-v1' || value.enabled !== true ||
        typeof value.revision !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(value.revision) ||
        value.revision.endsWith('.') || /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(value.revision) ||
        typeof value.version !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value.version) ||
        value.engine_version !== value.version || !Number.isSafeInteger(value.sequence) || Number(value.sequence) < 1 ||
        !isRecord(value.files)) {
        throw new DownloadError('The server returned an invalid standalone engine package.');
    }
    var system = '';
    if (target === 'win-amd64' && value.runtime_target === 'standalone-windows-x64') {
        system = 'windows';
    }
    var mac = /^macosx-(\d+)\.(\d+)-arm64$/.exec(target);
    if (mac && Number(mac[1]) >= 14 && value.runtime_target === 'standalone-macos-arm64-14.0') {
        system = 'macos';
    }
    var linux = /^linux-(x86_64|aarch64)-glibc(\d+)\.(\d+)$/.exec(target);
    if (linux && (Number(linux[2]) > 2 || Number(linux[2]) === 2 && Number(linux[3]) >= 38) &&
        value.runtime_target === 'standalone-linux-glibc2.38') {
        system = 'linux';
    }
    if (!system) {
        throw new DownloadError('The engine package does not match this operating system.');
    }
    var limits: Record<string, number> = {
        'manifest.json': 2 * 1024 ** 2, 'manifest.sig': 64, 'inventory.json': 8 * 1024 ** 2
    };
    limits['themistic-engine-' + value.version + '-' + system + '.zip'] = 4 * 1024 ** 3;
    if (Object.keys(value.files).length !== Object.keys(limits).length) {
        throw new DownloadError('The engine package contains missing or unexpected files.');
    }
    for (var [name, limit] of Object.entries(limits)) {
        var file = value.files[name];
        if (!isRecord(file) || typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > limit ||
            typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256)) {
            throw new DownloadError('The engine package contains an invalid file.');
        }
    }
    if ((value.files['manifest.sig'] as { size: number }).size !== 64) {
        throw new DownloadError('The engine signature has an invalid size.');
    }
    return value as PackageRelease;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
