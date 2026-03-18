# Whisper Local App V2

V2 scaffold with:
- Vanilla JavaScript + TypeScript (no React, no state manager)
- Vite only as minimal tooling for TS + npm dependencies
- Local Font Awesome via npm (no CDN)
- Sourcemaps enabled in build output and no minification

## Commands

- `npm run dev`: starts Vite dev server.
- `npm run build`: type-check + build to `dist/`.
- `npm run preview`: serves built `dist/` on port `4173`.

## Notes

- Architecture remains Vanilla-first (classes, direct DOM updates, `innerHTML`, etc.).
- Vite is used only for module/dev/build ergonomics.
