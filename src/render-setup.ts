export var setupLayout = { title: '', detail: '', footer: '' };

export default function renderSetup(title: string, detail: string, footer: string): void {
    setupLayout = { title, detail, footer };
}
