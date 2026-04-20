# CTR CRM Platform -- Design and Technical Documentation

**Project:** Conversations to Remember -- CRM Platform  
**Status:** Partially complete (Sprint 3 of 4)  
**Prepared by:** Development Team  
**Last updated:** April 2026

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Architecture](#2-architecture)
3. [Database Schema](#3-database-schema)
4. [N8N Automation Workflows](#4-n8n-automation-workflows)
5. [Web Application Pages](#5-web-application-pages)
6. [Credentials and Configuration](#6-credentials-and-configuration)
7. [Deployment and Migration](#7-deployment-and-migration)
8. [Troubleshooting Reference](#8-troubleshooting-reference)

---

## 1. System Overview

The CTR CRM Platform is a web-based CRM built to manage senior participants, volunteers, team assignments, weekly meeting schedules, and feedback collection for Conversations to Remember.

The system is built entirely on open-source, self-hostable tools with no per-seat licensing costs.

**Core functions:**
- Maintain records for seniors, volunteers, teams, and meetings
- Automatically create and manage Google Calendar events for volunteer teams
- Track weekly meeting instances and attendance
- Handle substitutions, cancellations, and team roster changes
- Route proposed schedule changes through an approval workflow before applying them
- Collect and store volunteer and senior feedback
- Provide a staff-facing web application with role-based access

---

## 2. Architecture

### Components

| Component | Role | Hosted At |
|-----------|------|-----------|
| Baserow (database) | All CRM data storage | baserow.conversationstoremember.org |
| Baserow App Builder | Staff-facing web application | TBD  |
| N8N | Workflow automation | Local instance (migration to client instance pending) |
| Google Calendar API | Volunteer-facing calendar events | Via Google Cloud project |
| Google SMTP | Automated email notifications | TBD |

### Data Flow Summary

```
Staff (App Builder) --> Baserow Tables --> N8N Webhooks (on row create/update)
                                               |
                              +----------------+----------------+
                              |                |                |
                    Google Calendar API    Baserow API     SMTP Email
                    (events, patches)   (row updates)   (notifications)
```

Baserow row-level webhooks trigger N8N workflows when specific table changes occur. N8N then calls the Google Calendar API and/or writes back to Baserow to complete the automation.

---

## 3. Database Schema

**Database ID:** 107 (hosted Baserow instance)  
All tables reside in a single database named CTR-CRM.

### Table Overview

| Table | ID | Purpose |
|-------|----|---------|
| PERSON | 556 | Base record for every individual (senior or volunteer) |
| SENIOR_COMMUNITY | 554 | Community/facility where a senior resides |
| SENIOR | 558 | Senior participant, linked to a PERSON record |
| VOLUNTEER | 561 | Volunteer, linked to a PERSON record |
| VOLUNTEER_TEAM | 563 | A team assignment linking one senior to one or more volunteers |
| TEAM_MEMBER | 564 | Individual volunteer's membership on a VOLUNTEER_TEAM |
| MEETING | 565 | Recurring meeting template for a team (day, time, calendar IDs) |
| MEETING_INSTANCE | 566 | Individual occurrence of a meeting (date, status, attendance) |
| MEETING_ATTENDANCE | 567 | Per-volunteer attendance record for a meeting instance |
| PROPOSED_CHANGE | 568 | Pending calendar change request awaiting director approval |
| VOLUNTEER_STATUS_NOTE | 569 | Notes on a volunteer's status or availability |
| VOLUNTEER_FEEDBACK | 730 | Feedback submitted by a volunteer after a meeting |
| SENIOR_FEEDBACK | 731 | Feedback submitted by or on behalf of a senior |
| SENIOR_IMPACT | 732 | Impact assessment responses for a senior |

### Key Relationships

```
PERSON (1) <-- (1) SENIOR --> (many) VOLUNTEER_TEAM (via senior field)
PERSON (1) <-- (1) VOLUNTEER --> (many) TEAM_MEMBER
VOLUNTEER_TEAM (1) --> (many) TEAM_MEMBER --> (1) VOLUNTEER
VOLUNTEER_TEAM (1) --> (1) MEETING --> (many) MEETING_INSTANCE --> (many) MEETING_ATTENDANCE
MEETING_INSTANCE (1) --> (many) VOLUNTEER_FEEDBACK
MEETING_INSTANCE (1) --> (many) SENIOR_FEEDBACK
PROPOSED_CHANGE --> MEETING_INSTANCE (optional, for instance-specific changes)
```

### PERSON Table (ID 556)

| Field | Type | Notes |
|-------|------|-------|
| first_name | Text | |
| last_name | Text | |
| email | Email | |
| phone | Phone | |
| role | Single Select | senior, volunteer, staff |
| status | Single Select | active, inactive, pending |
| timezone | Single Select | America/New_York, America/Chicago, etc. |

### MEETING Table (ID 565) -- Key Fields

| Field | Type | Notes |
|-------|------|-------|
| team | Link to VOLUNTEER_TEAM | |
| meeting_day_of_week | Single Select | Monday through Sunday |
| meeting_time | Text | HH:MM format |
| meeting_link | URL | Video call link |
| calendar_event_id | Text | Google Calendar recurring event ID |
| google_calendar_id | Text | Calendar ID the event lives on |

### MEETING_INSTANCE Table (ID 566) -- Key Fields

| Field | Type | Notes |
|-------|------|-------|
| meeting | Link to MEETING | |
| instance_date | Date | |
| instance_status | Single Select | scheduled, completed, canceled, no-show |
| substitute_volunteer | Link to VOLUNTEER | Optional, set when a substitution occurs |

---

## 4. N8N Automation Workflows

All workflows are imported from JSON files located in `code/n8n/`.

### WF1 -- Calendar Sync (Meeting Created)

**File:** `wf1-calendar-sync.json`  
**Trigger:** Baserow webhook on MEETING table row creation  
**N8N Workflow ID:** `iEus61U7SzQf537I`

**What it does:**  
When a new MEETING record is created, this workflow creates a recurring weekly Google Calendar event on the team's calendar. The event includes the senior's name, community, volunteer names, and meeting link. After creation, the event ID is written back to the MEETING record.

**Node sequence:**
```
Webhook --> Parse Payload --> Get Team --> Get Senior --> Get Community
--> Get Active Members --> Build Event Data --> Create Calendar Event
--> Save Event ID --> (end)
```

**Key outputs:**
- Google Calendar recurring event created
- MEETING.calendar_event_id updated
- MEETING.google_calendar_id updated

---

### WF2 -- Team Member Change

**File:** `wf2-team-member-change.json`  
**Trigger:** Baserow webhook on TEAM_MEMBER row update (when end_date is set)  
**N8N Workflow ID:** `QsVT96p4uNzkHEUA`

**What it does:**  
When a team member's departure date is set, this workflow ends the existing Google Calendar recurring event at the day before the departure date (preserving calendar history), then creates a new recurring event starting from the departure date with the updated team roster. After creation, it re-applies any already-cancelled or substituted exceptions in Baserow to the new event series.

**Node sequence:**
```
Webhook --> Parse Change --> End Date Just Set? (branch)
--> Get Team --> Get Senior --> Get Community --> Get Meeting
--> Compute Departure Info --> End Old Event (PATCH with RRULE UNTIL)
--> Get Active Members --> Build Event Data --> Create Calendar Event
--> Save Event ID --> Get Future Exceptions --> Reapply Cancelled Exceptions
--> Notify Director
```

**Key behaviors:**
- Old event is patched with UNTIL date rather than deleted, preserving past occurrences on the calendar
- New event starts on the first occurrence of the meeting day on or after the departure end_date
- Cancelled and substituted instances after the departure date are re-applied to the new event
- Director receives an email notification when the calendar is rebuilt

---

### WF3 -- Instance Cancellation

**File:** `wf3-instance-cancellation.json`  
**Trigger:** Baserow webhook on MEETING_INSTANCE row update (status changed to canceled)  
**N8N Workflow ID:** `59tDFMWT7ofZeyy2`

**What it does:**  
When a meeting instance is marked as canceled, this workflow patches that specific Google Calendar occurrence with a cancellation title in the format `"MM/DD/YY Call Canceled -- [original title]"`. The event remains on the volunteer's calendar so they can see it was planned but canceled. A cancellation email is also sent to all volunteers on that team.

**Node sequence:**
```
Webhook --> Parse Webhook --> Status Changed to Canceled? (guard)
--> Get Instance --> Extract Instance --> Get Meeting
--> Get Calendar Occurrences --> Build Cancel Title
--> Patch Occurrence Canceled --> Get Attendances
--> Split Attendees --> Get Volunteer --> Extract Person ID
--> Get Person Email --> Build Cancel Email --> Send Cancellation Email
--> Update Instance Status
```

---

### WF4 -- Substitution Handling

**File:** `wf4-substitution-handling.json`  
**Trigger:** Baserow webhook on MEETING_INSTANCE row update (substitute volunteer set)  
**N8N Workflow ID:** `yw1M1J5wQffS26rP`

**What it does:**  
When a substitute volunteer is assigned to a meeting instance, this workflow patches the Google Calendar occurrence to reflect the substitution in the event title. The absent volunteer's occurrence is also updated to note their absence. The substitute receives a notification email and the director is copied.

---

### WF5 -- Weekly Meeting Instance Generator

**File:** `wf5-weekly-instance-generator.json`  
**Trigger:** Weekly cron (Monday morning)  
**N8N Workflow ID:** `QmVAo6sTLOflaeFt`

**What it does:**  
Every week, this workflow fetches all active MEETING records and generates a MEETING_INSTANCE row for each one for the upcoming week. It also creates a MEETING_ATTENDANCE row for each active team member linked to that instance. This provides the internal tracking layer that the calendar does not.

---

### WF6 -- Pre-Meeting Reminder

**File:** `wf6-pre-meeting-reminder.json`  
**Trigger:** Daily cron  
**N8N Workflow ID:** `7UILTcCuPbI0a5pQ`

**What it does:**  
Each day, this workflow queries for MEETING_INSTANCE records scheduled for that day and sends a reminder email to all volunteers on the team, including the meeting link and senior details.

---

### WF7 -- Monthly Feedback Dispatch

**File:** `wf7-monthly-feedback-dispatch.json`  
**Trigger:** Cron on the 1st of each month  
**N8N Workflow ID:** `pZ24lHHhSsO8TO7r`  
**Status: Deactivated** (pending client decision on timing)

**What it does:**  
On the 1st of each month, dispatches feedback form links to volunteers and senior coordinators via email.

---

### WF8 -- WordPress/Webhook Import

**File:** `wf8-wordpress-import.json`  
**Trigger:** Webhook POST to `/wf8-import`  
**N8N Workflow ID:** `DTvxdO1ystCpWwvY`

**What it does:**  
Receives a JSON payload from an external source (originally scoped for WordPress, now a general-purpose import endpoint). Creates a PERSON record, then creates and links the corresponding SENIOR or VOLUNTEER record based on the role field in the payload.

---

### WF9 -- Approval Gate

**File:** `wf9-approval-gate.json`  
**Trigger:** Webhook POST from App Builder Approvals page  
**N8N Workflow ID:** `ZWb7c4a4TOtLuSHL`

**What it does:**  
When a director approves or rejects a PROPOSED_CHANGE record, this workflow applies the approved change (cancellation, substitution, reschedule, or team change) by triggering the appropriate downstream workflow, then updates the PROPOSED_CHANGE record with the decision.

---

### WF10 -- iCal Feed

**File:** `wf10-ical-feed.json`  
**Trigger:** Webhook GET (returns iCal formatted response)  
**N8N Workflow ID:** `9tZQFBKop1Gq1Ezu`

**What it does:**  
Generates a live iCal feed for a given team's meeting schedule. Can be subscribed to by calendar clients as a read-only calendar URL.

---

## 5. Web Application Pages

The staff-facing web application is built using Baserow App Builder (. It is accessible without a Baserow database account. All pages require staff login except pages configured for anonymous access.

**Application URL:** TBD (DNS record pending)

### Page Overview

| Page |  Path | Purpose |
|------|------|---------|
| Dashboard |  /dashboard | KPI summary: active seniors, volunteers, teams, visits this month |
| Seniors |  /seniors | Senior records list and Create Senior form |
| Volunteers |  /volunteers | Volunteer records list and Create Volunteer form |
| Teams |  /teams | VOLUNTEER_TEAM records, TEAM_MEMBER records, Add New Team form, Add Team Member form |
| Groups |  /groups | Round-robin rotation scheduling view |
| Schedule |  /schedule | Weekly meeting grid |
| Meetings |  /meetings | MEETING_INSTANCE list and Create Meeting form |
| Feedback |  /feedback | Feedback submission links and review table |
| Approvals |  /approvals | PROPOSED_CHANGE queue with approve/reject actions |

### Navigation

Two shared navigation menus are configured on the shared page :
- Menu 1: All pages except Approvals (for general logged-in staff)
- Menu 2: All pages including Approvals (for admin role only)

### Create/Edit Forms

All create forms follow the same submission pattern. Role-linked records (Senior, Volunteer) use a two-step create: first a PERSON record is created, then the role record is created and linked back to the PERSON. This ensures all individuals share a common base identity.

| Form | Action Count | Pattern |
|------|-------------|---------|
| Create Senior |  3 | Create PERSON, Create SENIOR, Link SENIOR.person |
| Create Volunteer |  3 | Create PERSON, Create VOLUNTEER, Link VOLUNTEER.person |
| Add New Team |  1 | Create VOLUNTEER_TEAM |
| Add Team Member |  1 | Create TEAM_MEMBER |
| Create Meeting |  1 | Create MEETING (triggers WF1 automatically) |

---

## 6. Credentials and Configuration

The following credentials must be configured on the N8N instance before workflows can run.

### Google Calendar (OAuth 2.0)

**Credential type in N8N:** Google Calendar OAuth2 API  
**Required fields:** Client ID, Client Secret (from Google Cloud project)  
**Scope required:** `https://www.googleapis.com/auth/calendar`  
**Setup steps:**
1. Create a project in Google Cloud Console
2. Enable the Google Calendar API
3. Create an OAuth 2.0 Client ID (application type: Web Application)
4. Add the N8N callback URL as an authorized redirect URI
5. Copy Client ID and Client Secret into the N8N credential
6. Complete the browser-based OAuth consent as the Google account that owns the team calendars

**Used by:** WF1, WF2, WF3, WF4

### SMTP Email

**Credential type in N8N:** SMTP  
**Used account:** TBD  
**Used by:** WF2, WF3, WF4, WF6, WF7

### Baserow API Token

**Used as:** Bearer token in HTTP request headers  
**Value:** Configured directly in workflow HTTP Request nodes (not as an N8N credential)  
**Token must have:** Read and write access to database 107 (already configured in workflows)  
**Used by:** All workflows that read or write Baserow data

---

## 7. Deployment and Migration

### Migrating N8N Workflows to Client Instance

1. Export each workflow from the current N8N instance as a JSON file (all files are in `code/n8n/`)
2. Import each JSON into the client N8N instance via Workflows > Import from file
3. Set up the three credentials listed in Section 6 on the client instance
4. Update the Baserow webhook URLs in Baserow (Settings > Webhooks) to point to the new N8N instance URLs
5. Activate each workflow
6. Test with a known record change (e.g., create a new MEETING to trigger WF1)

### DNS Configuration for App Builder

To publish the app at `tbd`':
1. In your DNS provider, create a CNAME record:
   - Name: `tbd`
   - Value: `conversationstoremember.org`
2. Staff can then access the app at `tbd` with their staff credentials

### Webhook Onboarding Endpoint

To import new senior or volunteer records from an external system:
- Send a POST request to the WF8 webhook endpoint on the N8N instance
- Payload must include: first_name, last_name, email, phone, role (senior or volunteer), timezone
- N8N will create the PERSON record and the linked role record automatically
- Recommended: send to N8N first rather than directly to Baserow, so data can be validated and normalized before insertion

---

## 8. Troubleshooting Reference

### Workflow fires but calendar event is not created

- Confirm the Google Calendar OAuth credential has not expired. Re-authorize if needed.
- Check that the MEETING record has a valid team linked with an active google_calendar_id.
- Check N8N execution log for the specific error node.

### Row created in Baserow but workflow did not trigger

- Confirm the webhook in Baserow (Settings > Webhooks) is active and pointing to the correct N8N URL.
- Confirm the workflow is set to Active in N8N.
- Check that the webhook event type matches (row created vs. row updated).

### Calendar event created but event ID not saved back to Baserow

- Check the Save Event ID node in WF1. It writes to the MEETING table using the Baserow row ID from the webhook payload.
- Confirm field_6978 (calendar_event_id) is the correct field ID on the target instance.

### Form submission in App Builder fails with "request invalid"

- Check the workflow action field mappings. Link-row fields require values wrapped in to_array().
- Single select fields require exact lowercase string values in expert mode formulas.
- Confirm the data source used in the form's record selectors is correctly configured.

### Approval workflow does not apply the change

- Confirm WF9 is active and the webhook URL in the Approvals page action matches the N8N webhook path.
- Check the PROPOSED_CHANGE record for change_type value -- WF9 branches based on this field.
