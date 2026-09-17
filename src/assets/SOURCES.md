# Header mark

[logo.svg](logo.svg) is an unchanged copy of the original Themistic logo, sourced from `gallery/assets/logo.svg` in the separate Themistic project on 2026-09-17. The source artwork is included here so this repository does not depend on that project's local directory structure.

[mark.json](mark.json) is the static Unicode Braille rendering used by the CLI header, created on 2026-09-17. The SVG was rasterized locally and sampled at 16 × 16 pixels into 8 × 4 terminal cells. No new logo geometry was drawn. The CLI reads this JSON directly; it does not render the SVG at runtime.

The prior density-reduced landing frame was replaced because its contours were unreadable at header size. Unicode dot cells preserve the interwoven logo outline. This is terminal text art, not strict ASCII.

Project licensing remains to be selected before publication.
