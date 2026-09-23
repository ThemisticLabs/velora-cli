import DownloadError from './download-error.js';
export type PackageRelease = {
    model_id: string;
    revision: string;
    version: string;
    engine_version?: string;
    sequence: number;
    enabled: boolean;
    files: Record<string, { size: number; sha256: string }>;
};

export default function packageRelease(value: unknown): PackageRelease {
    var MAX_FILE_BYTES = 16 * 1024 ** 3;
    var MAX_PACKAGE_BYTES = 32 * 1024 ** 3;
    var MAX_RELEASE_FILES = 130;
    if (!isRecord(value) || typeof value.model_id !== 'string' || !/^[a-z0-9_-]{2,64}$/.test(value.model_id) ||
        typeof value.revision !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(value.revision) ||
        value.revision.endsWith('.') || /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(value.revision) ||
        typeof value.sequence !== 'number' || !Number.isSafeInteger(value.sequence) || value.sequence < 1 ||
        typeof value.version !== 'string' || !value.version || value.version.length > 256 || /[\x00-\x1f\x7f-\x9f]/.test(value.version) ||
        typeof value.enabled !== 'boolean' || !isRecord(value.files)) {
        throw new DownloadError('The server returned an invalid package release.');
    }
    if (value.engine_version !== undefined && (typeof value.engine_version !== 'string' || value.engine_version.length > 32 ||
        !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value.engine_version))) {
        throw new DownloadError('The server returned an invalid engine version.');
    }
    var names = Object.keys(value.files);
    if (names.length < 3 || names.length > MAX_RELEASE_FILES) {
        throw new DownloadError('The package file count is invalid.');
    }
    var seen = new Set<string>();
    var total = 0;
    for (var name of names) {
        var file = value.files[name];
        if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,95}$/.test(name) || name.endsWith('.') ||
            /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(?:\.|$)/i.test(name) || seen.has(name.toLowerCase()) ||
            !isRecord(file) || typeof file.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(file.sha256) ||
            typeof file.size !== 'number' || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES) {
            throw new DownloadError('The package contains an invalid file.');
        }
        seen.add(name.toLowerCase());
        total += file.size;
    }
    if (total > MAX_PACKAGE_BYTES || !Object.hasOwn(value.files, 'manifest.json') || !Object.hasOwn(value.files, 'manifest.sig')) {
        throw new DownloadError('The package is incomplete or too large.');
    }
    return value as PackageRelease;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
