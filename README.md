# CTR Social Scheduler

## Project summary

### One-sentence description of the project

CTR Social Scheduler helps Conversations to Remember staff organize social media content, automatically fill recurring posting slots, and manage scheduled posts across Facebook, Instagram, and LinkedIn.

### Additional information about the project

The **CTR Social Scheduler** is a separate extension to the Conversations to Remember (CTR) CRM project, developed for the nonprofit's social media team. Staff can create posts, save images, organize content by platform and post type, review a monthly posting calendar, and identify where more content is needed.

Posts follow one of two scheduling paths:

- **Add to Library:** The scheduler assigns the oldest eligible post to the next available slot with the same post type and, where applicable, the same Blue/Purple color. Platform posting days, times, and post-type rotations determine available slots.
- **Specific Date:** Staff choose a fixed date and time. This takes precedence over the normal library slot on that day, with conflict feedback when another fixed post is nearby.

The project uses a **React/Vite** frontend, a **Node.js/Express** API, and a **SQLite** database. Optional Google Calendar integration mirrors projected posts as events; optional Google Drive integration stores images. The backend includes an **n8n webhook dispatcher** for scheduled publishing, but the intended production workflow and client integration still require final validation. The app itself does not publish directly to social media APIs.

**Team:** Jaime Gudino and Alice Hui  
**Client:** Conversations to Remember  
**Status:** Sprint 5 implementation / integration testing; not yet a confirmed production deployment.

## Installation

### Prerequisites

- **Git** to clone the repository.
- **Node.js 22 or newer** and **npm**. The backend uses the built-in `node:sqlite` module; use a Node.js release that supports it.
- A modern browser (Chrome, Firefox, Safari, or Edge).
- Optional, for connected services: a Google Cloud OAuth client with Google Calendar and Drive APIs enabled; an accessible Google Calendar; and a Google Drive folder.
- Optional, for a remotely shared Docker demo: **Docker with Compose** and **cloudflared**.

The commands below assume the repository contains a `scheduler/` directory with npm workspaces named `client` and `server`, and a `scheduler/package-lock.json` file. The package manifests and Docker Compose files were not included in the supplied review files; confirm those files in the actual repository before using the instructions for a fresh checkout.

### Add-ons

| Technology / service | Purpose |
| --- | --- |
| React and React Router | Frontend screens and navigation |
| Vite | Frontend development server and build tooling |
| Node.js and Express | API, scheduling service, and HTTP routes |
| SQLite (`node:sqlite`) | Local persistent database with schema migrations |
| Google Calendar API | Create, update, and remove projected posting events |
| Google Drive API | Store and retrieve uploaded images when configured |
| n8n webhooks | Receive publishing payloads from the scheduler when enabled |
| Docker Compose and Cloudflare Tunnel | Optional deployment and temporary remote demonstrations |

Dependency versions are controlled by the repository's `package.json` files and `package-lock.json`; install them with `npm ci` rather than installing individual packages manually.

### Installation Steps

#### 1. Clone and open the scheduler

```bash
git clone <YOUR-REPOSITORY-URL>
cd <YOUR-REPOSITORY-DIRECTORY>/scheduler
```

Replace the placeholders with your actual GitHub repository URL and checkout directory. If the repository is already cloned, open a terminal in its `scheduler` directory instead.

#### 2. Check the Node.js installation and install dependencies

```bash
node --version
npm --version
npm ci
```

Run `npm ci` from **`scheduler/`**, where the workspace lockfile is located. This installs the dependencies declared for the client and server workspaces.

#### 3. Create a local development environment

From `scheduler/`, create a `.env` file:

```bash
cat > .env <<'ENV'
PORT=3000
DB_PATH=./data/scheduler.db
TIMEZONE=America/Los_Angeles
APP_URL=http://localhost:3000
TEST_MODE=true
DRY_RUN=false
BASIC_AUTH=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REFRESH_TOKEN=
TEST_CALENDAR_ID=
CALENDAR_ID=
DRIVE_FOLDER_ID=
WEBHOOK_URL=
TEST_WEBHOOK_URL=
ENV
```

This is a **local test configuration**, not production settings. With `TEST_MODE=true`, the dispatcher sends due posts to the built-in test webhook by default, not to a live publishing workflow. `DRY_RUN=true` can instead log dispatch payloads without sending them. Without Google credentials, scheduling continues in the local database, but Google Calendar synchronization and Drive uploads are unavailable; image uploads use local disk storage.

**Do not commit `.env`, Google tokens, passwords, or application data to Git.** Set `BASIC_AUTH=user:password` before exposing the application through a public URL.

#### 4. Load the environment and start both development servers

In a macOS/Linux shell, from `scheduler/`:

```bash
set -a
source .env
set +a
node scripts/dev.mjs
```

The supplied `scripts/dev.mjs` starts the `server` and `client` npm workspaces together. Open the Vite URL printed in your terminal (typically **http://localhost:5173/**). The API defaults to **http://localhost:3000/**.

Check the backend in another terminal:

```bash
curl http://localhost:3000/api/health
```

A healthy API responds with JSON containing `"ok":true` and `"app":"ctr-scheduler"`. Stop the development servers with **Ctrl+C**.

**Alternative:** Start the workspaces in separate terminals from `scheduler/` using `npm run dev --workspace server` and `npm run dev --workspace client` (after loading the environment in the server terminal).

#### 5. Database creation and seed data

On server startup, the application:

1. Opens or creates the SQLite database at `DB_PATH` (default: `./data/scheduler.db`).
2. Applies the SQL migration files in `server/db/migrations/` that have not already run.
3. Seeds the platform configuration and default post types.

The seed includes **Facebook**, **Instagram**, **LinkedIn**, and a **Test** platform. Example posting days, times, and post types are created automatically. A manual reseed is available if needed:

```bash
node server/db/seed.js
```

This creates **platform configuration**, not a library of sample social posts. Add posts through the Compose page. The supplied files do not document an importer for existing/real client posts. Local images, when Google Drive is not configured, are stored under the data directory. Preserve the database and uploaded media when updating the app.

#### 6. Optional: Connect Google Calendar and Google Drive

Google services are **not required** for local-only testing. To enable them:

1. In Google Cloud, enable the **Google Calendar API** and **Google Drive API** for an OAuth client.
2. Add the exact OAuth redirect URI used by `scripts/googleToken.mjs`: `http://localhost:5678/rest/oauth2-credential/callback`.
3. Enter `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` in `scheduler/.env`.
4. Set `TEST_CALENDAR_ID` for a dedicated test calendar and `DRIVE_FOLDER_ID` for the intended Drive folder.
5. Load `.env` and run the one-time authorization script:

```bash
set -a
source .env
set +a
node scripts/googleToken.mjs
```

The script requests Google Calendar and `drive.file` access and writes `GOOGLE_REFRESH_TOKEN` to `scheduler/.env` when authorization succeeds. **Restart the server** after changing `.env`; do not share the refresh token. The script expects an existing `GOOGLE_REFRESH_TOKEN=` line in `.env`.

For production mode, `TEST_MODE=false` selects `CALENDAR_ID` instead of `TEST_CALENDAR_ID`. **Do not enable production mode or live webhooks until the client approves and the integrations have been tested.**

#### 7. Optional: Temporary remote demo

The supplied `scripts/share.mjs` uses `cloudflared` to create a temporary URL and starts the application through Docker Compose:

```bash
node scripts/share.mjs
```

This requires a working `scheduler/docker-compose.yml` or equivalent Compose configuration, Docker, and cloudflared. **Verify these deployment files and set `BASIC_AUTH` first.** Press **Ctrl+C** to stop sharing. This is a demonstration path, not evidence of a completed client-server deployment.

## Functionality

1. **Compose:** Select a platform; enter a caption and hashtags; optionally upload or select an existing image and enter alt text. Choose **Add to Library** or **Specific Date**. The form displays a character count, media format warnings, and conflict options for fixed posts.
2. **Library:** Review waiting posts, scheduled posts, and failed sends by platform. Edit or remove posts and requeue failed sends. Library posts without a matching slot remain available until a suitable slot opens.
3. **Calendar:** View one platform's monthly posting slots, scheduled posts, and empty slots. Select a slot to change its post type or color, manually pin a matching post, or lock the slot against automatic changes.
4. **Inventory:** Compare available library posts with empty posting slots by platform, type, and color. Highlight low-stock combinations and inspect the next 14 days of scheduled posts and uncovered slots.
5. **Media:** Search uploaded images; inspect dimensions, type, upload date, associated posts, and platform-specific compatibility checks.
6. **Platforms:** Set posting weekdays and time, choose the Google Calendar event color, and add, rename, or adjust post types in the monthly rotation. Changes regenerate eligible future unlocked slots.
7. **Test mode:** Shows a banner when test mode is active. The backend exposes `/api/status` and test-only clock controls, with dispatch directed to a test endpoint or logged in dry-run mode.

### Scheduling behavior

- Library slots repeat the platform's rotation of post types. Where the platform uses colors, slots alternate **Blue** and **Purple**.
- Eligible library posts fill matching slots in **oldest-first** order.
- A Specific Date post keeps its selected time and displaces the ordinary library slot on that day.
- A locked slot is preserved from automatic changes.
- A paused or disabled platform does not assign a live schedule while paused/disabled; backend settings support these states, though the supplied Platforms screen does not expose pause controls.
- Google Calendar mirrors eligible projected posts **when valid Google credentials and a calendar ID are configured**.

## Known Problems

- **Google Calendar two-way updates are incomplete:** `server/services/googleCalendar.js` creates, patches, and deletes app-owned events. `server/services/sync.js` detects conflicting Google edits through ETags but does not demonstrate the required read-back/reconciliation when someone moves or deletes a calendar event directly in Google Calendar. Avoid describing two-way sync as finished.
- **No visible blackout-date management:** No blackout-date interface or rule was confirmed in the supplied client/server source. This Sprint 5 plan item requires implementation or separate verification.
- **Priority queue replaced by typed library slots:** The current scheduling algorithm selects the oldest matching post by post type/color rather than promoting a `high-priority` post. See `server/services/projection.js` and `server/services/sync.js`.
- **Pause controls are not exposed in the supplied UI:** Backend `server/routes/platforms.js` supports a `paused` flag, but `client/src/pages/Platforms.jsx` does not show a pause toggle.
- **Production publishing is not verified:** `server/services/dispatch.js` sends due payloads to a webhook and does not post to Facebook, Instagram, or LinkedIn directly. Confirm the final n8n/Google Calendar workflow with the client before enabling it.
- **Full social post preview not verified:** `client/src/pages/Composer.jsx` previews the selected image and shows text limits, but a platform-styled live preview was not found.
- **Fresh-checkout test still needed:** This README was prepared from supplied source files. The workspace `package.json` files, SQL migrations, Vite configuration, Compose file, and the complete repository were not included, so a clean clone/install/build and Google integration test have **not** been independently completed here.

## Contributing

1. Fork the repository.
2. Create a feature branch: `git checkout -b my-new-feature`.
3. Commit your changes: `git add . && git commit -m 'Describe the change'`.
4. Push the branch: `git push origin my-new-feature`.
5. Open a pull request and link the related issue, tests, and before/after demonstration where required by the course.

Please avoid committing credentials, local SQLite databases, uploaded media, or generated build files.

## Additional Documentation

- [Conversations to Remember](https://conversationstoremember.org/) — Client organization.
- Sprint 5 report — **add the repository link after the report is committed**.
- Sprint 5 demo video — **add the unlisted YouTube link when available**.
- Technical/design documentation — **add the repository path or link when uploaded**.
- Google Calendar and Google Drive setup — see **Installation → Step 6** above.

## License

**License not yet confirmed.** Add a `LICENSE` or `LICENSE.txt` file after the project team and client agree on the permitted use and distribution of the source. Do not assume an MIT license has already been granted.
