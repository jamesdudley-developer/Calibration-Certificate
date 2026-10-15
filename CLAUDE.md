# Calibration Certificate

Installable PWA for filling in 4–20 mA transmitter calibration test sheets, producing PDF and Excel certificates, and saving them to the shared Supabase database. Used in the field on Android, often with no signal.

## About the owner

James is an instrumentation technician, not a software developer. He edits through the GitHub web UI and does not use a terminal.

- Do the work yourself, then explain what changed in plain words. Don't hand him command-line steps.
- Ground instrument behaviour and calibration maths in the OEM manual or the standard, and say which.
- Use Australian spelling and metric/SI units by default.

## Stack and rules

Plain HTML, CSS and JavaScript. No framework, no build step, no npm, no bundler. Keep it that way unless James asks.

- **Libraries stay local in `lib/`.** Never load from a CDN; that broke offline use before. Current libs: Chart.js, jsPDF, jsPDF-AutoTable, SheetJS (`xlsx`), Supabase JS.
- **Every change to any cached file needs a new cache version.** Bump `CACHE` in `sw.js` (currently `cal-app-vNN`), and bump the `?v=` query on `app.js` / `styles.css` in `index.html`. Keep the `?v=` in `sw.js` `ASSETS` matching `index.html`, or offline loads miss the cache.
- **Every file the page loads must be in `ASSETS` in `sw.js`.** `lib/supabase.js` is loaded by `index.html` but is not yet precached; add it next time `sw.js` changes.
- The service worker must never cache cross-origin requests (Supabase). Keep the origin check in the fetch handler.

## Files

| File | Purpose |
|---|---|
| `index.html` | Main PWA page. Contains the login gate and the Supabase client setup in an inline script near the bottom. |
| `app.js` | Form logic, test points, pass/fail, square-root extraction, switch mode, PDF and Excel export, `uploadToDatabase()`. |
| `calibration-sync.js` | Offline-first saving: writes to IndexedDB first, uploads to Supabase when online, retries queued records. Exposes `window.CalibrationSync`. |
| `styles.css` | Styles. |
| `sw.js`, `manifest.json`, `icon-*.png` | PWA shell. |
| `Calibration-App.html` | Older single-file standalone version with no login, drafts or database upload. It has fallen behind `index.html`. Ask James before changing or syncing it. |

## Calibration logic to protect

- Switch mode uses Open/Closed dropdowns with its own pass/fail rules, separate from analog test points.
- Square-root extraction is a per-instrument toggle; check both linear and square-root paths after any change to error calculation.
- A past CSS specificity bug hid toggles. After style changes, check toggles still show.

## Database (shared with Calibration-Tracker)

Supabase project `fwnbnssiekedrruikytk`. The publishable key in `index.html` is meant to be public; row-level security is on for every table. Never put a service-role key in this repo.

- `instruments`: one row per instrument. `tag_number` is unique and is the AMS Tag used by Terminal Gauging Services (TGS). Also `area`, `manufacturer`, `model`, `serial_number`, `interval_months` (default 12).
- `calibration_events`: one row per calibration. `result` must be `Passed` or `Failed`. `pdf_path` points into the `certificates` storage bucket. `form_data` (jsonb) holds the full form so a certificate can be reopened; `is_draft` marks drafts.
- `sites`, `profiles` (roles: `admin`, `editor`, `viewer`), `instrument_documents`, `calibration_procedures`, `calibration_procedure_items`.

Changes to these tables also affect the Calibration-Tracker app. Check both before altering a column.

## Before you finish

- Open the page and check the form, a PDF export and an Excel export still work.
- Confirm the cache version was bumped.
- Summarise the change for James in two or three plain sentences.
