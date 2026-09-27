export default class DownloadError extends Error {
    override name = 'DownloadError';

    constructor(message: string, public code?: string) {
        super(message);
    }
}
