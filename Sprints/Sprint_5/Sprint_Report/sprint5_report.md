# Sprint 5 Report (Oct 1st, 2026 - Oct 31st, 2026)

## YouTube link of Sprint 5 Video (Make this video unlisted)
[link](https://youtu.be/sY_aCdxWlYM)
## What's New (User Facing)
* Library scheduling replaces the priority queue: Standard, High and Next are gone, and each post is now either a Library post or a Specific Date post
    * Library posts have a post type and a color, have no date, and fill the next matching empty slot, oldest first
    * Specific Date posts have a date and time, and automation never moves them
* Each platform has its own monthly blueprint built from its posting days and times
    * Slots alternate Blue and Purple on Instagram and Facebook, and the pattern carries across months; LinkedIn has no color
    * Post types rotate automatically, using the client's types for each platform
* New Calendar page with a month grid per platform, showing filled, empty, blocked and Specific Date slots
    * Click a slot to change its post type or color, choose exactly which post goes there, or lock it
* New Library page showing what is waiting, what is scheduled, and what failed to send, with a Requeue button for failed posts
    * Posts can be edited here, including changing the date of a post that went on the wrong day
* More than one post can go out on the same day; Specific Date posts within 2 hours of each other show a warning, a suggested time, and a "Schedule anyway" option
* Post types are editable: add one from Compose or Platforms, rename it, and choose whether it is in the monthly rotation
    * A Holiday type is included on every platform for Specific Date posts only
* New Inventory page that serves as the runway indicator: posts waiting against empty slots for each post type and color, with low stock in red, plus the next 14 days
* New Media page and a media picker in Compose: search uploaded images, view their previews and file information, see which posts use them, and reuse them
* Images are checked against each platform's rules, with a warning before posting (for example, a PNG on Instagram)

## Work Summary (Developer Facing)
Alice focused on developing and refining the React frontend, while Jaime worked on the Node.js backend, SQLite database, scheduling logic and external service integrations. The main change this sprint came from the social media manager's requirements and answers: the client's process is built around a monthly blueprint and a library of posts, not a priority queue. We replaced the queue instead of adding to it. Migrations added the `postType` and `slot` tables, added `kind`, `postTypeId`, `color` and `fixedAt` to posts, and removed priority, override date and queue position. We showed a clickable mockup first to confirm our understanding, then built the model into the real app and demoed it to the client on Oct 23. The hardest design rule was avoiding a domino effect: slot assignments are stored, so adding or removing a post only fills empty slots and never shifts other posts. Holding the Blue/Purple and post type patterns steady across months also took care, so the patterns are anchored to the first slot of 2026 rather than restarting each month. Late in the sprint we removed the unused CSS left from the old Schedule page and moved all colors into shared variables, and confirmed by comparing computed styles on every page that nothing changed on screen. Our access to the client's Google Workspace was removed during the sprint, which blocked live Google testing, so Calendar and Drive code is covered only by automated tests with fake clients. All 56 automated tests pass.

## Unfinished Work
* Two-way calendar sync: the app still only writes to Google Calendar. Reading a moved event back as a date change, and returning a post to the library when its event is deleted, are not built. Moved to Sprint 6.
* Live Google testing: Calendar and Drive have not been run against a real Google account since our Workspace access was removed. We plan to test on a personal Google developer project, then hand the setup to the client.
* End-to-end testing: the full workflow has not been verified with the client's Google services and existing n8n publishing workflow. This includes what happens to posts already on Google Calendar when posting days change.
* Pause: the backend skips paused platforms, but there is no pause control in the UI yet.
* Blackout dates: the database table exists, but there is no API, UI or scheduling logic yet.
* Live post preview: Compose shows the image preview and the character count, but not a full preview of the post.
* Requests from the Oct 23 client meeting, planned for Sprint 6:
    * Compose: move Post Type and Color under Platform, mark required fields, make image required, and remove or hide the hashtag field
    * Images: convert all uploads to JPEG automatically, and allow deleting old images
    * Scheduling: user-defined repeating schedules (such as every other week, and LinkedIn's newsletter pattern), and changing one slot or all later slots
    * Calendar: add a holiday from the slot panel, and edit the full post there
    * Inventory: show which months the counts cover
    * Access: login with admin and regular roles, and a record of who edited what
    * Database: decide between MariaDB and SQLite with Robert

## Completed Issues/User Stories
Here are links to the issues that we completed in this sprint:
* Deliverable 1: Complete Queue and Scheduling (scheduling, overrides and Specific Date posts; priority was replaced by the library model at the client's request): [54f86f3](https://github.com/gudino27/CTR-CRM_platform/commit/54f86f3992d2ed7a7971843ce9b80092a28fecd3)
* Deliverable 3:Media and Composer Enhancements (media library, image format checks and character warnings): [54f86f3](https://github.com/gudino27/CTR-CRM_platform/commit/54f86f3992d2ed7a7971843ce9b80092a28fecd3)
* Deliverable 4:Runway and Platform Management Features (Inventory page, post type management, cadence changes regenerate future slots): [54f86f3](https://github.com/gudino27/CTR-CRM_platform/commit/54f86f3992d2ed7a7971843ce9b80092a28fecd3)

## Incomplete Issues/User Stories
Here are links to issues we worked on but did not complete in this sprint:
* Deliverable 1: Pause and blackout dates: we did not finish these because replacing the queue with the library model took priority after the client's answers.
* Deliverable 2: Google Calendar Synchronization: changes in the app update events, but two-way sync was not built, and live testing was blocked when  Workspace access was removed.
* Deliverable 3: Live post preview and Drive verification: the full post preview was not built, and Drive upload has not been verified against a real account in this sprint.

## Code Files for Review
Please review the following code files, which were actively developed during this sprint, for quality:
* [projection.js](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/server/src/services/projection.js)
* [sync.js](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/server/src/services/sync.js)
* [views.js](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/server/src/services/views.js)
* [imageRules.js](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/server/src/services/imageRules.js)
* [googleCalendar.js](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/server/src/services/googleCalendar.js)
* [googleDrive.js](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/server/src/services/googleDrive.js)
* [posts.js](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/server/src/routes/posts.js)
* [slots.js](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/server/src/routes/slots.js)
* [inventory.js](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/server/src/routes/inventory.js)
* [Composer.jsx](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/client/src/pages/Composer.jsx)
* [Library.jsx](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/client/src/pages/Library.jsx)
* [Calendar.jsx](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/client/src/pages/Calendar.jsx)
* [Inventory.jsx](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/client/src/pages/Inventory.jsx)
* [Media.jsx](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/client/src/pages/Media.jsx)
* [Platforms.jsx](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/client/src/pages/Platforms.jsx)

## Retrospective Summary
Here's what went well:
* Asking the social media manager detailed questions early exposed that the queue did not match their process
* The clickable mockup confirmed the library model before we built it
* The live demo on Oct 23 produced a clear list of changes for Sprint 6
* The automated test suite grew with the new model, and all 56 tests pass
* Reusable React components helped keep behavior consistent across pages
* Keeping scheduling, media handling and external integrations in separate modules improved code organization
* Test mode gave us a safe environment for developing scheduling features

Here's what we'd like to improve:
* Confirm the client's process earlier, before building scheduling logic that may need replacing
* Line up a Google test account early, so losing outside access doesn't block live testing
* Test more complex scheduling scenarios end to end, including calendar conflicts and failed posts
* Improve documentation so the application is easier for the client to configure and maintain

Here are changes we plan to implement in the next sprint:
* Set up a Google developer project and test Calendar and Drive live, then finish two-way sync
* Finish pause and blackout dates, and the client's Oct 23 requests
* Confirm the database and login approach with Robert
* Fix the defects found in integration testing, and prepare the Docker deployment on the client's server
* Finalize the technical documentation and README
* Run client acceptance testing, then the final demonstration and handoff
