/**
 * Values you may want to change. Each one says what it affects, its unit, and what to check
 * after changing it.
 *
 * Values set per server live in .env, see server/src/config.js; every one of them (name, what
 * it does, default, example) is listed in the README under "Server settings (.env)": the time
 * zone, session timeouts, Google IDs and the rest. The server's own tunables (image rules,
 * JPEG quality, the 2-hour collision window, sync intervals, ...) are here
 * What lives here:
 *   previewFeeds, previewOtherFeed  how the Compose/Library preview crops the image and cuts
 *                                   the caption, per platform (Instagram 4:5 / 1.91:1 feed,
 *                                   3:4 profile grid; "... more" points per device)
 *   notificationPollMs              how often the bell asks for the unread count
 *   sessionWarningSeconds           how early the "you will be signed out" warning shows
 *   mediaPageSize                   images per page in the media picker and Media page
 *   mediaSearchDelayMs              pause in typing before the media search runs
 *   inventoryMonths                 months the Inventory page counts
 *   inventoryBriefDays              days the Inventory page's "Next 14 days" list covers
 *   archiveOlderThan                the Archive page's "Older than" choices and labels
 *   archiveDefaultOlderThan         which of those is picked when the page opens
 *   archivePageSize                 posts per page on the Archive page
 *   archiveCaptionChars             how much of a caption each Archive row shows
 *   activityPageSize                entries per page on the Activity page
 */

/**
 * How each platform's feed shows a post in the preview (components/PostPreview.jsx):
 * where it cuts the caption with "... more", how it crops the image, and the account name.
 * The platforms do not publish their cut-off points: their apps cut by lines on screen, so
 * the point moves with screen width. These are the figures most guides agree on, for a
 * phone and for a computer; all of them are approximate.
 *   Instagram: about 125 characters on both.
 *   Facebook: about 125 on a phone, about 480 on a computer.
 *   LinkedIn: about 140 on a phone, about 210 on a computer, and never more than 3 lines.
 *
 * Usage:
 *   previewFeeds[platform.key] ?? previewOtherFeed   (PostPreview.jsx)
 *
 * Takes:
 *   One entry per platform key (platform.key: instagram, facebook, linkedin):
 *   chars        - characters shown before "... more", per device ({ phone, computer }),
 *                  or null to show the whole caption. Emoji count as one.
 *   lines        - line breaks shown before "... more", or null for no line limit
 *   tallest      - the tallest image shape the feed shows, as width / height (4 / 5);
 *                  taller images are center-cropped to it. null = no limit.
 *   widest       - the widest shape, as width / height (1.91); wider images are cropped. null = no limit.
 *                  Between tallest and widest the image shows uncropped.
 *   gridTile     - the profile grid's tile shape, width / height (3 / 4), shown as a second
 *                  "Profile grid" view; null = no grid view
 *   captionFirst - true: the caption sits above the image (Facebook, LinkedIn);
 *                  false: under it (Instagram)
 *   account      - the name shown at the top of the post
 *
 * When editing:
 *   The preview only. What the server warns about (file type, size, the 4:5 / 1.91:1
 *   limits) is imageRules in server/src/settings.js; keep the Instagram shapes in step.
 *   The Instagram view also puts the account name in bold before the caption, as Instagram does.
 *   After changing: rebuild the client (npm run build -w client), open Compose, pick each
 *   platform and use "Preview post" with a tall, a wide and a square image and a long
 *   caption, on both "Phone" and "Computer".
 */
export const previewFeeds = {
  instagram: {
    chars: { phone: 125, computer: 125 }, lines: null, tallest: 4 / 5, widest: 1.91, gridTile: 3 / 4, captionFirst: false,
    account: "conversations.to.remember",
  },
  facebook: { chars: { phone: 125, computer: 480 }, lines: null, tallest: null, widest: null, gridTile: null, captionFirst: true, account: "conversations.to.remember" },
  linkedin: { chars: { phone: 140, computer: 210 }, lines: 3, tallest: null, widest: null, gridTile: null, captionFirst: true, account: "conversations.to.remember" },
};

/**
 * The preview for any platform not in previewFeeds (the Test platform): the whole caption
 * and the image at its own shape. Same fields as previewFeeds.
 *
 * Usage:
 *   previewFeeds[key] ?? previewOtherFeed   (PostPreview.jsx)
 *
 * When editing:
 *   After changing: rebuild the client and preview a post on the Test platform (test mode).
 */
export const previewOtherFeed = { chars: null, lines: null, tallest: null, widest: null, gridTile: null, captionFirst: true, account: "conversations.to.remember" };

/**
 * How often the bell in the header asks the server for the unread notification count.
 * It also asks on every page change and right after the Notifications page changes something.
 *
 * Usage:
 *   setInterval(load, notificationPollMs)   (components/NotificationBell.jsx)
 *
 * Takes:
 *   Milliseconds. 60_000 = 1 minute. Each check is one request per open browser tab.
 *
 * When editing:
 *   The server makes failed-post notifications on its own interval (notificationScanMs in
 *   server/src/settings.js). After changing: rebuild the client, mark a notification unread
 *   (or let a post fail) and time how long the bell's count takes to change.
 */
export const notificationPollMs = 60_000;

/**
 * How long before the idle timeout the page warns that the user is about to be signed out
 * (with a "Stay signed in" button). The timeout itself is SESSION_IDLE_MINUTES in .env.
 *
 * Usage:
 *   if (left > sessionWarningSeconds) ...   (App.jsx)
 *
 * Takes:
 *   Seconds. 120 = 2 minutes. Keep it shorter than the idle timeout.
 *
 * When editing:
 *   After changing: rebuild the client, sign in, leave the page idle
 *   and check when the warning appears.
 */
export const sessionWarningSeconds = 120;

/**
 * Images loaded per page in the media picker (Compose, Library) and on the Media page;
 * "Show more" fetches the next page.
 *
 * Usage:
 *   new URLSearchParams({ limit: String(mediaPageSize), offset })   (components/MediaPicker.jsx)
 *
 * Takes:
 *   Images. 48 by default (a multiple of 2, 3, 4 and 6, so grid rows come out full).
 *
 * When editing:
 *   GET /api/media sends at most 200 per page, whatever is asked.
 *   After changing: rebuild the client and open the Media page and the Compose image picker;
 *   check the grid and "Show more".
 */
export const mediaPageSize = 48;

/**
 * Pause in typing before the media search runs, so it does not search on every key.
 *
 * Usage:
 *   setTimeout(() => setSearch(searchText.trim()), mediaSearchDelayMs)   (components/MediaPicker.jsx)
 *
 * Takes:
 *   Milliseconds. 250 by default.
 *
 * When editing:
 *   After changing: rebuild the client and type in the Media page's search box.
 */
export const mediaSearchDelayMs = 250;

/**
 * Months the Inventory page counts, starting with the app's current month.
 *
 * Usage:
 *   api.inventory(inventoryMonths)   (pages/Inventory.jsx)
 *
 * Takes:
 *   Months. 2 by default.
 *
 * When editing:
 *   The brief's "running low" list counts its own months (briefLowStockMonths in
 *   server/src/settings.js). GET /api/inventory refuses more than 12.
 *   After changing: rebuild the client and open the Inventory page; check the months named.
 */
export const inventoryMonths = 2;

/**
 * Days the Inventory page's list of what goes out next covers (the weekly brief's data).
 *
 * Usage:
 *   api.brief(inventoryBriefDays)   (pages/Inventory.jsx)
 *
 * Takes:
 *   Days. 14 by default.
 *
 * When editing:
 *   The page heading says "Next 14 days" in words (pages/Inventory.jsx); update it to match.
 *   GET /api/brief refuses more than 90.
 *   After changing: rebuild the client and open the Inventory page; check the list's last day.
 */
export const inventoryBriefDays = 14;

/**
 * The "Older than" choices on the Archive page, in the order shown. months 0 = any age.
 *
 * Usage:
 *   archiveOlderThan.map(({ months, label }) => <option ...>)   (pages/Archive.jsx)
 *
 * Takes:
 *   [{ months, label }] - whole months and the words shown for them.
 *
 * When editing:
 *   The server accepts only the months in archiveOlderThanChoices (server/src/settings.js);
 *   keep both lists the same, or the page offers a choice the server refuses.
 *   After changing: rebuild the client, open the Archive page and pick each choice.
 */
export const archiveOlderThan = [
  { months: 3, label: "3 months" },
  { months: 6, label: "6 months" },
  { months: 12, label: "1 year" },
  { months: 24, label: "2 years" },
  { months: 36, label: "3 years" },
  { months: 0, label: "Any age" },
];

/**
 * The "Older than" choice picked when the Archive page opens. Must be one of the months in
 * archiveOlderThan.
 *
 * Usage:
 *   useState(archiveDefaultOlderThan)   (pages/Archive.jsx)
 *
 * Takes:
 *   Months. 12 by default, the same as the server's archiveDefaultOlderThan; keep them equal.
 *
 * When editing:
 *   After changing: rebuild the client and open the Archive page.
 */
export const archiveDefaultOlderThan = 12;

/**
 * Posts loaded per page on the Archive page ("Show more" fetches the next page).
 *
 * Usage:
 *   api.archive({ ...filters, limit: archivePageSize })   (pages/Archive.jsx)
 *
 * Takes:
 *   Posts. 100 by default.
 *
 * When editing:
 *   The server sends at most 500 per page. After changing: rebuild the client, open the
 *   Archive page and use "Show more".
 */
export const archivePageSize = 100;

/**
 * How many characters of a caption each Archive row shows before "...".
 *
 * Usage:
 *   snippet(post.caption)   (pages/Archive.jsx uses it as the default length)
 *
 * Takes:
 *   Characters. 120 by default.
 *
 * When editing:
 *   After changing: rebuild the client and look at long captions on the Archive page.
 */
export const archiveCaptionChars = 120;

/**
 * Entries loaded per page on the Activity page ("Load older" fetches the next page).
 *
 * Usage:
 *   api.activity({ ...filters, limit: activityPageSize })   (pages/Activity.jsx)
 *
 * Takes:
 *   Entries. 100 by default.
 *
 * When editing:
 *   The server sends at most 500 per page. After changing: rebuild the client, open the
 *   Activity page and use "Load older".
 */
export const activityPageSize = 100;


/**
 * How long the Specific Date color suggestion waits after the date or time changes before it
 * asks the server, so typing a date does not send a request per key.
 *
 * Usage:
 *   setTimeout(ask, suggestColorDelayMs)   (components/SuggestedColor.jsx)
 *
 * Takes:
 *   Milliseconds. 250 by default.
 *
 * When editing:
 *   After changing: rebuild the client, pick a date in Compose (Specific Date) on Instagram and
 *   check the color is preselected with the "Suggested so the colors keep alternating" note.
 */
export const suggestColorDelayMs = 250;
