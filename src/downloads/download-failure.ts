import DownloadError from './download-error.js';

export default function downloadFailure(error: unknown, fallback: string): string {
    if (error instanceof Error && 'code' in error) {
        if (error.code === 'ENOSPC') {
            return 'Not enough storage space. Free disk space and try again.';
        }
        if (error.code === 'EACCES' || error.code === 'EPERM') {
            return 'Cannot write to storage. Check its permissions and try again.';
        }
    }
    if (error instanceof DownloadError) {
        return error.message.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
    }
    return fallback;
}
