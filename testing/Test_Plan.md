# CTR Social Scheduler — Test Plan

**Project:** Conversations to Remember (CTR) Social Scheduler  
**Document Type:** Software Test Plan  
**Prepared Date:** November 9, 2026  
**Testing Environment:** Local Development and Test Environments  
**Testing Framework:** Node.js Built-in Test Runner  
**Document Status:** In Progress

---

## 1. Introduction

### 1.1 Purpose

This document defines the testing strategy, scope, methods, environment, and completion criteria for the Conversations to Remember (CTR) Social Scheduler application.

The purpose of testing is to verify that the application functions according to the project requirements, maintains data integrity, handles invalid inputs correctly, and supports reliable social media scheduling and management.

Testing also aims to identify software defects before final deployment and ensure that the system meets the client's operational expectations.

### 1.2 Project Overview

The CTR Social Scheduler is a web-based application developed to help Conversations to Remember manage social media content across Facebook, Instagram, and LinkedIn.

The application supports post creation, media management, recurring schedules, content rotation, Google Calendar synchronization, and integration with n8n for publishing workflows.

The system includes a web frontend, a Node.js backend, a database, and integrations with external services.

The testing process covers individual backend functions, API operations, database interactions, user workflows, and external integrations.

## 2. Testing Objectives

The primary testing objectives are to:

1. Verify that implemented features operate according to their requirements.
2. Confirm that scheduling calculations produce correct dates, times, and posting sequences.
3. Validate post creation, editing, scheduling, status updates, and deletion.
4. Ensure uploaded images satisfy platform-specific requirements.
5. Verify that database operations preserve data and maintain referential integrity.
6. Confirm that publishing payloads match the expected n8n interface.
7. Verify Google Calendar and Google Drive integration in a controlled test environment.
8. Validate user authentication and role-based access restrictions.
9. Identify and document software defects before final delivery.
10. Confirm that client-requested functionality works as expected.

## 3. Scope of Testing

### 3.1 Backend Functionality

Backend testing covers the following components:

| Component | Testing Scope |
|---|---|
| Date and Time | Date validation, time zones, daylight-saving time |
| Scheduling | Posting days, posting times, recurring slots, color rotation |
| Post Management | Creation, editing, deletion, status updates, requeuing |
| Image Validation | Formats, dimensions, file sizes, aspect ratios |
| Image Metadata | Identification and extraction of image information |
| Database | Initialization, migrations, persistence, constraints |
| Google Calendar | Event formatting and synchronization |
| Google Authentication | OAuth2 client configuration |
| Publishing | Webhook routing and payload validation |
| API Endpoints | Input validation, HTTP responses, error handling |

### 3.2 Frontend Functionality

Frontend testing will verify the application's main user-facing features.

| Feature | Planned Testing |
|---|---|
| Compose | Create posts, validate required fields, select platforms |
| Library | View, manage, and organize available posts |
| Calendar | View schedules, edit posts, and manage posting slots |
| Media | Upload, preview, rotate, replace, and delete images |
| Platform Settings | Configure posting schedules, times, and preferences |
| User Management | Verify accounts, roles, and permissions |
| Navigation | Verify page navigation and interface behavior |

Frontend tests will include normal user workflows, invalid input scenarios, and usability checks.

### 3.3 External Integrations

The following services require integration testing:

- **Google Calendar:** Verify event creation, modification, removal, and synchronization.
- **Google Drive:** Verify image uploads, stored media links, and retrieval.
- **n8n:** Verify publishing requests, webhook payloads, and status callbacks.
- **Database:** Verify persistent data storage and retrieval.

External services will be tested using designated test resources before production deployment.

### 3.4 Testing Limitations

The following areas are not fully covered by the initial automated test suite:

- Actual publishing to Facebook, Instagram, and LinkedIn.
- Complete Google Workspace integration.
- Final production deployment and hosting.
- Complete frontend user workflows.
- Final authentication and permission enforcement.
- Client-requested features still under development.

These areas will be tested after the necessary implementation and access become available.

## 4. Testing Strategy and Methodology

The testing process combines automated and manual testing.

### 4.1 Unit Testing

Unit testing verifies individual functions and components independently.

Examples include:

- Date and time conversions.
- Scheduling calculations.
- Color and post type rotations.
- Image validation rules.
- Image metadata extraction.
- Publishing payload construction.

**Framework:** Node.js Built-in Test Runner (`node --test`)

**Location:** `scheduler/server/test/unit/`

**Execution:** Automated

### 4.2 Integration Testing

Integration testing verifies interactions between application components.

Examples include:

- API requests and database operations.
- Post creation and scheduling updates.
- Database initialization and migrations.
- Post status changes and requeuing.
- Calendar synchronization.
- Media storage and retrieval.

Local integration tests use temporary or in-memory databases.

External integration tests will use dedicated test accounts and services.

**Location:** `scheduler/server/test/integration/`

**Execution:** Automated and manual

### 4.3 Functional Testing

Functional testing verifies that application features behave correctly from the user's perspective.

Planned scenarios include:

- Creating a new social media post.
- Uploading an image.
- Adding a post to the library.
- Scheduling a Specific Date post.
- Editing an existing scheduled post.
- Changing platform posting preferences.
- Handling schedule conflicts.
- Managing failed or completed posts.
- Verifying interface validation messages.

Functional testing will primarily be performed through the web interface.

### 4.4 End-to-End Testing

End-to-end testing verifies complete workflows across multiple components.

A representative workflow is:

1. Create a social media post.
2. Select its platform, post type, and color.
3. Upload or select an image.
4. Save the post.
5. Assign the post to a scheduled slot.
6. Verify the corresponding Google Calendar event.
7. Trigger the publishing process through the test workflow.
8. Receive and process the publishing status callback.
9. Verify the final status in the application.

This process will be completed in a controlled test environment before production deployment.

### 4.5 User Acceptance Testing

User acceptance testing determines whether the application meets the client's practical requirements.

Testing will focus on:

- Ease of creating and scheduling posts.
- Correct posting schedules.
- Media management.
- Role-based access restrictions.
- Calendar visibility and accuracy.
- Handling special or holiday posts.
- Overall usability and workflow efficiency.

Client feedback will be used to identify any remaining changes.

### 4.6 Regression Testing

Regression testing verifies that new changes do not break previously working functionality.

The automated test suite will be rerun after significant backend changes.

Relevant manual workflows will also be repeated after frontend, integration, or scheduling changes.

Final regression testing will be performed on the completed application version before submission.

## 5. Test Environment

### 5.1 Development Environment

| Component | Configuration |
|---|---|
| Operating System | macOS |
| Programming Language | JavaScript |
| Runtime | Node.js 24.8.0 |
| Backend Framework | Express.js |
| Testing Framework | Node.js Built-in Test Runner |
| Database | SQLite |
| Application Architecture | Client/Server |
| Development Tool | Visual Studio Code |
| Version Control | Git / GitHub |

### 5.2 Automated Test Execution

Automated backend tests are executed from the `scheduler` directory.

```bash
npm test
```

The command invokes the server's Node.js test runner.

Test results are displayed in the terminal, including the number of passed, failed, skipped, and pending tests.

### 5.3 Database Testing Environment

Database tests use:

- In-memory SQLite databases (`:memory:`).
- Temporary SQLite database files.
- Test records created specifically for verification.

Testing does not modify the client's production data.

### 5.4 External Integration Environment

Google Calendar, Google Drive, and n8n tests will use authorized test accounts, calendars, folders, and workflows.

The application provides a test mode that separates configured test-calendar operations from production-calendar operations.

The `DRY_RUN` configuration can prevent real publishing requests from being sent by the dispatcher. However, it does not automatically disable Google Calendar synchronization.

Therefore, test configuration and external-service destinations must be verified before integration testing.

## 6. Test Data Management

### 6.1 Test Data

Synthetic test data will be used whenever possible.

Examples include:

- Sample social media captions.
- Test images.
- Dummy platform records.
- Sample posting schedules.
- Test post types and colors.
- Temporary database records.
- Simulated publishing statuses.

### 6.2 Data Protection

To protect client information:

1. Use synthetic records for automated testing.
2. Avoid modifying production databases.
3. Use test calendars and test webhook endpoints.
4. Do not commit credentials, tokens, or confidential client data.
5. Remove temporary test resources when no longer needed.
6. Obtain appropriate access before testing external services.

## 7. Test Case Organization

Each test case will have a unique identifier using the format:

**TC-XXX**

Example:

`TC-001: Accept valid dates`

Test cases will record:

| Field | Description |
|---|---|
| Test ID | Unique identifier |
| Test Description | Functionality being verified |
| Preconditions | Required setup or initial state |
| Test Steps | Actions performed |
| Expected Result | Correct system behavior |
| Actual Result | Observed behavior |
| Status | Pass, Fail, Blocked, or TODO |
| Evidence | Screenshot, logs, or other output |

### 7.1 Test Case Categories

| Test IDs | Category |
|---|---|
| TC-001–010 | Date and Time |
| TC-011–023 | Scheduling and Rotation |
| TC-024–034 | Image Validation |
| TC-035–045 | Image Metadata |
| TC-046–052 | Google Calendar Events |
| TC-053–058 | Google Authentication |
| TC-059–068 | Post Dispatching |
| TC-069–073 | Database Operations |
| TC-074–081 | Post API Validation |
| TC-082–090 | Post Management Integration |

Detailed results are maintained separately in `testing/Test_Log.md`.

## 8. Client Requirement Verification

Testing will include the requirements clarified through client correspondence.

| Requirement | Verification Needed |
|---|---|
| Team Member role | Confirm employee role is renamed appropriately |
| Post editing permissions | Verify Team Members cannot edit scheduled posts |
| Holiday color rotation | Verify holiday insertion shifts later color assignments |
| Posting schedule changes | Verify options to preserve or move scheduled posts |
| Post type changes | Verify requested choices for adjusting slot rotations |
| Configurable posting times | Verify each platform's posting times can be changed |
| Deleted media | Verify restoration permissions and retention behavior |
| Blackout dates | Verify manually scheduled Specific Date posts retain their schedule |
| Fixed posting dates | Verify date and time selection for time-sensitive posts |
| Biweekly scheduling | Verify the final agreed week-number behavior |

Requirements without a finalized implementation or decision will remain pending until they can be verified.

Additional acceptance tests will be created when the client's remaining decisions are confirmed.

## 9. Test Execution Procedure

Testing will follow a consistent process.

### Step 1: Prepare the Environment

- Confirm the application version and Git commit.
- Verify test configuration.
- Prepare synthetic test data.
- Confirm that external production services are not targeted.

### Step 2: Execute Automated Tests

Run the automated backend test suite:

```bash
npm test
```

Review the results and identify failed or pending tests.

### Step 3: Analyze Failures

For each failure:

1. Review the error message.
2. Determine whether the problem is in the test code, test environment, or application.
3. Document confirmed application defects.
4. Coordinate fixes with the development team.
5. Rerun affected tests after corrections.

### Step 4: Perform Manual Testing

Execute frontend and user workflow tests.

Record actual results and screenshots.

### Step 5: Perform Integration Testing

Verify external connections and data synchronization using approved test services.

### Step 6: Conduct Regression Testing

Rerun automated tests and important user workflows after development changes.

### Step 7: Finalize Results

Update the test log, summarize remaining defects, and prepare results for the final report.

## 10. Defect Management

Defects will be documented and tracked until resolved or formally accepted.

### 10.1 Defect Severity

| Severity | Description |
|---|---|
| Critical | Prevents core application operation or risks serious data loss |
| High | Major feature fails or produces incorrect results |
| Medium | Feature works incorrectly but a workaround exists |
| Low | Minor visual, usability, or noncritical issue |

### 10.2 Defect Reporting

Each confirmed defect should include:

- Defect ID.
- Related test case.
- Description.
- Steps to reproduce.
- Expected behavior.
- Actual behavior.
- Severity.
- Screenshot or log evidence.
- Resolution status.

Defects will be recorded in `testing/Bug_Report.md` or linked GitHub issues.

## 11. Entry and Exit Criteria

### 11.1 Entry Criteria

Testing may begin when:

- Relevant functionality is available in the local or test environment.
- Required dependencies are installed.
- Test data and environment configurations are prepared.
- Expected behavior is sufficiently defined.
- Testing can be performed without affecting production resources.

Features that are still under development may have planned test cases, but execution will be deferred.

### 11.2 Exit Criteria

Final testing will be considered complete when:

1. All planned critical test cases have been executed.
2. Automated tests pass on the final application version.
3. Critical and high-severity defects have been resolved or explicitly accepted.
4. Core user workflows have been verified.
5. External integrations have been tested in an authorized environment.
6. Client requirements have been verified or documented as outstanding.
7. Regression testing has been completed.
8. Test evidence and results are documented.

Any uncompleted tests or accepted limitations will be clearly identified in the final report.

## 12. Testing Schedule

| Target Date | Planned Activity |
|---|---|
| November 9, 2026 | Initial backend unit and integration tests |
| November 10–19 | Continue test preparation, functional testing, and issue tracking |
| November 20 | Prepare preliminary testing results for poster review |
| November 23–30 | Continue integration testing and verify client-requested changes |
| November 30 | Poster printing submission |
| December 1–4 | Complete remaining tests, regression testing, and documentation |
| December 4 | Final project completion deadline |
| December 8 | Final showcase |

The schedule may be adjusted based on remaining development tasks and client availability.

## 13. Roles and Responsibilities

| Responsibility | Assigned To |
|---|---|
| Develop automated test cases | Testing team member |
| Execute automated tests | Testing team member |
| Perform manual functional testing | Project team |
| Investigate application defects | Development team |
| Implement application fixes | Development team |
| Verify resolved defects | Testing team member |
| Conduct client acceptance review | Client and project team |
| Prepare testing documentation | Testing team member |
| Complete final regression testing | Project team |

Testing and development tasks will be coordinated to avoid conflicting changes in the shared repository.

## 14. Testing Risks and Mitigation

| Risk | Mitigation |
|---|---|
| Unfinished application features | Prepare tests and defer execution |
| Uncommitted development changes | Test identified commits and coordinate updates |
| External service access limitations | Use available test environments and document blocked tests |
| Accidental production changes | Isolate test databases and verify service destinations |
| Schedule changes affecting existing tests | Rerun scheduling and regression tests |
| Limited time before final submission | Prioritize core workflows and high-risk functions |
| Unresolved client decisions | Track pending requirements separately |

## 15. Testing Deliverables

The following testing artifacts will be maintained in the repository:

| Artifact | Purpose |
|---|---|
| `Test_Plan.md` | Testing strategy, scope, and execution process |
| `Test_Cases.md` | Detailed test cases and expected results |
| `Test_Log.md` | Actual test results and execution history |
| `Bug_Report.md` | Confirmed defects and resolutions |
| `evidence/` | Screenshots and supporting test results |
| Automated test files | Executable backend test cases |

These artifacts will support the Testing section of the final capstone report and provide evidence of the project's verification process.

## 16. Current Testing Status

As of November 9, 2026, the initial automated backend test suite has completed the following:

| Status | Count |
|---|---:|
| Total Test Cases | 90 |
| Passed | 87 |
| Failed | 0 |
| Pending (TODO) | 3 |
| **Executed Test Pass Rate** | **100%** |

All 87 active tests passed in the latest execution.

The three pending test cases relate to client-requested scheduling behavior.

The current automated tests cover date and time calculations, scheduling projections, image validation, Google Calendar event formatting, authentication setup, publishing payloads, database operations, and post management APIs.

Frontend functional testing, external integrations, user acceptance testing, and final regression testing remain to be completed.

## 17. Conclusion

This test plan establishes a structured approach for verifying the CTR Social Scheduler application before final delivery.

The testing process combines automated unit tests, integration tests, manual functional testing, end-to-end verification, and client acceptance testing.

Initial backend testing has produced successful results for all 87 executed test cases. However, additional testing remains necessary to verify complete user workflows, external integrations, access controls, and the client's final requirements.

The test plan and accompanying test log will be updated as the project approaches completion.

**Overall Testing Status: Initial Backend Testing Completed; Final System Testing In Progress.**