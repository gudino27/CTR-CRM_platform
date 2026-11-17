# CTR Social Scheduler — Test Cases

**Project:** Conversations to Remember (CTR) Social Scheduler  
**Document Type:** Software Test Cases  
**Prepared Date:** November 9, 2026  
**Last Reviewed:** November 17, 2026  
**Testing Framework:** Node.js Built-in Test Runner  
**Testing Environment:** Local Development and Test Environments  
**Document Status:** Reviewed; external verification remains open

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
| Blocked | Unable to complete because of missing access, configuration, or client decisions |
| Partial | Some steps passed but the full test is not yet verified |
| Retired | No longer part of the client's current required workflow; retain historical results |

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
| TC-021 | Insert a holiday post into an existing color rotation | Subsequent scheduled colors shift according to client requirements | Pass |
| TC-022 | Change posting days with existing scheduled posts | User can choose whether existing posts move or retain dates | Pass |
| TC-023 | Change the post type of a scheduled slot | Requested options for adjusting future rotation are supported | Pass |


**Results:** 13 passed, 0 failed, 0 TODO.

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


### 3.4 Additional Security and Integration Test Cases

**Test Type:** Automated Unit and Integration Testing

**Preconditions:** Node.js test environment configured; isolated SQLite database; local API endpoints and mock external services available.

| Test ID | Test Steps / Input | Expected Result | Status |
|---|---|---|---|
| TC-112 | Test operations under different user roles | Actions allowed or denied based on assigned permissions | Pass |
| TC-113 | Modify role permissions and test risky permission grants | Changes validated and permission warnings generated | Pass |
| TC-114 | Send authorized and unauthorized API requests | Unauthorized requests rejected with appropriate HTTP status | Pass |
| TC-115 | Test session expiration, logout, and revocation | Invalid or expired sessions denied access | Pass |
| TC-116 | Generate schedules using biweekly posting rules | Correct biweekly posting dates produced | Pass |
| TC-117 | Add blackout dates to existing posting schedules | Regular scheduled posts excluded from blackout dates | Pass |
| TC-118 | Pause and resume platform scheduling (legacy backend coverage) | Backend pause/resume logic works; the client removed pause from the required UI | Pass |
| TC-119 | Advance the clock during a pause and resolve missed posts (legacy backend coverage) | Historical missed-post handling passes; pause is no longer a required UI control | Pass |
| TC-120 | Lock or pin calendar slots, then modify schedule rules | Locked and pinned slots remain unchanged | Pass |
| TC-121 | Dispatch a due post to a successful mock webhook twice | Post published once and dispatch history recorded | Pass |
| TC-122 | Dispatch a post to a mock webhook returning HTTP 503 | Post marked failed and no automatic duplicate retry occurs | Pass |
| TC-123 | Submit valid, invalid, and unauthorized status callbacks | Publishing status updated correctly; invalid requests rejected | Pass |
| TC-124 | Create, update, and remove events using a mock Calendar client | Calendar event lifecycle and metadata verified | Pass |
| TC-125 | Simulate manual Google Calendar event changes | Changes synchronized to posts and recorded in audit history | Pass |
| TC-126 | Upload, duplicate, delete, and restore test images | Image lifecycle and deletion restrictions verified | Pass |
| TC-127 | Requeue a failed post and retry publishing | Post successfully published after manual requeue | Pass |
| TC-128 | Trigger post failure notifications and Calendar activity logging | Notifications, read status, resolution, and audit history verified | Pass |

**Results:** 17 passed, 0 failed.

**Testing Notes:** Tests used isolated databases, local APIs, and mock external services. No production accounts or data were modified.

---

## 4. Frontend Functional Test Cases

**Type:** Manual functional testing  
**Environment:** CTR Social Scheduler web test deployment

The project tester previously confirmed **15 manual frontend passes (TC-091–TC-105)**. Their historical outcomes are preserved. The November 16 browser checks documented below verify a subset of current behavior; they do not establish that every latest change or integration was retested.

### 4.1 Historical Frontend Cases

| ID | Test Procedure | Expected Result | Recorded Status |
|---|---|---|---|
| TC-091 | Open the application and navigate between available pages | Available pages open without errors | Pass (reported) |
| TC-092 | Submit Compose without required fields | Missing fields block submission | Pass (reported) |
| TC-093 | Create a valid post | Post saved to Library or Calendar | Pass (reported) |
| TC-094 | Upload a supported image and preview it | Correct image appears | Pass (reported) |
| TC-095 | Try an unsupported or oversized image | A suitable warning is shown | Pass (reported) |
| TC-096 | Rotate or replace an image before publishing | Updated media appears | Pass (reported) |
| TC-097 | Open Library and inspect saved posts | Posts and details display correctly | Pass (reported) |
| TC-098 | Schedule a Specific Date post and inspect Calendar | Post appears on chosen date and time | Pass (reported; browser check observed) |
| TC-099 | Edit an eligible scheduled post | Allowed changes persist | Pass (reported) |
| TC-100 | Navigate Calendar dates/views | Display matches selected period | Pass (reported; old wording needs current-build regression) |
| TC-101 | Update platform posting days/times | Settings save and affect eligible slots | Pass (reported) |
| TC-102 | Pause and resume platform through the older UI | Earlier requirement was met | Pass (historical; **retired from current UI acceptance**) |
| TC-103 | Delete eligible media and restore it | Retention and permissions enforced | Pass (reported) |
| TC-104 | Use different roles and attempt restricted actions | Unauthorized actions unavailable | Pass (reported; partial browser checks observed) |
| TC-105 | Inspect activity history and sessions | History and session handling behave correctly | Pass (reported) |

**Historical frontend total:** 15 passed, 0 failed. One of the 15 (TC-102) is no longer a current client-facing requirement. New final-release requirements are listed separately in Section 5.1.

### 4.2 Guided Browser Check Results — November 16, 2026

| Action | Observed Result | Evidence/Limit |
|---|---|---|
| Compose a Facebook Specific Date post with caption `Testing` and an image, November 20, 2026, 1:00 PM ET | Post saved after the Google token issue was addressed | Scheduler screenshot; not proof of live publishing |
| View Scheduler Calendar for November 2026 | Facebook Specific Date post appears at 1:00 PM; regular slot is displaced | In-app Calendar only; Google Calendar itself not inspected |
| Open Media page | Uploaded JPEG preview, dimensions, platform checks and associated Facebook post appear | Does not verify Drive file sharing |
| Open media's Google Drive link | Google Drive asks the tester to request access | Approved staff access needs confirmation |
| Demo Team Member: open `/users`, `/permissions`, `/activity`, `/archive` directly | Each page displays `Not available` | Confirms page-level restrictions, not all API permissions |
| Demo Admin: open `/users` and `/permissions` | Users page opens; Permissions page denies access | Super Admin and Workspace SSO still need final deployed checks |

**Observed integration issue:** A Google token was reported as expired during initial scheduling; the test post later saved. Token refresh handling needs Jaime's confirmation.

### 4.3 Manual Test Evidence Standard

For a manually executed case, record date, Git commit/build, role, steps, expected and actual results, status, and screenshot or log reference. Screenshots shared during a conversation are **not automatically present** in `testing/evidence/`.

---

## 5. External Integration and Acceptance Cases

The following six tests are **not all passed**. A working interface or a teammate's assumption cannot replace the external verification.

| ID | Procedure | Expected Result | Nov 17 Status |
|---|---|---|---|
| TC-106 | Schedule a post and inspect the designated **Google test calendar** | Correct Google event with matching date, time, platform and caption | **Partial** — in-app post and schedule verified; Google Calendar not checked |
| TC-107 | Upload or reuse media; check **authorized Google Drive access** | File stored and readable by approved staff | **Blocked** — media preview works; the tester's Google account requests access |
| TC-108 | Execute the approved **n8n test workflow** | Correct webhook payload, execution and callback | **Blocked** — n8n controlled by Jaime |
| TC-109 | Run Compose → Schedule → Google event → test dispatch → callback | Consistent post/status across services | **Partial** — Compose/Calendar passed; remaining external flow not verified |
| TC-110 | Verify user roles, API permissions and production Google Workspace sign-in | Access limited to authorized users; restricted API calls denied | **Partial** — Team Member/Admin page checks passed; live SSO and broader API checks outstanding |
| TC-111 | Client reviews final workflows, limitations and deployment | Client signs off or records issues | **Pending** — final acceptance not provided |

**External/acceptance group:** 0 fully passed, 3 Partial, 2 Blocked, 1 Pending.

### 5.1 Additional Final-Release Regression Cases

These cases cover newer functionality from the repo and the latest client follow-up. **No execution result is claimed.**

| ID | Test Procedure | Expected Result | Status |
|---|---|---|---|
| TC-129 | Attempt Google Workspace sign-in with approved, unlisted and outside accounts | Workspace authorization plus app user list are enforced; two-step protection applies | Blocked — client Workspace setup |
| TC-130 | Manager and Team Member edit scheduled posts, schedules, media, users | Manager can manage content/schedules, not users; Team Member cannot edit scheduled posts | Pending |
| TC-131 | Verify LinkedIn's alternating weeks, including year change | Mon/Wed/Fri alternates with Tue/Thu across week boundaries | Pending |
| TC-132 | Insert a holiday post into Blue/Purple schedule; inspect later slots | Holiday uses correct color; later colors shift; displaced library post stays available | Pending |
| TC-133 | In n8n, verify posted/failed callback, retry and an unconfirmed post alert | Status, notifications, failures and requeue work correctly | Blocked — Jaime/n8n |
| TC-134 | Inspect Drive image through approved staff accounts; attempt media restore under each role | Approved staff can open; only Super Admin restores from Recently Deleted | Blocked — Drive account permissions |
| TC-135 | Inspect Archive and a past published event in Google Calendar | Archive follows final client policy; historical Calendar events remain available | Pending — client policy |
| TC-136 | Inspect `TEST_MODE`, `DRY_RUN`, test calendar and webhook destinations | Test execution cannot publish to live social accounts | Blocked — Jaime's server configuration |
| TC-137 | Recheck Inventory, Notifications, Activity, Archive, roles, month navigation on final version | Current pages function for authorized roles; unauthorized pages stay blocked | Pending |

---

## 6. Client Requirement Traceability

| Requirement | Tests | Verification |
|---|---|---|
| Required caption + image; optional alt text; hashtags in caption | TC-092–095, TC-129–137 as appropriate | Earlier frontend passed; current form visible; recent changes need final regression |
| Typed Library / Specific Date and slot displacement | TC-019–023, TC-093, TC-098, TC-132 | Historical backend passes and Nov 16 calendar check |
| Alternating Blue/Purple / holiday posts | TC-015–016, TC-021, TC-132 | Automated passed historically; deployed holiday regression pending |
| Changing schedule days or post types, keeping/moving posts | TC-022–023, TC-101 | Automated and earlier manual passes reported |
| LinkedIn every-other-week schedule | TC-116, TC-131 | Backend test passed historically; final setting verification pending |
| Team Member/Manager/Super Admin privileges | TC-104, TC-110, TC-112–115, TC-130 | Backend historical passes; partial direct-route checks observed |
| Image restoration and Google Drive permissions | TC-103, TC-107, TC-126, TC-134 | Local/mocked tests passed; Drive access blocked for tester |
| Blackout and locked/pinned slots | TC-117, TC-120 | Historical automated passes |
| Pause UI | TC-102, TC-118–119 | Legacy tests retained; client removed pause from requested UI |
| Google Calendar event sync | TC-046–052, TC-106, TC-124–125 | Automated mock tests passed; actual calendar check outstanding |
| n8n callbacks and notifications | TC-059–068, TC-108–109, TC-121–123, TC-127–128, TC-133 | Automated local/mock tests passed; real n8n outstanding |
| Workspace sign-in and 2-step protection | TC-110, TC-129 | Client account/access setup outstanding |
| Archiving and historical Calendar events | TC-135 | Client decision outstanding |
| Client acceptance | TC-111 | Pending |

---

## 7. Test Execution Instructions

### 7.1 Automated Tests

There are **27 JavaScript automated test files** under `scheduler/server/test/` (8 unit and 19 integration). Run from the `scheduler/` directory:

```bash
npm ci
npm test
```

The command runs the Node.js built-in test runner through the server workspace. Use a supported Node.js release. Record commit, date, run output, and any failures. The **last documented run** was November 9, 2026; this review did not execute a new run.

### 7.2 Manual / Integration Tests

Use designated demo/test accounts. Verify the environment is in Test Mode and is not connected to live publishing before issuing dispatch tests. Record both application behavior and the external service result. If an account or service is unavailable, use **Blocked**, not Pass.

### 7.3 Final Regression

After Jaime's latest changes are merged, rerun `npm test`, check critical current UI workflows, then execute the applicable TC-129–TC-137 cases. Do not retest the retired pause UI as a current client requirement.

---

## 8. Results and Inventory

### 8.1 Recorded Automated Result — November 9, 2026

| Test Category | Passed | Failed |
|---|---:|---:|
| Date and Time | 10 | 0 |
| Scheduling and Rotation | 13 | 0 |
| Image Validation | 11 | 0 |
| Image Metadata | 11 | 0 |
| Google Calendar Event Formatting | 7 | 0 |
| Google Authentication Setup | 6 | 0 |
| Post Dispatching | 10 | 0 |
| Database Operations | 5 | 0 |
| Post API Validation | 8 | 0 |
| Post Management Operations | 9 | 0 |
| Additional Security and Integration | 17 | 0 |
| **Total** | **107** | **0** |

**Historical automated pass rate:** 100% (107/107). This result was not rerun during the present review.

### 8.2 Complete Test Case Inventory — As Documented November 17

| Group | Pass | Partial | Blocked | Pending | Total |
|---|---:|---:|---:|---:|---:|
| Automated TC-001–090 and TC-112–128 | 107 | 0 | 0 | 0 | 107 |
| Prior manual frontend TC-091–105 | 15 | 0 | 0 | 0 | 15 |
| External/acceptance TC-106–111 | 0 | 3 | 2 | 1 | 6 |
| New regression TC-129–137 | 0 | 0 | 4 | 5 | 9 |
| **Total** | **122** | **3** | **6** | **6** | **137** |

The 15 manual passes are tester-reported historical results; one (TC-102) refers to a retired UI feature. A total of **15 cases have not been fully verified**. No additional passes are inferred from Jaime's client email.

---

## 9. Completion Criteria

Final release testing is complete only when critical automated tests pass on the final commit, current client requirements have recorded results, high-severity issues are resolved or accepted, external integrations have explicit verification, Google Workspace account restrictions are checked, and client acceptance is documented. Unfinished cases may be recorded as limitations but should not be mislabeled Pass.

---

## 10. Conclusion

The repository contains **107 automated test cases** with a recorded November 9 result of **107 passed**. The project tester reported **15 earlier frontend passes**. Guided browser checks additionally confirmed fixed-date scheduling within the Scheduler, media display, and selected role-based page restrictions.

Google Calendar was not checked outside the app, direct Google Drive access was denied to the tester's account, n8n execution history was unavailable, and Google Workspace sign-in/client acceptance remain outstanding. Nine current-release regression tests were added to track these and other updated requirements.

**Documented status:** 137 test cases; 122 historical/reported Pass; 3 Partial; 6 Blocked; 6 Pending. Final integration verification and client handoff remain open.
