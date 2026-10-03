import DownloadError from '../downloads/download-error.js';
export default async function readUpdateAsset(url: string, limit: number, signal: AbortSignal, transport = fetch, onProgress?: (size: number) => void): Promise<Buffer> {
    var response = await transport(url, { signal, redirect: 'follow', headers: { 'User-Agent': 'velora' } });
    if (!response.ok || !response.body || response.url !== '' && !response.url.startsWith('https://')) {
        await response.body?.cancel();
        throw new DownloadError('Could not download the update. Check your connection and try again.');
    }
    var reader = response.body.getReader();
    var chunks: Uint8Array[] = [];
    var size = 0;
    try {
        while (true) {
            signal.throwIfAborted();
            var chunk = await reader.read();
            if (chunk.done) { break; }
            size += chunk.value.length;
            if (size > limit) { await reader.cancel(); throw new DownloadError('The update download exceeded its expected size.'); }
            chunks.push(chunk.value);
            onProgress?.(size);
        }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks);
}
