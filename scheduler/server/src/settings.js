/**
 * Values you may want to change. Each one says what it affects, its unit, and what to check
 * after changing it.
 *
 * Values set per server live in .env, see config.js; every one of them (name, what it does,
 * default, example) is listed in the README under "Server settings (.env)". That covers the
 * time zone, session timeouts, Google IDs, webhook URLs, MEDIA_TRASH_DAYS (read in
 * services/mediaTrash.js), ARCHIVE_AFTER_MONTHS (read in services/archive.js) and the rest.
 *
 * What lives here:
 *   imageRules               per-platform image checks (type, file size, width, shape)
 *   jpegOptions              quality of the JPEGs the app makes from uploads
 *   jpegBackground           the color transparent pixels become
 *   smallCopyMaxPx           longest side of the small copy kept for published posts
 *   smallCopyJpegOptions     quality of that small copy
 *   collisionMs              how close two Specific Date posts on one platform may be
 *   eventMinutes             length of each Google Calendar event
 *   slotMonthsAhead          months of slots made ahead when someone views a month
 *   syncMonthsAhead          months of slots every sync keeps made (from this month)
 *   briefLowStockMonths      months the brief's "running low" list looks at
 *   dispatchTickMs           how often the dispatcher looks for posts that are due
 *   notificationScanMs       how often failed posts are checked for a notification
 *   calendarPullMs           how often hand edits in Google Calendar are read back
 *   autoArchiveCheckMs       how often automatic archiving runs (only if switched on)
 *   webhookTimeoutMs         how long the dispatcher waits for n8n
 *   setupCode*               the setup account's one-time sign-in code
 *   archiveOlderThanChoices  the "Older than" choices of the Archive page
 *   archiveDefaultOlderThan  which of those is picked by default
 *   notificationCaptionChars how much of a caption a notification quotes
 *
 * Left where they are on purpose (part of the database or the API, so changing them here
 * would break stored data or the client):
 *   - the slot colors "Blue" and "Purple" (COLORS in services/projection.js): they are stored
 *     in post.color and slot.color and checked by the API. Their on-screen shades are the
 *     --slot-blue and --slot-purple CSS variables in client/src/styles.css.
 *   - the date the Blue/Purple alternation counts from (ANCHOR in services/projection.js):
 *     changing it would flip the color of slots already made.
 *   - API input limits and defaults: page sizes (MAX_LIMIT in routes/archive.js and
 *     routes/notifications.js), the blackout reason length (MAX_REASON in routes/blackouts.js,
 *     matched by the form's maxLength), schedule rule limits (MAX_INTERVAL_WEEKS, MAX_SEQUENCE
 *     in routes/platforms.js), and the inventory/brief query ranges (routes/inventory.js).
 *   - the Google Calendar colorId of each platform: set on the Platforms page and stored.
 *   - notification titles are cut at 250 characters to fit the notification.title column.
 *
 * The client has its own file for what the browser shows: client/src/settings.js.
 */

const MB = 1024 * 1024;

/**
 * What each platform accepts for an image. An upload that breaks a rule is still stored,
 * but the user sees a warning in Compose, the Library and the Media page.
 *
 * Usage:
 *   imageRules.Instagram.maxBytes   (read by checkImage in services/imageRules.js)
 *
 * Takes:
 *   One entry per platform, keyed by the platform's name as stored in platform.name:
 *   mimeTypes - accepted types, e.g. ['image/jpeg']
 *   maxBytes  - largest file, in bytes (8 * MB = 8 megabytes)
 *   minWidth  - narrowest image in pixels, or null for no limit
 *   minAspect - tallest shape allowed, as width / height (4 / 5 = 0.8 portrait), or null
 *   maxAspect - widest shape allowed, as width / height (1.91 landscape), or null
 *
 * When editing:
 *   A platform not listed here is never warned about. The Test platform's 10 MB matches the
 *   upload route's own limit. The warnings name 4:5 for Instagram's portrait limit, so update
 *   that text in services/imageRules.js if minAspect changes. The preview's crop has its own
 *   numbers in client/src/settings.js (previewFeeds); keep them in step.
 *   After changing: restart the server, pick an image in Compose for each platform and check
 *   the warnings under it (try one too small, too large and too tall).
 */
export const imageRules = {
  Instagram: {
    mimeTypes: ['image/jpeg'],
    maxBytes: 8 * MB,
    minWidth: 320,
    minAspect: 4 / 5,   // 0.8, portrait limit
    maxAspect: 1.91,    // landscape limit
  },
  Facebook: {
    mimeTypes: ['image/jpeg', 'image/png'],
    maxBytes: 4 * MB,
    minWidth: 600,
    minAspect: null,
    maxAspect: null,
  },
  LinkedIn: {
    mimeTypes: ['image/jpeg', 'image/png'],
    maxBytes: 5 * MB,
    minWidth: 552,
    minAspect: null,
    maxAspect: null,
  },
  Test: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxBytes: 10 * MB, // the upload route's own limit
    minWidth: null,
    minAspect: null,
    maxAspect: null,
  },
};

/**
 * How the app encodes the JPEGs it makes: uploads that are not JPEG (PNG, WebP), JPEGs that
 * had to be turned upright, and images rotated on the Media page. JPEG uploads that are
 * already upright are kept byte for byte and never re-encoded.
 *
 * Usage:
 *   sharp(buffer).jpeg(jpegOptions)   (services/imageConvert.js)
 *
 * Takes:
 *   quality - 1 to 100; higher is sharper and larger. 90 keeps photos clean for posting.
 *   mozjpeg - true makes smaller files at the same quality (slower to encode).
 *
 * When editing:
 *   Only new conversions and rotations change; stored images stay as they are.
 *   Higher quality can push a file over a platform's maxBytes (imageRules above).
 *   After changing: restart the server, upload a PNG on the Media page and check the
 *   converted image's look and file size.
 */
export const jpegOptions = { quality: 90, mozjpeg: true };

/**
 * The color transparent pixels become when an image is turned into a JPEG (JPEG has no
 * transparency). Used for conversions, rotations and the small copies.
 *
 * Usage:
 *   sharp(buffer).flatten({ background: jpegBackground })   (services/imageConvert.js)
 *
 * Takes:
 *   { r, g, b } - each 0 to 255. White by default.
 *
 * When editing:
 *   After changing: upload a PNG with a transparent area and look at the result.
 */
export const jpegBackground = { r: 255, g: 255, b: 255 };

/**
 * Longest side of the small copy kept for a published post once its full-size image is
 * purged from Recently deleted (and for archived posts), so the post's history still shows it.
 *
 * Usage:
 *   .resize(smallCopyMaxPx, smallCopyMaxPx, { fit: 'inside' })   (services/imageConvert.js)
 *
 * Takes:
 *   Pixels. 400 by default. Larger copies use more disk, which is what
 *   archiving is meant to save.
 *
 * When editing:
 *   Only copies made after the change use the new size; images are never enlarged.
 *   After changing: check a purged image's copy on the Media page ("Kept for history" view)
 *   and on the Archive page.
 */
export const smallCopyMaxPx = 400;

/**
 * JPEG quality of the small copy (see smallCopyMaxPx).
 *
 * Usage:
 *   .jpeg(smallCopyJpegOptions)   (services/imageConvert.js)
 *
 * Takes:
 *   quality - 1 to 100 (75 by default); mozjpeg as in jpegOptions.
 *
 * When editing:
 *   After changing: check a purged image's copy on the Media page and the Archive page.
 */
export const smallCopyJpegOptions = { quality: 75, mozjpeg: true };

/**
 * How close two Specific Date posts on the same platform may be. Closer than this, Compose
 * and the Library answer 409 with a suggested later time (unless the user picks "Schedule
 * anyway"), and a move made in Google Calendar gets a "clash" notification.
 *
 * Usage:
 *   Math.abs(a - b) < collisionMs   (routes/posts.js, services/calendarPull.js)
 *
 * Takes:
 *   Milliseconds. 120 * 60_000 = 2 hours. 0 turns the check off.
 *
 * When editing:
 *   The server messages that name the window are built from this value: routes/posts.js
 *   (the 409 error) and services/calendarPull.js (the clash notification). The 409 also sends
 *   windowHours, which the browser's "(2 hours later)" in client/src/components/PostFields.jsx
 *   uses. Only the README's "Collisions" line says "2 hours" in words; update it to match.
 *   After changing: in Compose, schedule two Specific Date posts on one platform just inside
 *   and just outside the new window, and check the warning and its suggested time.
 */
export const collisionMs = 120 * 60_000;

/**
 * Length of each Google Calendar event the app writes (one per scheduled post). Only how the
 * event looks in the calendar; the post goes out at the event's start.
 *
 * Usage:
 *   buildEvent({ platform, post, media, slot })   (services/googleCalendar.js uses it as the default)
 *
 * Takes:
 *   Minutes. 15 by default.
 *
 * When editing:
 *   Events already in the calendar keep their length until the app rewrites them.
 *   n8n reads the event's start, not its end.
 *   After changing: schedule a post and check its event's length in Google Calendar.
 */
export const eventMinutes = 15;

/**
 * How far ahead slots are made when someone opens a month on the Calendar page (and when a
 * blackout's months are regenerated). Months beyond this are shown empty and not stored.
 *
 * Usage:
 *   monthsFrom(clock.now(), slotMonthsAhead, config.timezone)   (routes/slots.js, routes/blackouts.js)
 *
 * Takes:
 *   Months, counting the current one. 24 by default. Keep it at least syncMonthsAhead.
 *
 * When editing:
 *   Both routes use this one value, so a blackout far ahead still clears its slots.
 *   More months means more slot rows and longer regenerations.
 *   After changing: on the Calendar page, open the last month that should have slots and the
 *   month after it.
 */
export const slotMonthsAhead = 24;

/**
 * Months of slots every sync makes sure exist, starting with the current month, so library
 * posts always have somewhere to go and the Library shows their dates.
 *
 * Usage:
 *   monthsFrom(now, syncMonthsAhead, config.timezone)   (services/sync.js)
 *
 * Takes:
 *   Months, counting the current one. 2 by default.
 *
 * When editing:
 *   Library posts wait unplaced when every slot in these months is taken.
 *   After changing: run a sync (Platforms page or POST /api/sync) and check that the Library
 *   shows dates for waiting posts and the Calendar has slots in those months.
 */
export const syncMonthsAhead = 2;

/**
 * Months the 14-day brief's "running low" list (GET /api/brief, lowStock) counts empty slots
 * against the library posts waiting for them.
 *
 * Usage:
 *   inventory(db, monthsFrom(now, briefLowStockMonths, config.timezone), now)   (routes/inventory.js)
 *
 * Takes:
 *   Months, counting the current one. 2 by default (the same as the Inventory page's default).
 *
 * When editing:
 *   After changing: open the Inventory page and compare its "running low" list with the stock table.
 */
export const briefLowStockMonths = 2;

/**
 * How often the dispatcher looks for posts whose time has come and sends them to n8n.
 * A post goes out up to this long after its time.
 *
 * Usage:
 *   setInterval(() => tick(db), dispatchTickMs)   (index.js)
 *
 * Takes:
 *   Milliseconds. 60_000 = 1 minute.
 *
 * When editing:
 *   After changing: restart the server and watch a test-mode post go out
 *   (GET /api/test-webhook shows what was sent).
 */
export const dispatchTickMs = 60_000;

/**
 * How often posts that failed to send are checked so each failure gets one notification.
 *
 * Usage:
 *   setInterval(() => notifyFailures(db), notificationScanMs)   (index.js)
 *
 * Takes:
 *   Milliseconds. 60_000 = 1 minute (the same as the dispatcher tick).
 *
 * When editing:
 *   The bell in the browser checks on its own schedule (client/src/settings.js,
 *   notificationPollMs), so a notification can take both intervals to show.
 *   After changing: restart the server, let a post fail and time its notification.
 */
export const notificationScanMs = 60_000;

/**
 * How often changes people make by hand in Google Calendar (moved or deleted events, edited
 * text) are read back into the app. The manual sync (POST /api/sync) also reads them at once.
 *
 * Usage:
 *   setInterval(() => pullCalendar(db), calendarPullMs)   (index.js)
 *
 * Takes:
 *   Milliseconds. 2 * 60_000 = 2 minutes. Each read is one Google API call, and Google limits
 *   calls per day.
 *
 * When editing:
 *   A hand edit made within this long of a post's time may not be seen before it goes out.
 *   After changing: restart the server, move an app event in Google Calendar and time how
 *   long the post takes to follow.
 */
export const calendarPullMs = 2 * 60_000;

/**
 * How often automatic archiving runs. It does nothing unless ARCHIVE_AFTER_MONTHS is set in
 * .env (off until a retention period is chosen); it never deletes posts.
 *
 * Usage:
 *   setInterval(archiveOld, autoArchiveCheckMs)   (index.js)
 *
 * Takes:
 *   Milliseconds. 24 * 60 * 60_000 = once a day. It also runs once at every start.
 *
 * When editing:
 *   After changing: with ARCHIVE_AFTER_MONTHS set, check the server log and the Archive page.
 */
export const autoArchiveCheckMs = 24 * 60 * 60_000;

/**
 * How long the dispatcher waits for n8n (or the test webhook) to answer before it counts the
 * send as failed.
 *
 * Usage:
 *   AbortSignal.timeout(webhookTimeoutMs)   (services/dispatch.js)
 *
 * Takes:
 *   Milliseconds. 10_000 = 10 seconds. The dispatcher tick waits for it.
 *
 * When editing:
 *   After changing: send a test-mode post and check it is marked posted, not failed.
 */
export const webhookTimeoutMs = 10_000;

/**
 * The setup account's one-time sign-in code (outside test mode; see services/auth.js).
 * It is printed in the server log at startup.
 *
 * Usage:
 *   makeSetupCode(db)   (services/auth.js reads all five values)
 *
 * Takes:
 *   setupCodeHours    - hours a code works, 24 by default
 *   setupCodeTries    - wrong codes allowed from one address per window, 5 by default
 *   setupCodeWindowMs - that window in milliseconds, 15 * 60_000 = 15 minutes
 *   setupCodeLength   - characters in the code, 12 by default (printed in groups of 4,
 *                       so keep it a multiple of 4)
 *   setupCodeLetters  - the characters a code is made of. No I, L, O, 0 or 1, so the
 *                       code can be read off a log and typed without mix-ups.
 *
 * When editing:
 *   The "Too many wrong setup codes" message in services/auth.js is built from
 *   setupCodeWindowMs, so it stays right. Shorter or simpler codes are easier to guess.
 *   After changing: start the server with TEST_MODE=false and a setup account, read the code
 *   in the log, and sign in with it on the sign-in screen.
 */
export const setupCodeHours = 24;
export const setupCodeTries = 5;
export const setupCodeWindowMs = 15 * 60_000;
export const setupCodeLength = 12;
export const setupCodeLetters = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/**
 * The "Older than" choices on the Archive page, in months; 0 = any age. The API refuses any
 * other value (GET /api/archive?olderThan=).
 *
 * Usage:
 *   archiveOlderThanChoices.includes(olderThan)   (routes/archive.js)
 *
 * Takes:
 *   Whole months, 0 or more.
 *
 * When editing:
 *   The page's list with its labels is archiveOlderThan in client/src/settings.js; keep both
 *   lists the same, or the page offers a choice the server refuses.
 *   After changing: on the Archive page, pick each "Older than" choice and check the list loads.
 */
export const archiveOlderThanChoices = [0, 3, 6, 12, 24, 36];

/**
 * The "Older than" choice used when none is given. Must be one of archiveOlderThanChoices.
 *
 * Usage:
 *   listArchive(db, {})   (services/archive.js default; routes/archive.js when the query has none)
 *
 * Takes:
 *   Months. 12 by default. The page's own default is archiveDefaultOlderThan in
 *   client/src/settings.js; keep them the same.
 *
 * When editing:
 *   After changing: open the Archive page and check the list matches the choice shown.
 */
export const archiveDefaultOlderThan = 12;

/**
 * How many characters of a post's caption a notification quotes to say which post it is
 * ('post 12 ("Join us this Saturday...")').
 *
 * Usage:
 *   postLabel(post)   (services/notifications.js)
 *
 * Takes:
 *   Characters, counting the "..." added when cut. 60 by default.
 *
 * When editing:
 *   Only new notifications change. After changing: check a new notification on the
 *   Notifications page.
 */
export const notificationCaptionChars = 60;
