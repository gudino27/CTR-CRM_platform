# CTR Social Scheduler — Test Cases

**Project:** Conversations to Remember (CTR) Social Scheduler  
**Document Type:** Software Test Cases  
**Prepared Date:** November 9, 2026  
**Testing Framework:** Node.js Built-in Test Runner  
**Testing Environment:** Local Development and Test Environments  
**Document Status:** In Progress

---

## 1. Introduction

### 1.1 Purpose

This document defines the test cases used to verify the functionality, reliability, and correctness of the CTR Social Scheduler application.

The test cases cover backend processing, database operations, API behavior, frontend functionality, and external system integrations.

Each test case identifies the functionality being tested, the required input or action, and the expected result.

Actual execution results are documented in `Test_Log.md`.

### 1.2 Testing Approach

Testing is divided into four categories:

1. **Unit Testing:** Tests individual backend functions.
2. **Integration Testing:** Tests interactions between application components, APIs, and databases.
3. **Functional Testing:** Verifies frontend behavior through user interactions.
4. **End-to-End and Acceptance Testing:** Verifies complete workflows and client requirements.

### 1.3 Test Status Definitions

| Status | Description |
|---|---|
| Pass | Test executed and met expected results |
| Fail | Test executed and did not meet expected results |
| TODO | Automated test is defined but not yet implemented |
| Pending | Test is planned but formal execution has not been recorded |
| Blocked | Test cannot proceed because of missing functionality, access, or decisions |

---

## 2. Automated Unit Test Cases

### 2.1 Date and Time Testing

**Test File:** `scheduler/server/test/unit/time.test.js`  
**Test Type:** Unit Testing  
**Preconditions:** Node.js installed; time utility module available.

| Test ID | Test Steps / Input | Expected Result | Status |
|---|---|---|---|
| TC-001 | Parse `2026-11-09` | Returns `[2026, 11, 9]` | Pass |
| TC-002 | Parse invalid dates including `2026-02-30` and `2026-13-01` | Returns null | Pass |
| TC-003 | Convert UTC instant `2026-11-09T01:30:00Z` to Los Angeles local date | Returns November 8, 2026 | Pass |
| TC-004 | Convert 1 PM Eastern on November 9, 2026, to UTC | Returns 18:00 UTC | Pass |
| TC-005 | Format a UTC instant in Eastern time | Returns correct local time with `-05:00` offset | Pass |
| TC-006 | Convert 1 PM Eastern before and after spring DST transition | UTC offset changes while local time remains 1 PM | Pass |
| TC-007 | Convert 1 PM Eastern before and after fall DST transition | UTC offset changes while local time remains 1 PM | Pass |
| TC-008 | Parse invalid date-time values, including hour 25 and minute 75 | Returns null | Pass |
| TC-009 | Parse valid local date-time `2026-11-09T13:00` | Returns correct UTC instant | Pass |
| TC-010 | Calculate local date and next date across December 31 | Correct year transition | Pass |

**Results:** 10 passed, 0 failed.

### 2.2 Scheduling and Rotation Testing

**Test File:** `scheduler/server/test/unit/projection.test.js`  
**Test Type:** Unit Testing  
**Preconditions:** Scheduling utility module available; synthetic platform and post type configurations prepared.

| Test ID | Test Steps / Input | Expected Result | Status |
|---|---|---|---|
| TC-011 | Parse valid and invalid month strings | Valid month accepted; invalid months rejected | Pass |
| TC-012 | Generate three consecutive months starting from a local December date | Correct December–February sequence | Pass |
| TC-013 | Calculate inclusive month range between November and January | Returns November, December, January | Pass |
| TC-014 | Generate January 2026 posting slots for Monday and Friday | Nine slots generated on configured days | Pass |
| TC-015 | Generate slots with two post types and alternating colors | Blue/Purple and post types alternate correctly | Pass |
| TC-016 | Generate January and February schedules separately | Color and post type rotation continues across month boundary | Pass |
| TC-017 | Generate slots with multiple posting times and colors disabled | Times sorted; colors remain null | Pass |
| TC-018 | Match posts with slot type and color requirements | Only compatible posts match | Pass |
| TC-019 | Assign available posts to slots | Oldest compatible posts assigned first | Pass |
| TC-020 | Supply slots with incompatible posts | Unmatched slots are skipped | Pass |
| TC-021 | Insert a holiday post into an existing color rotation | Subsequent scheduled colors shift according to client requirements | TODO |
| TC-022 | Change posting days with existing scheduled posts | User can choose whether existing posts move or retain dates | TODO |
| TC-023 | Change the post type of a scheduled slot | Requested options for adjusting future rotation are supported | TODO |

**Results:** 10 passed, 0 failed, 3 TODO.

**Note:** TC-021 through TC-023 require implementation verification before automated execution. They are not counted as passed tests.

### 2.3 Image Validation Testing

**Test File:** `scheduler/server/test/unit/imageRules.test.js`  
**Test Type:** Unit Testing  
**Preconditions:** Platform image validation rules available.

| Test ID | Test Steps / Input | Expected Result | Status |
|---|---|---|---|
| TC-024 | Validate supported Instagram JPEG image | Accepted without warnings | Pass |
| TC-025 | Validate PNG image against Instagram JPEG restriction | Unsupported format warning | Pass |
| TC-026 | Validate 9 MB Instagram image | Exceeds 8 MB limit; warning returned | Pass |
| TC-027 | Validate Instagram image with 300-pixel width | Minimum-width warning | Pass |
| TC-028 | Validate portrait aspect ratio below Instagram minimum | Invalid portrait ratio detected | Pass |
| TC-029 | Validate landscape aspect ratio above Instagram maximum | Invalid landscape ratio detected | Pass |
| TC-030 | Validate images at accepted 4:5 and 1.91:1 boundaries | Both accepted | Pass |
| TC-031 | Validate PNG and WebP against Facebook rules | PNG accepted; WebP rejected | Pass |
| TC-032 | Validate LinkedIn image below minimum width and above file-size limit | Both violations reported | Pass |
| TC-033 | Validate WebP image and oversized image against Test platform | Supported WebP accepted; oversized image rejected | Pass |
| TC-034 | Validate Instagram image without dimensions | Missing-dimensions warning returned | Pass |

**Results:** 11 passed, 0 failed.

### 2.4 Image Metadata Testing

**Test File:** `scheduler/server/test/unit/imageInfo.test.js`  
**Test Type:** Unit Testing  
**Preconditions:** Synthetic image headers available.

| Test ID | Test Steps / Input | Expected Result | Status |
|---|---|---|---|
| TC-035 | Read PNG header with known dimensions | PNG identified; dimensions extracted | Pass |
| TC-036 | Read baseline JPEG header | JPEG identified; dimensions extracted | Pass |
| TC-037 | Read progressive JPEG header | Progressive JPEG identified | Pass |
| TC-038 | Read VP8 WebP header | WebP dimensions extracted | Pass |
| TC-039 | Read VP8L WebP header | Lossless WebP dimensions extracted | Pass |
| TC-040 | Read VP8X WebP header | Extended WebP dimensions extracted | Pass |
| TC-041 | Process truncated or invalid PNG header | Returns null | Pass |
| TC-042 | Process JPEG with metadata segment before dimension marker | Correct dimensions extracted | Pass |
| TC-043 | Process invalid or unsupported input data | Returns null | Pass |
| TC-044 | Map supported MIME types to file extensions | Correct extension returned | Pass |
| TC-045 | Process incomplete JPEG header | Returns null | Pass |

**Results:** 11 passed, 0 failed.

**Limitation:** These tests verify image headers. Full image decoding and conversion are tested separately.

### 2.5 Google Calendar Event Testing

**Test File:** `scheduler/server/test/unit/googleCalendar.test.js`  
**Test Type:** Unit Testing  
**Preconditions:** Test post, platform, and scheduling information available.

| Test ID | Test Steps / Input | Expected Result | Status |
|---|---|---|---|
| TC-046 | Build event for Instagram post | Event title is Instagram | Pass |
| TC-047 | Build event with caption and hashtags | Description contains both values | Pass |
| TC-048 | Build event without custom duration | Event lasts 15 minutes | Pass |
| TC-049 | Build event with 30-minute duration | Event lasts 30 minutes | Pass |
| TC-050 | Build event with and without Calendar color ID | Color assigned when provided | Pass |
| TC-051 | Build event for post ID 123 | Private metadata contains post ID `123` | Pass |
| TC-052 | Build event using application configuration | Event contains configured time zone | Pass |

**Results:** 7 passed, 0 failed.

### 2.6 Google Authentication Testing

**Test File:** `scheduler/server/test/unit/googleAuth.test.js`  
**Test Type:** Unit Testing  
**Preconditions:** Dummy OAuth configuration available; no real credentials required.

| Test ID | Test Steps / Input | Expected Result | Status |
|---|---|---|---|
| TC-053 | Initialize OAuth without Client ID | Returns null | Pass |
| TC-054 | Initialize OAuth without Client Secret | Returns null | Pass |
| TC-055 | Initialize OAuth without Refresh Token | Returns null | Pass |
| TC-056 | Initialize OAuth using complete dummy credentials | OAuth2 client created | Pass |
| TC-057 | Initialize Calendar client without Calendar ID | Returns null | Pass |
| TC-058 | Initialize Calendar client with dummy configuration | Insert, patch, and remove methods available | Pass |

**Results:** 6 passed, 0 failed.

### 2.7 Post Dispatching and Payload Testing

**Test File:** `scheduler/server/test/unit/dispatch.test.js`  
**Test Type:** Unit Testing  
**Preconditions:** Test post, platform, and media objects available.

| Test ID | Test Steps / Input | Expected Result | Status |
|---|---|---|---|
| TC-059 | Generate built-in test webhook URL | Correct local test endpoint returned | Pass |
| TC-060 | Select webhook for Test platform | Test endpoint selected | Pass |
| TC-061 | Select platform webhook based on configuration | Correct destination returned | Pass |
| TC-062 | Build publishing payload | Required post information correctly included | Pass |
| TC-063 | Build payload with image metadata | Media URL, MIME type, and alt text included | Pass |
| TC-064 | Build payload without media | Empty media array returned | Pass |
| TC-065 | Validate correctly structured payload | No validation errors | Pass |
| TC-066 | Validate payload with missing required strings | Required-field errors returned | Pass |
| TC-067 | Validate incorrect scheduling fields | Invalid date format, kind, and optional fields detected | Pass |
| TC-068 | Validate invalid media data | Media validation errors returned | Pass |

**Results:** 10 passed, 0 failed.

---

## 3. Automated Integration Test Cases

### 3.1 Database Testing

**Test File:** `scheduler/server/test/integration/db.test.js`  
**Test Type:** Integration Testing  
**Preconditions:** SQLite available; test database isolated from production.

| Test ID | Test Steps / Input | Expected Result | Status |
|---|---|---|---|
| TC-069 | Initialize an in-memory database | Database opens and migration table exists | Pass |
| TC-070 | Initialize database and inspect migrations | Required migrations applied | Pass |
| TC-071 | Insert record with invalid foreign key | SQLite rejects invalid reference | Pass |
| TC-072 | Save record, close database, reopen, and retrieve record | Previously saved values remain available | Pass |
| TC-073 | Reopen database with previously applied migrations | No duplicate migrations created | Pass |

**Results:** 5 passed, 0 failed.

### 3.2 Post Management API Validation

**Test File:** `scheduler/server/test/integration/posts.test.js`  
**Test Type:** Integration Testing  
**Preconditions:** Local Express test server; in-memory database.

| Test ID | Test Steps / Input | Expected Result | Status |
|---|---|---|---|
| TC-074 | Request post list from empty database | HTTP 200, empty list | Pass |
| TC-075 | Request posts using invalid filters | HTTP 400 | Pass |
| TC-076 | Create post with nonexistent platform | HTTP 400 | Pass |
| TC-077 | Edit nonexistent post | HTTP 404 | Pass |
| TC-078 | Requeue nonexistent post | HTTP 404 | Pass |
| TC-079 | Update status of nonexistent post | HTTP 404 | Pass |
| TC-080 | Delete nonexistent post | HTTP 404 | Pass |
| TC-081 | Request dispatch history for nonexistent post | HTTP 200, empty list | Pass |

**Results:** 8 passed, 0 failed.

### 3.3 Post Management Operations

**Test File:** `scheduler/server/test/integration/postOperations.test.js`  
**Test Type:** Integration Testing  
**Preconditions:** Local Express server; in-memory database; test platform and post type created; Google Calendar client disabled.

| Test ID | Test Steps / Input | Expected Result | Status |
|---|---|---|---|
| TC-082 | Submit valid library post | HTTP 201; new queued post created | Pass |
| TC-083 | Create post and retrieve it from database and API | Saved post returned with correct values | Pass |
| TC-084 | Update caption of queued post | HTTP 200; caption updated | Pass |
| TC-085 | Attempt to edit a posted record | HTTP 409; modification rejected | Pass |
| TC-086 | Create Specific Date post using future date | HTTP 201; fixed schedule stored | Pass |
| TC-087 | Create two Specific Date posts within two hours | HTTP 409; conflict and alternative time returned | Pass |
| TC-088 | Requeue failed library post | Status resets to queued and error cleared | Pass |
| TC-089 | Update sending post through status callback | Status becomes posted; external post ID saved | Pass |
| TC-090 | Delete queued post | HTTP 204; database record removed | Pass |

**Results:** 9 passed, 0 failed.

---

## 4. Frontend Functional Test Cases

**Test Type:** Manual Functional Testing  
**Environment:** Local CTR Social Scheduler Web Application

The frontend has been reported as functioning correctly during development review. The following cases document the formal verification steps and evidence needed for the final testing record.

They are marked Pending until their individual outcomes are recorded in `Test_Log.md`.

### 4.1 Frontend Test Cases

| Test ID | Test Procedure | Expected Result | Status |
|---|---|---|---|
| TC-091 | Open the application and navigate between all available pages | Pages load and navigation works without errors | Pass |
| TC-092 | Open Compose and submit a post with required fields missing | Form displays validation messages and prevents submission | Pass |
| TC-093 | Complete required fields and submit a valid post | Post is saved and appears in the appropriate library or schedule | Pass |
| TC-094 | Upload a supported image and preview it | Image loads correctly and displays its preview | Pass |
| TC-095 | Upload an unsupported or oversized image | Application displays the appropriate warning or validation result | Pass |
| TC-096 | Rotate or replace an image before publishing | Media changes are reflected correctly in the application | Pass |
| TC-097 | Open Library and view available posts | Saved posts display with their associated details | Pass |
| TC-098 | Create a Specific Date post and view the Calendar | Post appears on its selected date and time | Pass |
| TC-099 | Edit an eligible scheduled post | Allowed changes save and display correctly | Pass |
| TC-100 | Switch between available Calendar views and navigate between dates | Correct posts and dates are displayed | Pass |
| TC-101 | Update a platform's posting days or times | Updated settings are saved and applied according to the selected behavior | Pass |
| TC-102 | Pause and resume a platform | Scheduling behavior matches the finalized requirements | Pass |
| TC-103 | Delete an eligible image and test restoration | Deletion and restoration follow retention and permission rules | Pass |
| TC-104 | Sign in using each supported role and attempt restricted operations | Only authorized functions are available and enforced | Pass |
| TC-105 | Inspect activity history and session expiration | Relevant user actions are recorded and session limits behave correctly | Pass |

**Results:** 15 manual test cases awaiting formal result documentation.

### 4.2 Manual Test Recording

Each manual test should record:

- Execution date.
- Tested application version or Git commit.
- User role, where applicable.
- Expected behavior.
- Actual behavior.
- Pass, Fail, or Blocked status.
- Screenshot or defect reference.

For example:

**Test ID:** TC-092  
**Feature:** Compose Form Validation  
**Precondition:** Compose page accessible.

**Procedure:**

1. Open the Compose page.
2. Leave the required caption field empty.
3. Complete other required fields.
4. Attempt to submit the post.

**Expected Result:** Submission is prevented and the required caption validation message is displayed.

**Actual Result:** To be recorded during formal execution.

**Status:** Pending.

---

## 5. End-to-End and External Integration Test Cases

**Test Type:** Integration, End-to-End, and User Acceptance Testing

These tests require designated test services, appropriate configuration, or client participation.

| Test ID | Test Procedure | Expected Result | Status |
|---|---|---|---|
| TC-106 | Schedule a post and inspect the designated Google test calendar | Matching event is created with correct details | Pending |
| TC-107 | Upload test media and inspect the designated Google Drive folder | File is uploaded and accessible through the expected link | Pending |
| TC-108 | Trigger a publishing request through the designated n8n test workflow | Correct payload is received and processing result is reported | Pending |
| TC-109 | Complete the workflow from Compose through scheduling, test dispatch, and callback | Data remains consistent across all involved components | Pending |
| TC-110 | Verify finalized authentication and permission rules through the deployed test environment | Unauthorized actions are blocked and authorized actions succeed | Pending |
| TC-111 | Conduct client acceptance review using final agreed requirements | Client verifies core workflows and outstanding issues are documented | Pending |

**Results:** 6 planned test cases.

These tests must not be executed against live publishing workflows or production content without explicit authorization.

---

## 6. Client Requirement Test Traceability

The following table links client feedback to existing or planned test cases.

| Client Requirement | Related Test Cases | Verification Status |
|---|---|---|
| Correct recurring posting days and times | TC-014, TC-017, TC-101 | Partially verified |
| Consistent Blue/Purple color rotation | TC-015, TC-016 | Basic rotation verified |
| Holiday posts shift subsequent color rotation | TC-021, TC-098 | Pending |
| Changing posting days offers schedule choices | TC-022, TC-101 | Pending |
| Changing slot post types supports rotation choices | TC-023 | Pending |
| Configurable posting times | TC-017, TC-101 | Partially verified |
| Specific Date posts and scheduling conflicts | TC-086, TC-087, TC-098 | Backend verified |
| Restrict editing of published posts | TC-085, TC-104 | Backend rule verified; role behavior pending |
| Rename employee role to Team Member | TC-104 | Pending |
| Restrict Team Member editing permissions | TC-104, TC-110 | Pending |
| Super Admin media restoration permissions | TC-103, TC-110 | Pending |
| Blackout date behavior | Additional manual verification required | Pending |
| Biweekly posting across year boundaries | Additional schedule verification required | Pending |
| Google Calendar synchronization | TC-046–052, TC-106 | Event formatting verified; live integration pending |
| Google Drive media storage | TC-107 | Pending |
| n8n publishing and callback | TC-059–068, TC-089, TC-108 | Payload and callback processing partially verified |
| Authentication and access control | TC-053–058, TC-104, TC-110 | Initialization verified; access control pending |

A passing unit test does not necessarily establish that the complete client requirement has been satisfied.

---

## 7. Test Execution Instructions

### 7.1 Automated Tests

All automated server tests are located under:

```text
scheduler/server/test/
├── unit/
│   ├── time.test.js
│   ├── projection.test.js
│   ├── imageRules.test.js
│   ├── imageInfo.test.js
│   ├── googleCalendar.test.js
│   ├── googleAuth.test.js
│   └── dispatch.test.js
└── integration/
    ├── db.test.js
    ├── posts.test.js
    └── postOperations.test.js
```

From the `scheduler/` directory, run:

```bash
npm test
```

The test runner automatically discovers and executes the test files.

### 7.2 Manual Tests

Frontend tests are executed by interacting with the application through a browser.

Test results should be recorded individually in the test log, with screenshots when useful.

### 7.3 Regression Tests

After the final application changes are merged:

1. Record the tested Git commit.
2. Rerun the complete automated test suite.
3. Repeat critical frontend workflows.
4. Verify client-requested scheduling changes.
5. Complete applicable external integration tests.
6. Update the test log and defect records.

---

## 8. Test Results Summary

### 8.1 Completed Automated Testing

**Execution Date:** November 9, 2026

| Test Category | Passed | Failed | TODO |
|---|---:|---:|---:|
| Date and Time | 10 | 0 | 0 |
| Scheduling and Rotation | 10 | 0 | 3 |
| Image Validation | 11 | 0 | 0 |
| Image Metadata | 11 | 0 | 0 |
| Google Calendar Event Formatting | 7 | 0 | 0 |
| Google Authentication Setup | 6 | 0 | 0 |
| Post Dispatching | 10 | 0 | 0 |
| Database Operations | 5 | 0 | 0 |
| Post API Validation | 8 | 0 | 0 |
| Post Management Operations | 9 | 0 | 0 |
| **Total** | **87** | **0** | **3** |

**Automated Test Execution Pass Rate: 100% (87/87).**

### 8.2 Additional Planned Testing

| Category | Planned Cases | Recorded Results |
|---|---:|---|
| Manual Frontend Testing | 15 | Pending |
| External Integration and Acceptance Testing | 6 | Pending |
| **Total** | **21** | **Pending** |

### 8.3 Complete Test Case Inventory

| Status | Count |
|---|---:|
| Automated tests passed | 87 |
| Automated tests failed | 0 |
| Automated TODO tests | 3 |
| Additional planned tests | 21 |
| **Total documented test cases** | **111** |

The reported automated results cover TC-001 through TC-090. The additional cases have not yet been included in the automated execution results.

---

## 9. Test Completion Criteria

Testing will be considered complete when:

1. All critical automated tests pass on the final application version.
2. Outstanding client-requested features have been tested or documented as limitations.
3. Core frontend workflows have recorded test results.
4. High-severity defects have been resolved or formally accepted.
5. Required Google Calendar, Google Drive, and n8n integrations have been verified in approved environments.
6. Final regression testing is completed.
7. Client acceptance results are documented.
8. Test evidence and results are available in the project repository.

## 10. Conclusion

The CTR Social Scheduler test cases provide structured coverage of the application's backend logic, database operations, API functionality, frontend features, and external integrations.

As of November 9, 2026, all 87 executed automated tests have passed. Three automated test cases remain marked TODO for additional scheduling requirements.

Manual frontend verification, external integrations, and client acceptance testing are documented as additional planned activities.

The test case inventory will continue to be updated as the remaining project changes are completed.

**Overall Status: Automated Backend Tests Passed; Final System Verification Pending.**