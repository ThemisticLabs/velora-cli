import licensePurchase from '../system/license-purchase.js';

type FooterAction = { key: string; label: string; onPress: () => Promise<string> };
var DEFAULT_FOOTER = '↑/↓ Move · Enter Select · Esc Back · Ctrl+C Quit';
export var setupLayout = { title: '', detail: '', footer: DEFAULT_FOOTER, documentationPath: '/velora/setup', tone: 'muted' as 'muted' | 'OK' | 'Warning' | 'Error', action: undefined as FooterAction | undefined };

export default function setSetupLayout(title: string, detail = '', documentationPath = '/velora/setup', footer = DEFAULT_FOOTER, tone: 'muted' | 'OK' | 'Warning' | 'Error' = 'muted', action?: FooterAction): void {
    if (!action && documentationPath.startsWith('/velora/license-api')) {
        action = { key: 'f2', label: 'Get license key', onPress: licensePurchase };
    }
    setupLayout = { title, detail, footer, documentationPath, tone, action };
}
