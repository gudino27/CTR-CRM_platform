Minutes of Meeting (MoM)
Project Title: Conversations to Remember CRM Platform
Team Number: Jaime Gudino, Alice Hui
Client / Sponsor: Robert Lefkowitz
Mentor(s): Parteek Kumar
Date: 02/20/2026 Friday
Time: 3:15 pm PST
Location / Platform (Zoom/Office/etc.):Instant link provided by Client
Participants (Team & Client): Jaime Gudino, Robert Lefkowitz 


Meeting Number / Version: 02 (02/20/2026 Friday)
1. Agenda
Item 1: Progress review and live demo of dashboard and scheduling proof of concept
Item 2: Discussion of Baserow implementation plan and table design
Item 3: Google Calendar integration approach, exception handling, and role-based access control

2. Key Discussion Points
We demonstrated a working proof-of-concept dashboard with mock data, including volunteer and senior management, a weekly schedule view, and a rotation scheduler with 4-week, 8-week, and custom rotation options.
Client confirmed approval to move forward with Baserow as the database. Team was previously waiting on this approval before setting up actual tables.
Calendar integration workflow was discussed: scheduling a visit in Baserow will trigger an N8N workflow that creates a recurring Google Calendar event (no end date, auto-renewing), which automatically adds the event to attendees' Google Calendars.
Exception handling strategy was discussed for managing volunteer absences and substitutions:
  - A separate exceptions table will track one-off changes (volunteer absent, substitute added) without modifying the recurring calendar event directly.
  - When a volunteer permanently leaves the rotation (e.g., graduates), the workflow will cancel the existing recurring event and recreate it with the updated team, then re-apply any future exceptions.
  - Calendar event titles should dynamically reflect the current attendees for each occurrence.
Role-based access control requirements discussed:
  - Director and supervisor have full create and edit access.
  - Other staff and volunteers have view-only or limited access.
  - Client preference is to use Baserow's built-in permission system as much as possible.
  - An optional approval workflow via N8N (e.g., WhatsApp or text message notification) was discussed for calendar modification requests.
Client noted that most senior and volunteer data will be imported from existing registration forms (WordPress/existing intake process), not entered manually.
Client requested that all code be thoroughly commented so they can understand and maintain the codebase in the future.
N8N self-hosted instance was discussed.

3. Decisions Made
Proceed with Baserow for the database layer, Alice will begin setting up core tables to familiarize herself with the platform.
Google Calendar integration will route through N8N; recurring events will have no end date.
Role-based access will use Baserow's built-in permission system where possible, with the web app UI enforcing view restrictions on top.
Calendar events will be managed via a base record (the recurring team assignment) plus a separate exceptions table for one-off modifications.
All frontend code will be commented to explain each function's purpose and behavior.

4. Action Items / Responsibilities
Task: Set up core Baserow tables (seniors, volunteers, visit teams, exceptions) | Assigned To: Alice | Deadline: Next Sprint | Priority: High
Task: Add comprehensive code comments to all frontend functions and components | Assigned To: Jaime | Deadline: Next Sprint | Priority: Medium
Task: Design exceptions table schema and document the cancel/recreate workflow for recurring event changes | Assigned To: Jaime | Deadline: Next Sprint | Priority: High
Task: Build N8N workflow prototype for Google Calendar recurring event creation | Assigned To: Jaime | Deadline: Next Sprint | Priority: High
Task: Research Baserow role/permission setup for director vs. staff access levels | Assigned To: Alice | Deadline: Next Sprint | Priority: Medium

5. Client Feedback / Clarifications
The dashboard and scheduling POC looked good; client was pleased with the progress.
Client wants clear role-based restrictions .the executive director is cautious about giving edit access to calendar events to all users.
An approval mechanism (via N8N notification) for calendar changes would be desirable, particularly to prevent accidental edits.
Client prefers that the platform stay as close to Baserow's built-in capabilities as possible to remain maintainable without deep technical knowledge.
Code comments are important to the client so they can understand the system without needing to rely on the development team for every question.

6. Linkage to Deliverables (optional)
Relevant Requirement Document Section(s): Database schema design, calendar integration, role-based access
Impact on Sprint / Milestone: Sprint 1 .Baserow setup approval, exception handling design, N8N calendar integration planning
Presentation / Report Updates Needed: Update sprint report with approved Baserow path and exception handling design

7. Next Steps & Follow-Up
Deliverables before next meeting: Core Baserow tables created, code commenting underway, N8N calendar workflow prototype
Next meeting scheduled on: TBD
Agreed communication channel: Email
Prepared By: Jaime Gudino
Date of Circulation: 02/20/2026
