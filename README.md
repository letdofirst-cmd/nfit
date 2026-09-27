# FitLife

Small movement and nutrition habits for real days: at a desk, on your feet, or at home.
Plain HTML, CSS and JavaScript. No build step. Data stays in the browser.

## Run it

```bash
node server.js          # or: npm start   ->  http://localhost:4173
```

Needs Node 18+. Any static server works too (`python3 -m http.server 4173`).
Open it over `http://localhost`, not by double-clicking `index.html`: YouTube embeds and some browser features do not work from `file://`.

## One login for everyone

There is a single email/password login. The account itself decides what you see next, so there's nothing to pick beforehand.

- **User**: create an account on the same page. Users get Home, Dashboard, Exercises, Desk Fitness, Yoga, Plans, Nutrition, Progress, Leaderboard and Profile.
- **Admin**: one built-in account (`ADMIN_EMAIL` in `backend.js`). Logging in with that email drops you into the admin panel instead: Overview, Exercise videos and Manage exercises, where pictures can replace the animated characters. Admins do not see the user pages.

Change the admin password (only a salted hash is stored in `backend.js`):

```bash
node tools/make-admin-hash.js "a new password" --write
```

## What is inside

- **Guided routines**: play several exercises back to back (Desk, Yoga, Cardio, Strength), from a plan day, or from "Start all" on Home.
- **Exercise player**: timer, steps, a small pose illustration for how the movement looks, optional video, "Stop early" logs the time you actually spent. Keeps the screen awake and beeps/vibrates when time is up.
- **Exercise pictures** (admin): upload a PNG, JPEG, WebP, or GIF up to 5 MB for any exercise. Images are stored in IndexedDB and replace the character in exercise cards and the player.
- **Videos** (admin): attach an uploaded file (MP4/WebM up to 200 MB, kept in IndexedDB) or a link (YouTube, Vimeo, direct .mp4/.webm) to any exercise.
- **Progress**: streaks, points, levels, 9 badges, weekly goal you can set, session history with undo.
- **Leaderboard**: real accounts on the device only, with shortened names.
- **Nutrition**: shuffle and save day plans by eating style, with a calorie and protein estimate and water tracker. Each meal is tagged (🥦 fruit & veg, 🌾 whole grain, 💪 protein) so a day's plan visibly works toward WHO's healthy-eating guidance rather than just listing it. Under-18 profiles get maintenance estimates only.
- **Plans, reminders, leaderboard, backup and restore** of your own data.

## Files

```
index.html       page shell + Content-Security-Policy
styles.css       all styling (fluid type scale, responsive)
data.js          exercises, plans, routines, meals, badges, small utilities
backend.js       accounts, roles, sessions, stats, videos, import/export (localStorage + IndexedDB)
app.js           screens, routing, player, forms
server.js        tiny static server, no dependencies
tools/           make-admin-hash.js
.editorconfig    2-space indent, LF line endings
tests/           backend.test.js, ui.test.js, ui-admin.test.js, fixtures/
```

All app logic sits behind the `FitLife.backend` API in `backend.js`. To add a real server later, keep that API and replace its internals with network calls.

## Tests

```bash
export FITLIFE_ADMIN_PW="your admin password"   # so the admin tests can log in
npm test                                         # backend logic, no dependencies
npm install && npx playwright install chromium   # once, for the browser tests
npm start &                                      # tests expect http://localhost:4173
npm run test:ui                                  # member + admin flows in a real browser
```

Without `FITLIFE_ADMIN_PW` the admin tests are skipped, so the password never has to live in the repo.

## Honest limits

- Everything is stored per browser. An admin's uploaded videos and other people's accounts are **not** visible on other devices. That is fine for one laptop; multi-user use needs a server and database.
- Roles and the admin password check run in the browser, so a determined user can bypass them with DevTools. The login throttle and hashing only stop casual guessing. Real protection needs server-side auth.
- Calorie numbers are estimates, not medical advice.

## Next step worth doing

A small Node API (accounts, sessions, shared videos, leaderboard) behind the same `FitLife.backend` functions. That fixes every limit above.
