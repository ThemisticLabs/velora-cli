# Header mark

[logo.svg](logo.svg) is an unchanged copy of the TC monogram supplied by Manu on 2026-09-21. Source: `/Users/manu/.codex/visualizations/2026/09/21/themistic-tc/themistic-tc.svg`. Both original letter paths are preserved. The SVG is included so the CLI has no dependency on that external directory.

[mark.json](mark.json) contains the static terminal rendering. The letter bounds (40, 40, 440, 320) are sampled into a 16 × 12 monochrome grid using area averaging and a 50% coverage threshold. Two empty sample rows are added above and below to match the previous header height. Each 2 × 4 sample group becomes one Unicode Braille cell. This produces an eight-column, four-row dotted mark, matching the previous logo size and retaining the proportions of the supplied TC artwork. This is terminal text art, not strict ASCII.

The CLI reads the JSON directly and applies the existing Themistic accent. It does not rasterize SVGs at runtime. The compact text-only header in short terminals is unchanged.

Project licensing remains to be selected before publication.
