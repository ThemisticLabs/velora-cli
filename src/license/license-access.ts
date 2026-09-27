import engineSession from '../engine/engine-session.js';
import type { EngineProgress } from '../engine/bootstrap-engine.js';
import DownloadError from '../downloads/download-error.js';

export type LicenseModel = {
    id: string;
    name: string;
    description: string;
    strengths: string;
    limitations: string;
    downloadReason: string | null;
    canDownload: boolean;
};

export default async function licenseAccess(license: string, signal: AbortSignal, connect = engineSession, onProgress?: (progress: EngineProgress) => void) {
    if (!/^[A-Z0-9-]{8,64}$/.test(license)) {
        return { ok: false as const, message: 'Check the license key and try again.' };
    }
    var session: Awaited<ReturnType<typeof engineSession>> | undefined;
    var MAX_MODEL_TEXT_LENGTH = 2000;
    try {
        session = await connect(license, signal, onProgress);
        var access = await session.request('models', { license_key: license });
        if (access.status !== 'ok') {
            return { ok: false as const, message: 'The engine returned incomplete license details.' };
        }
        var expiresAt = access.expires_at;
        var maxDevices = access.max_devices;
        var registeredDevices = access.registered_devices;
        if (typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))) {
            return { ok: false as const, message: 'The server returned an invalid license expiry.' };
        }
        if (typeof maxDevices !== 'number' || !Number.isSafeInteger(maxDevices) || maxDevices < 1) {
            return { ok: false as const, message: 'The server returned an invalid device limit.' };
        }
        if (typeof registeredDevices !== 'number' || !Number.isSafeInteger(registeredDevices) || registeredDevices < 0) {
            return { ok: false as const, message: 'The server returned an invalid device count.' };
        }
        if (!Array.isArray(access.models)) {
            return { ok: false as const, message: 'The server returned an invalid model list.' };
        }
        var models: LicenseModel[] = [];
        var receivedModels: unknown[] = access.models;
        for (var model of receivedModels) {
            if (!isRecord(model) || typeof model.model_id !== 'string' || !/^[a-z0-9_-]{2,64}$/.test(model.model_id) || model.entitled !== true) {
                return { ok: false as const, message: 'The server returned invalid model details.' };
            }
            var metadata = {
                display_name: model.model_id,
                description: 'No description published yet.',
                strengths: 'Not documented yet.',
                limitations: 'Not documented yet.'
            };
            var textFields: (keyof typeof metadata)[] = ['display_name', 'description', 'strengths', 'limitations'];
            for (var field of textFields) {
                var text = model[field];
                if (text === undefined) {
                    continue;
                }
                if (typeof text !== 'string' || text.length > MAX_MODEL_TEXT_LENGTH || /[\x00-\x1f\x7f-\x9f]/.test(text)) {
                    return { ok: false as const, message: 'The server returned invalid model details.' };
                }
                if (text) {
                    metadata[field] = text;
                }
            }
            var licenseModel: LicenseModel = {
                id: model.model_id,
                name: metadata.display_name,
                description: metadata.description,
                strengths: metadata.strengths,
                limitations: metadata.limitations,
                canDownload: model.can_download === true,
                downloadReason: null
            };
            if (typeof model.download_reason === 'string' && /^[a-z_]{1,64}$/.test(model.download_reason)) {
                licenseModel.downloadReason = model.download_reason;
            }
            models.push(licenseModel);
        }
        return { ok: true as const, expiresAt, maxDevices, registeredDevices, models };
    } catch (error) {
        if (signal.aborted) {
            throw signal.reason;
        }
        if (error instanceof DownloadError) {
            return { ok: false as const, message: error.message };
        }
        return { ok: false as const, message: 'Could not read your models from the engine. Try again.' };
    } finally {
        await session?.close();
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
