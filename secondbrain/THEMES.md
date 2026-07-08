# Second Brain — five visual directions

Proposed before implementation (per spec). Each is a genuinely different direction —
different paper, different type, different accent logic — not hue swaps. All five handle
light and dark deliberately via `light-dark()`, and none use Inter/Roboto/system-default
sans or purple gradients.

| # | Theme | bg (light / dark) | accent | typeface | rationale |
|---|-------|-------------------|--------|----------|-----------|
| 1 | **Ledger** (default) | `#F5F0E6` / `#17140E` | moss `#486B4D` | Iowan Old Style / Georgia serif headings, system text body | A paper day-book: calm, analog, ink-on-paper contrast; the accent is a bookkeeper's green ink. |
| 2 | **Terminal** | `#F1F4F0` / `#0B0F0C` | phosphor `#2FB56A` | ui-monospace everywhere | Zero-chrome utility. Ranked output like a well-behaved CLI; dark mode is a proper phosphor console, light mode is greenbar printout grey. |
| 3 | **Signal** | `#FFFFFF` / `#101010` | signal red `#E63312` | Helvetica Neue / Arial Narrow-ish heavy weights, giant numerals | International Typographic Style poster: stark ground, one loud accent, rank numbers as the design. |
| 4 | **Tide** | `#EDF2F5` / `#0D1B24` | deep teal `#0E7C86` | Seravek / Verdana humanist sans | Low-stimulation coastal dusk for evening planning; soft contrast, generous leading, cool greys instead of black. |
| 5 | **Clay** | `#F2E2D0` / `#221510` | burnt sienna `#B4552D` | Avenir Next / Trebuchet MS rounded sans | Tactile workshop: warm terracotta ground, chunky rounded cards, accents like wet clay — energetic without being loud. |

Implementation: `css/themes.css`, one `:root[data-theme=…]` block per theme defining
`--bg --surface --ink --muted --accent --accent-ink --line --font-display --font-body
--radius --shadow`, each with `light-dark()` pairs. Scheme override: `data-scheme`
(auto/light/dark) flips `color-scheme`.
