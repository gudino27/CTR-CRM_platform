# Sprint 1 Report (Dates from Sprint 1 Start to Sprint 1 End)

## YouTube link of Sprint 1 Video (Make this video unlisted)
TODO: 

## What's New (User Facing)
* Project repo structure created (docs/ folder, templates added)
* Initial requirements + system understanding documented (tools + data flow)
* First-pass database model drafted for CRM entities (people, seniors, volunteers, teams, meetings, feedback)

## Work Summary (Developer Facing)
This sprint focused on understanding the client’s workflow and translating it into an initial technical plan. We reviewed the project deliverables (web app, mobile app, dashboard, database, backend/API) and the required tools (MySQL, n8n, Baserow, Rocket.Chat). We held team discussions and consolidated requirements into a first-pass data model, including core CRM tables and relationships (seniors, volunteers, meetings, attendance, feedback). In parallel, we did early feasibility checks on Google Calendar integration and clarified how Baserow will be used as an admin-friendly CRM UI while the backend stores the source-of-truth data. We also created a Kanban workflow and defined Sprint 2 tasks based on gaps found in Sprint 1.

## Unfinished Work
* Finalized, client-approved schema (still awaiting confirmation on required fields and feedback form frequency)
* End-to-end integration prototype (calendar <-> backend <-> Baserow is planned for next sprint)

## Completed Issues/User Stories
Here are links to the issues that we completed in this sprint:
* TODO: URL of issue 1 (e.g., Requirements + workflow write-up)
* TODO: URL of issue 2 (e.g., Draft ERD / data model)
* TODO: URL of issue 3 (e.g., Calendar integration feasibility test)
* TODO: URL of issue 4 (e.g., Repo setup + docs templates)

## Incomplete Issues/User Stories
Here are links to issues we worked on but did not complete in this sprint:
* TODO: URL of issue A <<Waiting on client confirmation for required fields>>
* TODO: URL of issue B <<Needs more time to validate integration approach>>

## Code Files for Review
Please review the following code files, which were actively developed during this sprint, for quality:
* TODO: [file 1](https://github.com/ORG/REPO/path)
* TODO: [file 2](https://github.com/ORG/REPO/path)

## Retrospective Summary
Here's what went well:
* We aligned on the big-picture system flow and tool responsibilities.
* We converted early requirements into concrete tables/entities.
* We started testing risky parts early (calendar integration).

Here's what we'd like to improve:
* Get client confirmation earlier on “must-have” fields and business rules.
* Smaller issues and clearer acceptance criteria before starting work.

Here are changes we plan to implement in the next sprint:
* Lock Sprint 2 scope with a prioritized backlog.
* Convert schema draft into Baserow tables + relationships.
* Build a thin integration slice (one meeting record flowing end-to-end).