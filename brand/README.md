# Brand assets

| File | What it is |
|---|---|
| `logo-extracted-from-prototype.png` | The original wordmark, cropped unaltered from `HCII 2025 International Paper/high fi-1.png` (≈242×84 px, the highest-resolution copy available) |
| `synerpulse-logo.svg` | Vector version of that wordmark, produced by **automated tracing**, not by redrawing. Steps: 8× upscale → each pixel snapped to the 6 colours sampled from the artwork → per-colour morphological clean-up and light smoothing → potrace → layered SVG |
| `synerpulse-mark.svg` | The wordmark's own lead glyph (the fused F·P), clipped from the same SVG. Used for favicons and app icons |

Sampled palette: Pulse green `#22E522`, light green `#8EE89B`, Signal blue `#3048FD`, forest `#133F2A`, teal `#3CC381`, on mint `#EFFBF1`. The dark segments disappear on dark backgrounds, so place the logo on light surfaces.

**Replace these with the designer's original vector files when they are available.** The web app reads them from `apps/web/public/brand/` and the icons from `apps/web/public/icons/`.
