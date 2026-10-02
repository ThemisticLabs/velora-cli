import { join } from 'node:path';
import type { DoctorCheck } from './doctor.js';
import licenseStore from '../license/license-store.js';
import licenseAccess from '../license/license-access.js';
import engineSession from '../engine/engine-session.js';
import bootstrapEngine from '../engine/bootstrap-engine.js';
import installedModels from '../models/installed-models.js';
import downloadFailure from '../downloads/download-failure.js';

export default async function doctorEngine(directory: string, signal: AbortSignal,
    checks: { engine: DoctorCheck; license: DoctorCheck; model: DoctorCheck; inference: DoctorCheck },
    publish: () => void, services = {
        store: licenseStore, checkLicense: licenseAccess, connect: engineSession, models: installedModels
    }): Promise<void> {
    var { engine, license, model, inference } = checks;
    engine.status = 'Checking';
    publish();
    var key = '';
    var session: Awaited<ReturnType<typeof engineSession>> | undefined;
    try {
        try {
            key = await services.store({ operation: 'read' }) || '';
        } catch {
            license.status = 'Error';
            license.detail = 'Could not read the saved license. Unlock the credential store and try again.';
        }
        signal.throwIfAborted();
        try {
            session = await services.connect(key, signal, undefined, function (savedKey, savedSignal, progress) {
                return bootstrapEngine(savedKey, savedSignal, progress, { directory, installedOnly: true });
            });
            engine.status = 'OK';
            engine.detail = 'Version ' + session.installation.release.version + ' · Local protocol verified';
        } catch (error) {
            signal.throwIfAborted();
            engine.status = 'Error';
            engine.detail = downloadFailure(error, 'Could not start the engine. Check its installation and run doctor again.');
        }
        if (license.status !== 'Error') {
            license.status = 'Warning';
            license.detail = 'No license saved. Add one in Settings.';
            if (key) {
                license.detail = 'Not checked because the engine is unavailable.';
                if (session) {
                    license.status = 'Checking';
                    license.detail = 'Verifying the saved license.';
                    publish();
                    var activeSession = session;
                    var result = await services.checkLicense(key, signal, async function () {
                        return { ...activeSession, close: async function () {} };
                    });
                    signal.throwIfAborted();
                    license.status = 'Error';
                    license.detail = result.message || 'Could not verify the saved license. Try again.';
                    if (result.ok) {
                        license.status = 'OK';
                        license.detail = 'Valid · Expires ' + result.expiresAt.slice(0, 10) + ' · Devices ' + result.registeredDevices + '/' + result.maxDevices;
                    }
                }
            }
        }
        model.status = 'Checking';
        model.detail = 'Reading the selected model.';
        publish();
        try {
            var models = await services.models({ operation: 'list' }, directory);
            var selected: (typeof models)[number] | undefined;
            for (var entry of models) {
                if (entry.selected) { selected = entry; break; }
            }
            model.status = 'Warning';
            model.detail = 'No model selected. Choose one in Settings / Manage models.';
            if (selected) {
                model.detail = selected.id + ' · Not loaded because engine or license verification failed.';
                if (session && license.status === 'OK') {
                    model.status = 'Checking';
                    model.detail = selected.id + ' · Verifying and loading the model.';
                    publish();
                    var loaded = await session.request('load', {
                        model: join(directory, 'models', selected.id, 'installed', selected.id, selected.revision),
                        options: { license_key: key }
                    });
                    if (loaded.model_id !== selected.id || loaded.model_version !== selected.version ||
                        loaded.engine_version !== session.installation.release.version) {
                        throw new Error('Model version mismatch');
                    }
                    model.status = 'OK';
                    model.detail = selected.id + ' · Version ' + selected.version + ' · Package verified and loaded';
                }
            }
        } catch (error) {
            signal.throwIfAborted();
            model.status = 'Error';
            model.detail = downloadFailure(error, 'Could not verify or load the selected model. Check model storage and license access.');
        }
        inference.status = 'Warning';
        inference.detail = 'Not tested because the selected model could not be loaded.';
        if (session && model.status === 'OK') {
            inference.status = 'Checking';
            inference.detail = 'Running a short synthetic request.';
            publish();
            try {
                var prediction = await session.request('predict', { text: 'Anna Müller lives in Berlin.' });
                if (typeof prediction.placeholder_text !== 'string' || !prediction.placeholder_text ||
                    typeof prediction.mapping !== 'object' || prediction.mapping === null || Array.isArray(prediction.mapping)) {
                    throw new Error('Invalid inference response');
                }
                inference.status = 'OK';
                inference.detail = 'Local inference returned text and mapping.';
            } catch (error) {
                signal.throwIfAborted();
                inference.status = 'Error';
                inference.detail = downloadFailure(error, 'Local inference failed. Check the engine and model, then run doctor again.');
            }
        }
    } finally {
        await session?.close();
    }
}
