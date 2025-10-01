# Repository Guidelines

## Project Structure & Module Organization
- Root scripts mirror Chrome MV3 entry points: `background.js` service worker, `content.js` for Discogs label pages, UI views (`newtab`, `options`, `popup`) with matching `.js` controllers, and shared styling in `shared.css`.
- Assets live beside code for easy manifest edits: fonts in `fonts/`, icons `icon*.png`, data helpers in `database.js`, and static HTML for storage inspection in `database.html`. Keep new modules at the root so manifest paths stay predictable.

## Build, Test, and Development Commands
- `chrome://extensions` → enable Developer mode → Load unpacked (repo root) to run locally; hit *Reload* after manifest or background changes.
- `mkdir -p dist && zip -r dist/curate-extension.zip . -x '*.DS_Store' 'dist/*'` builds a publishable zip; inspect the archive before submitting to the Web Store.

## Coding Style & Naming Conventions
- Use 4-space indentation, trailing semicolons, and camelCase identifiers; prefer `const`/`let`, and keep helper functions close to where they are used.
- DOM IDs/classes should describe intent (`js-queue-status`, `todoist-token`) and reuse tokens from `shared.css` rather than inline styles.

## Testing Guidelines
- Expect manual verification: load the unpacked extension, process a Discogs label queue, create a Todoist task, and confirm the new-tab dashboard refreshes.
- Watch the service worker console plus Network panel for Discogs/Todoist calls, and clear `chrome.storage` when validating cache updates (`CACHE_KEY`, `LABELS_KEY`, `TODOIST_CACHE_KEY`).

## Commit & Pull Request Guidelines
- Write imperative, focused commits (`Handle 429 backoff`) and avoid mixing manifest or asset tweaks with logic changes.
- PRs should call out motivation, link issues, summarize manual checks, and attach UI screenshots/GIFs for HTML or CSS updates.

## Security & Configuration Tips
- Never commit API tokens; the options UI stores Discogs and Todoist secrets through `chrome.storage`.
- Surface any permission or host changes in `manifest.json` and confirm Chrome prompts remain limited to the Discogs API.
