# Menubar draft

Open `menubar.html` for the interactive design preview. It simulates service states and actions; it does not control the service, create a native macOS popover or open a terminal.

The current direction follows Manu's supplied Codex menubar reference: one compact charcoal surface, status above the Start/Stop button, followed by Open velora. Quit sits at the bottom left and Settings at the bottom right as icon buttons. Status uses text without a dot. Clicking the TC logo opens https://themistic.com in a new browser tab. The popover keeps its size across service states. There are no model tables, usage statistics or extra navigation sections. Settings is intended to open the interactive CLI directly on its settings page. The CLI entry point `velora settings` is implemented; menubar integration and terminal/tab discovery are implemented.

The original TC logo comes from Themistic Gallery `assets/brand/themistic-tc-white.svg`. Arrow, close and settings icons are the existing Gallery Lucide assets; their license is embedded in the HTML. Ultramarine accents retain the Gallery palette. System typography, monochrome buttons in dark mode and the wider popover radius intentionally follow the supplied native-app reference rather than the earlier web-card proposals.

Light/dark themes and Running, Stopped, Starting, Stopping and Failed are simulated. The native menubar implements Start/Stop. These previews do not establish native rendering or service integration.

The approved controls are implemented in `src/assets/menu-bar.markup` and presented through AppKit NSPopover and WebKit. This HTML remains a simulated design reference. Native behavior and terminal configuration are verified separately; opening this preview does not control the service.

Quit stops the independent service, asks the registered interactive session to close and then closes the native helper. Existing shell windows are not closed. Ghostty cold starts reuse its initial window; later opens create a window only when there is no registered velora session.
