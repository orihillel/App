# Tideline

Wave forecast app — live surf conditions, an interactive 3D globe of spots, and
wind/tide-aware alerts. Built with React + Vite.

## Getting started

```bash
npm install
npm run dev       # local dev server
npm run build     # production build to dist/
npm run preview   # serve the production build locally
```

## Project structure

- `src/App.jsx` — the app (ported from the original single-file chat mockup;
  see `HANDOFF.md` for the data sources, rating algorithm, and known issues).
- `src/lib/storage.js` — `localStorage`-backed persistence (saved spots,
  alerts, units, onboarding state).
- `src/main.jsx` — entry point.

No API keys are required — see `HANDOFF.md` for the data sources in use.
