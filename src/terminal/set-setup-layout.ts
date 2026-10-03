var DEFAULT_FOOTER = '↑/↓ Move · Enter Select · Esc Back · Ctrl+C Quit';
export var setupLayout = { title: '', detail: '', footer: DEFAULT_FOOTER, documentationPath: '/velora/setup', tone: 'muted' as 'muted' | 'OK' | 'Warning' | 'Error' };

export default function setSetupLayout(title: string, detail = '', documentationPath = '/velora/setup', footer = DEFAULT_FOOTER, tone: 'muted' | 'OK' | 'Warning' | 'Error' = 'muted'): void {
    setupLayout = { title, detail, footer, documentationPath, tone };
}
