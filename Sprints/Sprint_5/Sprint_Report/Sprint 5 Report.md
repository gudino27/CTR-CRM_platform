# Sprint 5 Report (October 1 – October 31, 2026)

## YouTube Link of Sprint 5 Video


## What's New (User Facing)

- **Improved Post Scheduling:** Added Library and Specific Date options. Library posts automatically fill available posting slots based on their post type and color.
- **Calendar Management:** Added a monthly calendar showing scheduled posts, empty slots, and fixed-date posts. Users can manually modify or lock individual posting slots.
- **Post Library:** Added a centralized page for viewing, editing, removing, and requeueing posts, including posts that failed to send.
- **Content Inventory:** Added an inventory dashboard showing available content, empty posting slots, and upcoming posts over the next 14 days.
- **Media Library:** Added searchable image storage, image previews, file information, platform compatibility checks, and image usage tracking.
- **Platform Configuration:** Expanded platform settings to support customizable posting schedules, post types, monthly rotations, and Google Calendar colors.
- **Composer Enhancements:** Added drag-and-drop image uploads, image selection from the media library, character-limit warnings, image alt text, and scheduling-conflict notifications.

## Work Summary (Developer Facing)

During Sprint 5, the team expanded the Social Scheduler from its initial prototype into a more complete content management and scheduling application. Alice focused on developing and refining the React frontend, while Jaime worked on the Node.js backend, SQLite database, scheduling logic, and external service integrations. The team introduced a slot-based scheduling system that organizes content by post type and color, allowing posts to automatically fill matching available slots. The frontend was updated to support this workflow through new Library, Calendar, Inventory, and Media pages. Backend development included persistent post storage, Google Calendar synchronization operations, Google Drive media handling, and scheduler execution. These changes improved the connection between content creation, scheduling, and calendar management while maintaining a safe environment for testing.

## Unfinished Work

The following planned requirements require additional verification or completion:

- **Two-way Google Calendar synchronization:** Confirm that moving or deleting events directly in Google Calendar correctly updates the associated posts.
- **Pause and blackout functionality:** Verify that all planned scheduling restrictions are available and operate correctly.
- **Live post preview:** Image previews and character warnings are implemented, but a complete social-platform-style post preview has not been confirmed.
- **Integration testing:** Complete end-to-end verification using the client's Google services and existing publishing workflow.


## Code Files for Review

The following files represent key areas of Sprint 5 development:

- `client/src/pages/Composer.jsx` — Post creation, media uploads, and scheduling options.
- `client/src/pages/Library.jsx` — Post library and failed-post management.
- `client/src/pages/Calendar.jsx` — Monthly calendar and slot management.
- `client/src/pages/Inventory.jsx` — Content availability and upcoming schedules.
- `client/src/pages/Media.jsx` — Media library and image validation.
- `client/src/pages/Platforms.jsx` — Platform schedules and post-type configuration.
- `server/.../projection.js` — Scheduling projection logic.
- `server/.../sync.js` — Schedule synchronization.
- `server/.../googleCalendar.js` — Google Calendar integration.
- `server/.../googleDrive.js` — Google Drive integration.

[Replace file paths with verified GitHub links.]

## Retrospective Summary

**Here's what went well:**

- The frontend and backend were expanded to support a more complete scheduling workflow.
- Reusable React components helped maintain consistent behavior across pages.
- Separating scheduling, media handling, and external integrations into individual modules improved code organization.
- Test mode provided a safer environment for developing scheduling features.

**Here's what we'd like to improve:**

- Increase end-to-end testing of Google Calendar and Google Drive integrations.
- Verify scheduling behavior in more complex scenarios, including calendar conflicts and failed posts.
- Improve documentation so the application is easier for the client to configure and maintain.

**Here are changes we plan to implement in the next sprint:**

- Complete remaining integration testing and resolve identified defects.
- Prepare Docker deployment and client-server configuration.
- Finalize technical documentation and update the GitHub README.
- Conduct client acceptance testing and prepare the final demonstration and handoff.