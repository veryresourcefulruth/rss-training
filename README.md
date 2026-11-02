# RSS Childcare 101

Induction training for Resourceful Staffing Support agency staff: nine modules on EYFS 2026,
safeguarding and RSS expectations, with must-pass quizzes, a declaration and a certificate.

- **Staff** sign in with the shared RSS training password, their full name and a 4-digit PIN they choose
  the first time. Progress is saved on the server, so they can continue on any device.
- **Coordinator** signs in from the "Coordinator sign-in" link (or `/#coordinator`) with the coordinator
  password. From there: preview every module, edit modules and quizzes, change settings and passwords,
  and see the tracker (with CSV export, PIN reset and remove).

Quizzes are marked on the server and trainees never receive the answers in advance.

## How it runs

- Cloudflare Worker `rss-training` (`src/worker.js`) serves the API and the files in `public/`.
- D1 database `rss-training` holds settings (course content + hashed passwords), trainees, results and sessions.
- `seed/content.json` is the course as it was when it moved from Claude. It is only used to fill an empty
  database; after that, edits made in the app are stored in D1.

## Deploying

The Worker is built from this repo by Cloudflare (Workers & Pages → Create → Import a repository).
Every push to `main` redeploys. The database tables already exist; future schema changes go in
`migrations/` and are applied with `npm run migrate`.
