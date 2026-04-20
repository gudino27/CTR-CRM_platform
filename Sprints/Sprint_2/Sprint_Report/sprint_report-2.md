# Sprint 3 Report (Mar 24, 2026 – Apr, 2026)

## YouTube link of Sprint 3 Video 

https://github.com/gudino27/CTR-CRM_platform/tree/main/Sprints/Sprint_2

## What's New (User Facing)

* Full CRM database live in Baserow: all 16 tables with relationships, lookup fields, and formula-based display names
* Dashboard page with live KPI counts: total seniors, volunteers, teams, and visits this week
* Seniors page: grid view of all senior records with search and filter
* Volunteers page: grid view of all volunteer records
* Groups page: "Propose a Change" form for submitting calendar-affecting change requests (auto-triggers approval workflow)
* Schedule page: weekly meeting instances view showing all scheduled calls for the week
* Meetings page: meeting instances with attendance status tracking
* Feedback page: links to WordPress feedback forms for volunteers and seniors
* Approvals page (admin only): three filtered queues (Pending, Approved, Rejected) plus an "Assign Substitute Volunteer" form
* Role-based navigation: admin users see all 8 pages including Approvals; non-admin staff see 7 pages
* WF1 Google Calendar Sync: creating a MEETING record automatically creates a recurring weekly Google Calendar event and stores the event ID back on the row
* WF9 Approval Gate: submitting a change proposal emails the admin an HTML approval email with Approve/Reject buttons; approving or rejecting updates the record and notifies the proposer
* WF5 Weekly Instance Generator: every Monday at 6 AM, MEETING_INSTANCE and MEETING_ATTENDANCE rows are auto-created for all active teams

## Work Summary (Developer Facing)

Sprint 2 began with a formal architectural pivot. The original project plan called for a custom JavaScript web application (React) with a potential companion mobile app. After the client confirmed a preference for a no-code-maintainable solution, we transitioned at clients request entirely to Baserow App Builder for the frontend. This eliminated the React codebase, but introduced new constraints: Baserow App Builder does not allow custom CSS or JavaScript injection on the free plan, so all styling and interactivity is limited to what the App Builder natively supports. The element library is also restricted (file upload requires a paid license), formula evaluation behaves differently between the grid view and the App Builder runtime, and layout options are more constrained than a custom React UI. Working within those boundaries shaped many of the technical decisions this sprint.

With the architecture settled, Sprint 2 became a full-stack delivery sprint that built and wired the entire CRM end-to-end. We authored a automated Node.js scripts (using the Baserow REST API) to create all 16 database tables with their fields, formula columns, lookup relationships, and link-row joins, removing error-prone manual setup entirely. The biggest technical challenge was navigating undocumented App Builder API behaviors: formula fields returning array-of-objects instead of plain strings caused "[object Object]" to appear in dropdowns throughout the UI, and several element type options required trial-and-error to discover correct field names. On the automation side, three N8N workflows (WF1, WF5, WF9) were built and tested end-to-end. WF9's async approval pattern, using an N8N Wait node to hold execution while the admin clicks Approve or Reject in an email, was a novel design that worked cleanly, completing in under 5 seconds on a development computer once the admin responds. Formula debugging across 12 primary-key fields and thorough end-to-end execution testing (execution # 477 for WF1, # 506 for WF9) validated that the core data and automation layer is production ready.

## Unfinished Work

The following items were not complete at the time of this report but are actively being worked on in the final days of the sprint. WF9 (Approval Gate) needed to be stable before the dependent workflows could proceed, and it was finalized late in the sprint:

* WF2 (Team Member Change): cancel and recreate recurring Google Calendar event when team composition changes; in progress
* WF3 (Instance Cancellation): delete a single calendar occurrence for a cancelled meeting; in progress
* WF4 (Substitution Assignment): patch a single calendar occurrence with a substitute volunteer and send notification; in progress
* WF6 (Pre-Meeting Reminders): daily 8 AM cron to send day-before call reminders; in progress
* WF7 (Monthly Feedback Dispatch): 1st-of-month cron to email feedback form links to volunteers and seniors; in progress
* Hub and spoke Google Calendar architecture (one calendar per volunteer team): design finalized, implementation in progress

The following items are intentionally deferred to future sprints:

* WF8 (WordPress Webhook Import): deprioritized in favor of core calendar and notification workflows; planned for Sprint 4
* PII protection and workspace split for PERSON table: deferred to Sprint 4
* Mobile app: planned for Sprint 6

## Completed Issues/User Stories

Here are links to the issues that we completed in this sprint:

* [Issue 1](https://github.com/gudino27/CTR-CRM_platform/issues/1)  - Create all 16 Baserow CRM tables with fields and relationships
* [Issue 2](https://github.com/gudino27/CTR-CRM_platform/issues/2) - Build Baserow App Builder pages (Dashboard, Seniors, Volunteers, Groups, Schedule, Meetings, Feedback, Approvals)
* [Issue 3](https://github.com/gudino27/CTR-CRM_platform/issues/3) - Add shared navigation header with role-based menus (admin vs. non-admin)
* [Issue 4](https://github.com/gudino27/CTR-CRM_platform/issues/4) - WF1: Google Calendar Sync workflow (create recurring event on MEETING insert)
* [Issue 5](https://github.com/gudino27/CTR-CRM_platform/issues/5) - WF9: Approval Gate workflow (email admin, Wait node, approve/reject, notify proposer)
* [Issue 6](https://github.com/gudino27/CTR-CRM_platform/issues/6)- WF5: Weekly Meeting Instance Generator (cron Monday 6 AM)
* [Issue 7](https://github.com/gudino27/CTR-CRM_platform/issues/7) - Groups page propose-a-change form wired to WF9
* [Issue 8](https://github.com/gudino27/CTR-CRM_platform/issues/8) - Approvals page with filtered queues and Assign Substitute form

## Incomplete Issues/User Stories

Here are links to issues we worked on but did not complete in this sprint:

* [Issue 14](https://github.com/gudino27/CTR-CRM_platform/issues/14) - WF8: WordPress Webhook Import <<Deprioritized in favor of core calendar and notification workflows; planned for Sprint 4>>




## Retrospective Summary

Here's what went well:

* Pivoting to Baserow App Builder eliminated the need for custom React code for most pages, dramatically increasing development time
* The N8N Wait node pattern worked cleanly for the async approval flow in WF9; the design held up under real execution testing
* Automated table and page creation scripts saved enormous time and made the setup fully reproducible; rebuilding from scratch would take minutes, not days
* WF1 and WF9 were both tested end-to-end successfully (executions # 477 and # 506), validating the core automation layer

Here's what we'd like to improve:

* The Baserow App Builder API has significant undocumented behavior (formula fields returning arrays, element option names differing from the UI, uid being required on menu items) that cost multiple days of debugging time
* Formula limitations in Baserow (join() only works on plain-text lookups, not formula or lookup-chained fields) were discovered mid-build; documenting these constraints before starting would prevent rework
* The pivot away from React also meant losing all of sprint ones work as well as the mobile app path.
