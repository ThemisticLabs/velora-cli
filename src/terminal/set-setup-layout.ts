export var setupLayout = { title: '', detail: '', footer: '', documentationPath: '/velora/setup' };

export default function setSetupLayout(title: string, detail: string, footer: string, documentationPath = '/velora/setup'): void {
    setupLayout = { title, detail, footer, documentationPath };
}
