export default function documentationPath(path: string): string {
    var normalized = path.replace(/\/+$/, '');
    var published = [
        '/velora', '/velora/models', '/velora/license-api', '/velora/signatures',
        '/velora/errors', '/velora/local-processing', '/velora/models/nivora',
        '/velora/models/skira7alpha4', '/velora/models/skira61'
    ];
    if (published.includes(normalized)) {
        return normalized + '/';
    }
    if (normalized.startsWith('/velora/models/')) {
        return '/velora/models/';
    }
    return '/velora/';
}
