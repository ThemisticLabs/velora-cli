# Menubar draft

Open `menubar.html` for the interactive design preview. It simulates service states and actions; it does not control the service, create a native macOS popover or open a terminal.

The current direction follows Manu's supplied Codex menubar reference: one compact charcoal surface, status above the Start/Stop button, followed by Open velora and Settings. The popover keeps its size across service states. There are no model tables, usage statistics or extra navigation sections. Settings is intended to open the interactive CLI directly on its settings page. The CLI entry point `velora settings` is implemented; menubar integration and terminal/tab discovery are still pending.

The original TC logo comes from Themistic Gallery `assets/brand/themistic-tc-white.svg`. Arrow and settings icons are the existing Gallery Lucide assets; their license is embedded in the HTML. Ultramarine accents retain the Gallery palette. System typography, monochrome buttons in dark mode and the wider popover radius intentionally follow the supplied native-app reference rather than the earlier web-card proposals.

Light/dark themes and Running, Stopped, Starting, Stopping and Failed are simulated. Start/Stop in the actual menubar still requires implementation. These previews do not establish native rendering or service integration.
