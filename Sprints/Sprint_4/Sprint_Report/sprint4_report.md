# Sprint 4 Report (Aug 27th, 2026 - Sept 30th, 2026)

## YouTube link of Sprint 4 Video (Make this video unlisted)
[link](https://youtu.be/AWpj4QhEZNk)
## What's New (User Facing)
* New Social Media Scheduler web app for Conversations to Remember, with Compose, Queue, Schedule and Platforms pages
* Post composer: choose a platform, write a caption and hashtags, and set a priority (Standard, High, or Next)
    * Live character count against the selected platform's limit; submitting is blocked when over the limit
    * Drag-and-drop image upload with preview and alt text; images are stored in the client's Google Drive folder
    * Optional override date; posts normally have no date and take the next open slot
* Platform settings for Facebook, Instagram and LinkedIn: posting days, posting times and Google Calendar event color
* Per-platform queue: edit a queued post, move it up or down, delete it, and requeue posts that failed to send
* Projected schedule with week and month views, color-coded by platform, with a details panel for each post
* Every projected post creates a Google Calendar event in the client's format: Summary = platform name, Description = caption, hashtags and image link, color = the platform's color
* Changing a platform's cadence, a post's priority, or the queue order recalculates the projected dates and updates the calendar events
* Test mode for safe development: events go only to a test calendar, the app clock can be moved forward, a "Test" platform is available, and a banner shows test mode is on
* Posts that come due are sent to a test endpoint that records the payload and checks it against the agreed format, so nothing reaches a live social media account; a dry-run switch logs what would be sent without sending
* A temporary shareable test link (`npm run share`) so the client can try the app without a team server

## Work Summary (Developer Facing)
Sprint 4 began with a pivot after the completion of the CRM to a new Social Media Scheduler, so we first retired the old `code/` folder and scaffolded a new `scheduler/` project. we chose a React + Vite front end and an Express API with SQLite, packaged as one Docker container, because the client needs a simple install on their own server at handoff. The work was split so that Alice built the four React pages and styling against the planned API while Jaime built the backend. The pages were then wired to the live API in the final commit. The hardest part was the scheduling logic: slots are computed in the client's time zone, so posts must stay at the same local time across the daylight saving change, priorities and manual ordering must reflow correctly, and override dates must use up that day's slot. A second lesson came from Google Calendar: the Calendar API allows conditional updates through ETags, so the app sends `If-Match` on every patch and leaves alone any event someone edited by hand in Google Calendar instead of overwriting it. 

## Unfinished Work
* Two-way calendar sync: the app detects when an event was edited by hand in Google Calendar and leaves it alone, but it does not yet read the change back as an override date, or return the post to the library when its event is deleted. Moved to Sprint 5 (Deliverable 2).
* Pause and blackout dates: the projection engine already skips paused platforms and the database has a blackout table, but there is no pause control or blackout editor in the UI yet. Moved to Sprint 5 (Deliverable 1).
* Runway indicator, media library, and image format conversion were not started; they are Sprint 5 Deliverables 3 and 4.
* Publishing trigger to confirm with the client: the Sept 17 consultation described n8n watching Google Calendar to publish, while the current build also sends due posts to an n8n webhook. we will confirm which trigger the client's n8n will use at the Sprint 4 review.
* Posting days and times seeded for each platform are placeholders until the client confirms the current posting schedule.

## Completed Issues/User Stories
Here are links to the issues that we completed in this sprint:
* Deliverable 1 – Application UI and Post Composer: [57b193d](https://github.com/gudino27/CTR-CRM_platform/commit/57b193da2823d92ecf7a00f00d2fec16ecb83135), [e66e437](https://github.com/gudino27/CTR-CRM_platform/commit/e66e437a677c5e2602845625105e243d5c07e63f)
* Deliverable 2 – Platform Configuration and Queue System: [57b193d](https://github.com/gudino27/CTR-CRM_platform/commit/57b193da2823d92ecf7a00f00d2fec16ecb83135), [e66e437](https://github.com/gudino27/CTR-CRM_platform/commit/e66e437a677c5e2602845625105e243d5c07e63f)
* Deliverable 3 – Projected Calendar and Google Calendar Integration: [e789925](https://github.com/gudino27/CTR-CRM_platform/commit/e789925d505a50c48e50dcbd38b54bc1296009ca), [e66e437](https://github.com/gudino27/CTR-CRM_platform/commit/e66e437a677c5e2602845625105e243d5c07e63f)
* Deliverable 4 – Testing / Safe Development Mode: [acaccf3](https://github.com/gudino27/CTR-CRM_platform/commit/acaccf34d5b7ff9d209babfcdfeb100180b6540d), [6d53609](https://github.com/gudino27/CTR-CRM_platform/commit/6d53609e30a7fed30d0b7294261cc92b94678eff), [e66e437](https://github.com/gudino27/CTR-CRM_platform/commit/e66e437a677c5e2602845625105e243d5c07e63f)
* Project scaffolding and removal of the retired CRM code: [acaccf3](https://github.com/gudino27/CTR-CRM_platform/commit/acaccf34d5b7ff9d209babfcdfeb100180b6540d)

## Incomplete Issues/User Stories
Here are links to issues we worked on but did not complete in this sprint:
* Two-way Google Calendar sync: we did not get to reading hand edits back from Google Calendar because making one-way writes safe (ETags, keeping hand-edited events) took longer than planned; it is scheduled for Sprint 5.
* Pause and blackout dates: the backend support exists, but we did not get to the UI because the composer, queue and schedule pages came first for the Sprint 4 demo.

## Code Files for Review
Please review the following code files, which were actively developed during this sprint, for quality:
* [projection.js](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/server/src/services/projection.js)
* [sync.js](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/server/src/services/sync.js)
* [googleCalendar.js](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/server/src/services/googleCalendar.js)
* [posts.js](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/server/src/routes/posts.js)
* [dispatch.js](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/server/src/services/dispatch.js)
* [Composer.jsx](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/client/src/pages/Composer.jsx)
* [Queue.jsx](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/client/src/pages/Queue.jsx)
* [Schedule.jsx](https://github.com/gudino27/CTR-CRM_platform/blob/main/scheduler/client/src/pages/Schedule.jsx)

## Retrospective Summary
Here's what went well:
* Splitting the work between front end and backend let both move in parallel.
* All four Sprint 4 deliverables are working


Here are changes we plan to implement in the next sprint:
* Finish two-way calendar sync, pause and blackout dates, the runway indicator, and the media library
* Confirm the publishing trigger and the real posting schedule with the client at the Sprint 4 review
