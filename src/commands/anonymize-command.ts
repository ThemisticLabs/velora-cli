import { createReadStream } from 'node:fs';
import type { Readable } from 'node:stream';
import anonymizeText from '../api/anonymize-text.js';
import { MAX_API_BODY_BYTES } from '../api/api-server.js';
import dataDirectory from '../system/data-directory.js';

type AnonymizeOptions = { file?: string; json?: boolean; mapping?: boolean };

export default async function anonymizeCommand(options: AnonymizeOptions, directory = dataDirectory()): Promise<void> {
    if ((!options.file || options.file === '-') && process.stdin.isTTY) {
        process.stderr.write('Pipe UTF-8 text to velora anonymize, provide a file, or use Anonymize text in the menu.\n');
        process.exitCode = 1;
        return;
    }
    var controller = new AbortController();
    var cancelExitCode = 130;
    var cancel = function () { controller.abort(); };
    var terminate = function () { cancelExitCode = 143; controller.abort(); };
    var input: Readable = process.stdin;
    if (options.file && options.file !== '-') {
        input = createReadStream(options.file);
    }
    var cancelInput = function () { input.destroy(controller.signal.reason); };
    controller.signal.addEventListener('abort', cancelInput, { once: true });
    process.on('SIGINT', cancel);
    process.on('SIGTERM', terminate);
    try {
        var decoder = new TextDecoder('utf-8', { fatal: true });
        var text = '';
        var bytes = 0;
        for await (var chunk of input) {
            var buffer = Buffer.from(chunk);
            bytes += buffer.byteLength;
            if (bytes > MAX_API_BODY_BYTES) {
                process.stderr.write('Input is too large. Keep UTF-8 input within 1.6 MiB.\n');
                process.exitCode = 1;
                return;
            }
            text += decoder.decode(buffer, { stream: true });
        }
        controller.signal.throwIfAborted();
        text += decoder.decode();
        var result = await anonymizeText(text, Boolean(options.mapping), controller.signal, directory);
        controller.signal.throwIfAborted();
        var output = result.text;
        if (options.json || options.mapping) { output = JSON.stringify(result, null, 2) + '\n'; }
        var cancelOutput = function () { process.stdout.destroy(controller.signal.reason); };
        controller.signal.addEventListener('abort', cancelOutput, { once: true });
        try {
            await new Promise<void>(function (resolve, reject) {
                var failed = function (error: Error) { reject(error); };
                process.stdout.once('error', failed);
                process.stdout.write(output, function (error) {
                    if (error) { reject(error); return; }
                    process.stdout.removeListener('error', failed);
                    resolve();
                });
            });
            controller.signal.throwIfAborted();
        } finally {
            controller.signal.removeEventListener('abort', cancelOutput);
        }
    } catch (error) {
        var message = 'Could not anonymize this input. Check the input file and velora serve status.';
        if (error instanceof TypeError && 'code' in error && error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') {
            message = 'Input must be valid UTF-8 text.';
        }
        if (error instanceof Error && error.name === 'AnonymizeError') { message = error.message; }
        if (controller.signal.aborted) {
            message = 'Anonymization cancelled. An active engine request may finish in the service.';
            process.exitCode = cancelExitCode;
        } else {
            process.exitCode = 1;
        }
        process.stderr.write(message + '\n');
    } finally {
        process.removeListener('SIGINT', cancel);
        process.removeListener('SIGTERM', terminate);
        controller.signal.removeEventListener('abort', cancelInput);
        input.destroy();
    }
}
