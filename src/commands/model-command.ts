import { join } from 'node:path';
import installedModels from '../models/installed-models.js';
import type { LicenseModel } from '../license/license-access.js';
import manageLicense from '../license/manage-license.js';
import downloadModel from '../downloads/download-model.js';
import downloadFailure from '../downloads/download-failure.js';
import dataDirectory from '../system/data-directory.js';

type ModelRequest = { operation: 'list'; available?: boolean; json?: boolean } |
    { operation: 'install' | 'select'; id: string };

export default async function modelCommand(request: ModelRequest, directory = dataDirectory(),
    services = { models: installedModels, license: manageLicense, download: downloadModel }): Promise<void> {
    if (request.operation !== 'list' && (!/^[a-z0-9_-]{2,64}$/.test(request.id) || request.id === 'engine')) {
        process.stderr.write('Invalid model identifier. Use an identifier from velora models list --available.\n');
        process.exitCode = 1;
        return;
    }
    var controller = new AbortController();
    var cancelExitCode = 130;
    var cancel = function () {
        controller.abort();
    };
    var terminate = function () {
        cancelExitCode = 143;
        controller.abort();
    };
    process.on('SIGINT', cancel);
    process.on('SIGTERM', terminate);
    try {
        var installed = await services.models({ operation: 'list' }, directory);
        controller.signal.throwIfAborted();
        if (request.operation === 'select') {
            await services.models({ operation: 'select', id: request.id }, directory);
            process.stdout.write('Selected model ' + request.id + '. Start the service to load it.\n');
            return;
        }
        if (request.operation === 'list' && !request.available) {
            if (request.json) {
                process.stdout.write(JSON.stringify(installed, null, 2) + '\n');
                return;
            }
            if (installed.length === 0) {
                process.stdout.write('No models installed. Run velora models list --available to find models for your license.\n');
                return;
            }
            for (var model of installed) {
                var line = model.id + ' · ' + model.name + ' · Version ' + model.version;
                if (model.selected) {
                    line += ' · Selected';
                }
                process.stdout.write(line + '\n');
            }
            return;
        }
        if (request.operation === 'install') {
            for (var model of installed) {
                if (model.id === request.id) {
                    process.stdout.write('Model ' + request.id + ' is already installed.\n');
                    return;
                }
            }
        }
        controller.signal.throwIfAborted();
        process.stderr.write('Preparing the engine and checking license access.\n');
        var access = await services.license({ operation: 'status' }, controller.signal);
        controller.signal.throwIfAborted();
        if (!access.ok) {
            process.stderr.write(access.message + '\n');
            process.exitCode = 1;
            return;
        }
        if (request.operation === 'list') {
            installed = await services.models({ operation: 'list' }, directory);
            controller.signal.throwIfAborted();
            var available = [];
            for (var licensedModel of access.models) {
                var isInstalled = false;
                var selected = false;
                for (var local of installed) {
                    if (local.id === licensedModel.id) {
                        isInstalled = true;
                        selected = local.selected;
                        break;
                    }
                }
                available.push({ id: licensedModel.id, name: licensedModel.name, canDownload: licensedModel.canDownload,
                    downloadReason: licensedModel.downloadReason, installed: isInstalled, selected });
            }
            if (request.json) {
                process.stdout.write(JSON.stringify(available, null, 2) + '\n');
                return;
            }
            if (available.length === 0) {
                process.stdout.write('No models included in this license.\n');
                return;
            }
            for (var availableModel of available) {
                var status = 'Unavailable for download';
                if (availableModel.canDownload) {
                    status = 'Available for download';
                }
                if (availableModel.installed) {
                    status = 'Installed';
                }
                if (availableModel.selected) {
                    status += ' · Selected';
                }
                process.stdout.write(availableModel.id + ' · ' + availableModel.name + ' · ' + status + '\n');
            }
            return;
        }
        var requestedModel: LicenseModel | undefined;
        for (var licensedModel of access.models) {
            if (licensedModel.id === request.id) {
                requestedModel = licensedModel;
                break;
            }
        }
        if (!requestedModel) {
            process.stderr.write('This model is not included in your license. Run velora models list --available.\n');
            process.exitCode = 1;
            return;
        }
        if (!requestedModel.canDownload) {
            process.stderr.write('This model is not available for download. Check model access in the Themistic console.\n');
            process.exitCode = 1;
            return;
        }
        process.stderr.write('Installing ' + requestedModel.id + '. This may register this device with your license.\n');
        var lastPercent = -10;
        var result = await services.download({ license: access.license, modelId: requestedModel.id, modelName: requestedModel.name,
            root: join(directory, 'models', requestedModel.id), signal: controller.signal,
            onProgress: function (progress) {
                if (progress.total <= 0) {
                    return;
                }
                var percent = Math.floor(progress.downloaded / progress.total * 100);
                if (percent < lastPercent || percent >= lastPercent + 10 || (percent === 100 && lastPercent !== 100)) {
                    process.stderr.write('Download: ' + percent + '%\n');
                    lastPercent = percent;
                }
            }
        });
        process.stdout.write('Installed model ' + requestedModel.id + '. Use velora models select ' + requestedModel.id + ' to select it.\n');
        if (result.cleanupRequired) {
            process.stderr.write('Installed, but cleanup failed. Inspect model storage and locks before another model operation.\n');
            process.exitCode = 1;
        }
        if (controller.signal.aborted) {
            process.stderr.write('Model installed before cancellation completed.\n');
            process.exitCode = cancelExitCode;
        }
    } catch (error) {
        if (controller.signal.aborted) {
            process.stderr.write('Model operation cancelled. Inspect partial downloads and locks before retrying.\n');
            process.exitCode = cancelExitCode;
            return;
        }
        var message = downloadFailure(error, 'Could not manage models. Check storage, license access and your connection, then retry.');
        if (error instanceof Error && error.name === 'ModelStorageError') {
            message = error.message;
        }
        if (error instanceof Error && 'code' in error && error.code === 'EEXIST') {
            message = 'Another model operation is running. Wait for it to finish before retrying.';
        }
        process.stderr.write(message + '\n');
        process.exitCode = 1;
    } finally {
        process.removeListener('SIGINT', cancel);
        process.removeListener('SIGTERM', terminate);
    }
}
