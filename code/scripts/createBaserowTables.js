/**
 * PURPOSE:
 *   This will create all 16 CRM tables in a Baserow database via the REST API from the Diagram.
 *   Tables are created in dependency order so that link fields can reference
 *   tables that already exist.
 *
 * PREREQUISITES:
 *   1. Baserow instance running and accessible at BASEROW_URL
 *   2. A valid Database token (create in Baserow UI: My Settings > Database Tokens)
 *   3. A database already created in Baserow (note the database ID from the URL ([BASEROW_URL]/database/123/ ->ID =123))
 *   4. A .env file in the same directory with BASEROW_URL, BASEROW_TOKEN, BASEROW_DATABASE_ID
 *
 * USAGE:
 *   cd code/scripts
 *   node createBaserowTables.js
 *
 * WHAT IT DOES:
 *   Phase 1: Creates all 16 table shells first with just names
 *   Phase 2: Adds non link fields
 *   Phase 3: Adds link row fields (foreign keys between tables)
 *   Phase 4: Adds lookup fields (read data from linked tables)
 *   Phase 5: Adds formula fields
 *   Phase 6: Seeds FORM_TYPE table with 4 required rows
 *   Phase 7: Prints a summary of all table IDs for your .env file
 *
 * SAFE TO RE-RUN:
 *   NO — this script creates new tables each time. Only run once per database.
 *   If you need to start over, delete the tables in Baserow first. ONE RUN ONLY!!!
 *
 * =============================================================================
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env from the scripts directory
const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, ".env") });

// =============================================================================
// Configuration from environment variables
// =============================================================================
const BASEROW_URL = process.env.BASEROW_URL;
const BASEROW_EMAIL = process.env.BASEROW_EMAIL;
const BASEROW_PASSWORD = process.env.BASEROW_PASSWORD;
const BASEROW_DATABASE_ID = process.env.BASEROW_DATABASE_ID;

// Validate env vars are set
if (
  !BASEROW_URL ||
  !BASEROW_EMAIL ||
  !BASEROW_PASSWORD ||
  !BASEROW_DATABASE_ID
) {
  console.error(
    "ERROR: Missing required environment variables.\n" +
      "Make sure your .env file has BASEROW_URL, BASEROW_EMAIL, BASEROW_PASSWORD, and BASEROW_DATABASE_ID.\n",
  );
  process.exit(1);
}

// JWT token — populated during the login step in main() make sure to add credentials to .env file before running
// DO NOT COMMIT .ENV WITH REAL CREDENTIALS TO GITHUB, THIS FILE SHOULD BE IN .GITIGNORE
let JWT_TOKEN = null;

// =============================================================================
// Authentication — log in to get a JWT token for schema operations
// =============================================================================

/**
 * Logs in to Baserow with email/password and stores the JWT token.
 *
 * Baserow has two auth systems:
 *   - Database tokens: row-level read/write only
 *   - JWT tokens (from logging in): required for schema operations (create tables, fields)
 * This function uses the JWT approach for the setup script.
 */
async function login() {
  console.log(`  Logging in as ${BASEROW_EMAIL}...`);
  const response = await fetch(`${BASEROW_URL}/api/user/token-auth/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: BASEROW_EMAIL, password: BASEROW_PASSWORD }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Login failed: ${response.status} ${response.statusText}\n${errorText}\n` +
        "Check BASEROW_EMAIL and BASEROW_PASSWORD in your .env file.",
    );
  }

  const data = await response.json();
  // Baserow v2.x returns { token, refresh_token, user }
  JWT_TOKEN = data.token || data.access_token;
  console.log(`  Login successful. JWT token obtained.\n`);
}

// =============================================================================
// HTTP helper — all Baserow API calls go through this function
// =============================================================================

/**
 * Makes an HTTP request to the Baserow API using the JWT token.
 *
 * @param {string} endpoint - API path (e.g., "/api/database/tables/database/1/")
 * @param {string} method - HTTP method (GET, POST, PATCH, DELETE)
 * @param {object|null} body - JSON body for POST/PATCH requests
 * @returns {Promise<object>} - Parsed JSON response
 */
// This function also handles error checking and will throw an error with details if the request fails.
async function baserowRequest(endpoint, method = "GET", body = null) {
  const url = `${BASEROW_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      Authorization: `JWT ${JWT_TOKEN}`,
      "Content-Type": "application/json",
    },
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Baserow API error: ${method} ${endpoint} → ${response.status} ${response.statusText}\n${errorText}`,
    );
  }

  // Some DELETE responses have no body
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

// =============================================================================
// Phase 1: Create table shells
// =============================================================================

/**
 * Creates an empty table in the Baserow database.
 * Baserow auto-creates a primary "Name" text field on every new table.
 *
 * @param {string} name - Table name (e.g., "SENIOR_COMMUNITY")
 * @returns {Promise<{id: number, name: string}>} - Created table with its ID
 */
async function createTable(name) {
  console.log(`  Creating table: ${name}`);
  const result = await baserowRequest(
    `/api/database/tables/database/${BASEROW_DATABASE_ID}/`,
    "POST",
    { name },
  );
  return { id: result.id, name: result.name };
}

// =============================================================================
// Phase 2-5: Add fields to tables
// =============================================================================

/**
 * Adds a field to an existing Baserow table.
 *
 * @param {number} tableId - The Baserow table ID
 * @param {object} fieldDef - Field definition object with at minimum { name, type }
 * @returns {Promise<object>} - Created field object with its ID
 */
async function createField(tableId, fieldDef) {
  console.log(`    + Field: ${fieldDef.name} (${fieldDef.type})`);
  return baserowRequest(
    `/api/database/fields/table/${tableId}/`,
    "POST",
    fieldDef,
  );
}

/**
 * Creates a row in a Baserow table. Used for seeding reference data.
 *
 * @param {number} tableId - The Baserow table ID
 * @param {object} rowData - Key-value pairs matching the table's field names
 * @returns {Promise<object>} - Created row object
 */
async function createRow(tableId, rowData) {
  return baserowRequest(
    `/api/database/rows/table/${tableId}/?user_field_names=true`,
    "POST",
    rowData,
  );
}

// =============================================================================
// Table definitions — all 16 tables with their fields
// =============================================================================

/**
 * Builds the complete field definitions for all tables.
 * This is a function (not a constant) because link_row fields need the
 * actual table IDs, which we only know after Phase 1 creates the tables.
 *
 * @param {object} tableIds - Map of table name → Baserow table ID
 * @returns {object} - Map of table name → { nonLinkFields, linkFields, lookupFields, formulaFields }
 */
function buildFieldDefinitions(tableIds) {
  return {
    // -----------------------------------------------------------------
    // 1. SENIOR_COMMUNITY
    // -----------------------------------------------------------------
    SENIOR_COMMUNITY: {
      nonLinkFields: [
        // "Name" field is auto-created by Baserow as the primary field
        { name: "city", type: "text" },
        { name: "state", type: "text" },
        {
          name: "timezone",
          type: "single_select",
          select_options: [
            { value: "America/New_York", color: "blue" },
            { value: "America/Chicago", color: "green" },
            { value: "America/Denver", color: "yellow" },
            { value: "America/Los_Angeles", color: "red" },
          ],
        },
        // this field is used to see if senior is participating or is currently inactive.
        {
          name: "status",
          type: "single_select",
          select_options: [
            { value: "active", color: "green" },
            { value: "inactive", color: "red" },
          ],
        },
        { name: "notes", type: "long_text" },
      ],
      linkFields: [],
      lookupFields: [],
      formulaFields: [],
    },

    // -----------------------------------------------------------------
    // 2. FORM_TYPE
    // -----------------------------------------------------------------
    FORM_TYPE: {
      nonLinkFields: [
        // "Name" auto-created as primary — we'll use it for the form type name
        {
          name: "frequency",
          type: "single_select",
          select_options: [
            { value: "per_meeting", color: "blue" },
            { value: "monthly", color: "green" },
          ],
        },
        {
          name: "target",
          type: "single_select",
          select_options: [
            { value: "meeting_instance", color: "blue" },
            { value: "senior", color: "green" },
          ],
        },
      ],
      linkFields: [],
      lookupFields: [],
      formulaFields: [],
    },

    // -----------------------------------------------------------------
    // 3. PERSON
    // -----------------------------------------------------------------
    PERSON: {
      nonLinkFields: [
        // "Name" auto-created as primary — we'll rename or use for first_name
        { name: "first_name", type: "text" },
        { name: "last_name", type: "text" },
        { name: "email", type: "email" },
        {
          name: "timezone",
          type: "single_select",
          select_options: [
            { value: "America/New_York", color: "blue" },
            { value: "America/Chicago", color: "green" },
            { value: "America/Denver", color: "yellow" },
            { value: "America/Los_Angeles", color: "red" },
          ],
        },
        {
          name: "status",
          type: "single_select",
          select_options: [
            { value: "active", color: "green" },
            { value: "inactive", color: "red" },
          ],
        },
        { name: "created_at", type: "date", date_include_time: true },
        {
          name: "role",
          type: "single_select",
          select_options: [
            { value: "senior", color: "blue" },
            { value: "student", color: "green" },
            { value: "family", color: "yellow" },
            { value: "caregiver", color: "red" },
          ],
        },
        { name: "city", type: "text" },
        { name: "state", type: "text" },
      ],
      linkFields: [],
      lookupFields: [],
      formulaFields: [
        {
          name: "full_name",
          type: "formula",
          formula: "concat(field('first_name'), ' ', field('last_name'))",
        },
      ],
    },

    // -----------------------------------------------------------------
    // 4. PERSON_PHONE
    // -----------------------------------------------------------------
    PERSON_PHONE: {
      nonLinkFields: [
        { name: "phone_number", type: "phone_number" },
        {
          name: "phone_type",
          type: "single_select",
          select_options: [
            { value: "cell", color: "blue" },
            { value: "secondary", color: "light-gray" },
          ],
        },
      ],
      linkFields: [
        {
          name: "person",
          type: "link_row",
          link_row_table_id: tableIds.PERSON,
        },
      ],
      lookupFields: [],
      formulaFields: [],
    },

    // -----------------------------------------------------------------
    // 5. SENIOR
    // -----------------------------------------------------------------
    SENIOR: {
      nonLinkFields: [
        { name: "notes", type: "long_text" },
        { name: "onboarding_date", type: "date" },
        { name: "veteran_status", type: "boolean" },
        { name: "verbose", type: "boolean" },
        {
          name: "age_range",
          type: "single_select",
          select_options: [
            { value: "60-69", color: "blue" },
            { value: "70-79", color: "green" },
            { value: "80-89", color: "yellow" },
            { value: "90+", color: "red" },
          ],
        },
        { name: "monday_availability", type: "text" },
        { name: "tuesday_availability", type: "text" },
        { name: "wednesday_availability", type: "text" },
        { name: "thursday_availability", type: "text" },
        { name: "friday_availability", type: "text" },
        { name: "saturday_availability", type: "text" },
        { name: "sunday_availability", type: "text" },
      ],
      linkFields: [
        {
          name: "person",
          type: "link_row",
          link_row_table_id: tableIds.PERSON,
        },
        {
          name: "senior_community",
          type: "link_row",
          link_row_table_id: tableIds.SENIOR_COMMUNITY,
        },
      ],
      lookupFields: [
        {
          name: "person_first_name",
          type: "lookup",
          through_field_name: "person",
          target_field_name: "first_name",
        },
        {
          name: "person_last_name",
          type: "lookup",
          through_field_name: "person",
          target_field_name: "last_name",
        },
      ],
      formulaFields: [
        {
          name: "display_name",
          type: "formula",
          formula:
            "concat(field('person_first_name'), ' ', field('person_last_name'))",
        },
      ],
    },

    // -----------------------------------------------------------------
    // 6. CAREGIVER
    // -----------------------------------------------------------------
    CAREGIVER: {
      nonLinkFields: [
        { name: "is_independent", type: "boolean" },
        { name: "is_private", type: "boolean" },
        { name: "notes", type: "long_text" },
      ],
      linkFields: [
        {
          name: "person",
          type: "link_row",
          link_row_table_id: tableIds.PERSON,
        },
        {
          name: "community",
          type: "link_row",
          link_row_table_id: tableIds.SENIOR_COMMUNITY,
        },
      ],
      lookupFields: [],
      formulaFields: [],
    },

    // -----------------------------------------------------------------
    // 7. SENIOR_RELATIONSHIP
    // -----------------------------------------------------------------
    SENIOR_RELATIONSHIP: {
      nonLinkFields: [
        {
          name: "relationship_type",
          type: "single_select",
          select_options: [
            { value: "caregiver", color: "blue" },
            { value: "family", color: "green" },
            { value: "other", color: "light-gray" },
          ],
        },
        { name: "notes", type: "long_text" },
      ],
      linkFields: [
        {
          name: "senior",
          type: "link_row",
          link_row_table_id: tableIds.SENIOR,
        },
        {
          name: "related_person",
          type: "link_row",
          link_row_table_id: tableIds.PERSON,
        },
      ],
      lookupFields: [],
      formulaFields: [],
    },

    // -----------------------------------------------------------------
    // 8. VOLUNTEER
    // -----------------------------------------------------------------
    VOLUNTEER: {
      nonLinkFields: [
        { name: "school", type: "text" },
        { name: "onboarding_date", type: "date" },
        { name: "school_city", type: "text" },
        { name: "school_state", type: "text" },
        { name: "inactive_date", type: "date" },
        {
          name: "graduation_year",
          type: "number",
          number_decimal_places: 0,
        },
        { name: "birth_date", type: "date" },
        {
          name: "status",
          type: "single_select",
          select_options: [
            { value: "active", color: "green" },
            { value: "inactive", color: "red" },
            { value: "pending", color: "yellow" },
            { value: "training", color: "blue" },
          ],
        },
        { name: "last_training_date", type: "date" },
      ],
      linkFields: [
        {
          name: "person",
          type: "link_row",
          link_row_table_id: tableIds.PERSON,
        },
      ],
      lookupFields: [
        {
          name: "person_first_name",
          type: "lookup",
          through_field_name: "person",
          target_field_name: "first_name",
        },
        {
          name: "person_last_name",
          type: "lookup",
          through_field_name: "person",
          target_field_name: "last_name",
        },
      ],
      formulaFields: [
        {
          name: "display_name",
          type: "formula",
          formula:
            "concat(field('person_first_name'), ' ', field('person_last_name'))",
        },
      ],
    },

    // -----------------------------------------------------------------
    // 9. VOLUNTEER_STATUS_NOTE
    // -----------------------------------------------------------------
    VOLUNTEER_STATUS_NOTE: {
      nonLinkFields: [
        { name: "note", type: "long_text" },
        { name: "note_date", type: "date" },
      ],
      linkFields: [
        {
          name: "volunteer",
          type: "link_row",
          link_row_table_id: tableIds.VOLUNTEER,
        },
      ],
      lookupFields: [],
      formulaFields: [],
    },

    // -----------------------------------------------------------------
    // 10. VOLUNTEER_TEAM
    // -----------------------------------------------------------------
    VOLUNTEER_TEAM: {
      nonLinkFields: [
        {
          name: "call_day_of_week",
          type: "single_select",
          select_options: [
            { value: "Monday", color: "blue" },
            { value: "Tuesday", color: "green" },
            { value: "Wednesday", color: "yellow" },
            { value: "Thursday", color: "red" },
            { value: "Friday", color: "light-blue" },
            { value: "Saturday", color: "light-green" },
            { value: "Sunday", color: "light-gray" },
          ],
        },
        { name: "call_time", type: "text" },
        {
          name: "status",
          type: "single_select",
          select_options: [
            { value: "active", color: "green" },
            { value: "paused", color: "yellow" },
            { value: "inactive", color: "red" },
          ],
        },
        { name: "created_at", type: "date", date_include_time: true },
      ],
      linkFields: [
        {
          name: "senior",
          type: "link_row",
          link_row_table_id: tableIds.SENIOR,
        },
      ],
      lookupFields: [
        {
          name: "senior_name",
          type: "lookup",
          through_field_name: "senior",
          target_field_name: "display_name",
        },
      ],
      formulaFields: [
        {
          name: "team_name",
          type: "formula",
          formula:
            "concat(field('senior_name'), ' - ', field('call_day_of_week'), ' ', field('call_time'))",
        },
      ],
    },

    // -----------------------------------------------------------------
    // 11. TEAM_MEMBER
    // -----------------------------------------------------------------
    TEAM_MEMBER: {
      nonLinkFields: [
        { name: "start_date", type: "date" },
        { name: "end_date", type: "date" },
      ],
      linkFields: [
        {
          name: "team",
          type: "link_row",
          link_row_table_id: tableIds.VOLUNTEER_TEAM,
        },
        {
          name: "volunteer",
          type: "link_row",
          link_row_table_id: tableIds.VOLUNTEER,
        },
      ],
      lookupFields: [],
      formulaFields: [],
    },

    // -----------------------------------------------------------------
    // 12. MEETING
    // -----------------------------------------------------------------
    MEETING: {
      nonLinkFields: [
        {
          name: "meeting_day_of_week",
          type: "single_select",
          select_options: [
            { value: "Monday", color: "blue" },
            { value: "Tuesday", color: "green" },
            { value: "Wednesday", color: "yellow" },
            { value: "Thursday", color: "red" },
            { value: "Friday", color: "light-blue" },
            { value: "Saturday", color: "light-green" },
            { value: "Sunday", color: "light-gray" },
          ],
        },
        { name: "meeting_time", type: "text" },
        { name: "meeting_link", type: "url" },
        { name: "rocket_chat_room", type: "text" },
        { name: "call_support_instructions", type: "long_text" },
        { name: "status_notes", type: "long_text" },
        { name: "date_notes", type: "long_text" },
      ],
      linkFields: [
        {
          name: "team",
          type: "link_row",
          link_row_table_id: tableIds.VOLUNTEER_TEAM,
        },
      ],
      lookupFields: [
        {
          name: "team_name_display",
          type: "lookup",
          through_field_name: "team",
          target_field_name: "team_name",
        },
      ],
      formulaFields: [],
    },

    // -----------------------------------------------------------------
    // 13. MEETING_INSTANCE
    // -----------------------------------------------------------------
    MEETING_INSTANCE: {
      nonLinkFields: [
        { name: "instance_date", type: "date" },
        {
          name: "instance_start",
          type: "date",
          date_include_time: true,
        },
        { name: "instance_end", type: "date", date_include_time: true },
        {
          name: "instance_status",
          type: "single_select",
          select_options: [
            { value: "scheduled", color: "blue" },
            { value: "completed", color: "green" },
            { value: "canceled", color: "red" },
            { value: "no-show", color: "yellow" },
          ],
        },
        { name: "substitution_notes", type: "long_text" },
        { name: "calendar_event_id", type: "text" },
        { name: "date_notes", type: "long_text" },
      ],
      linkFields: [
        {
          name: "meeting",
          type: "link_row",
          link_row_table_id: tableIds.MEETING,
        },
      ],
      lookupFields: [],
      formulaFields: [],
    },

    // -----------------------------------------------------------------
    // 14. MEETING_ATTENDANCE
    // -----------------------------------------------------------------
    MEETING_ATTENDANCE: {
      nonLinkFields: [
        {
          name: "attendance_status",
          type: "single_select",
          select_options: [
            { value: "expected", color: "light-gray" },
            { value: "attended", color: "green" },
            { value: "late", color: "yellow" },
            { value: "absent", color: "red" },
            { value: "substitute", color: "blue" },
          ],
        },
        { name: "note", type: "long_text" },
      ],
      linkFields: [
        {
          name: "meeting_instance",
          type: "link_row",
          link_row_table_id: tableIds.MEETING_INSTANCE,
        },
        {
          name: "volunteer",
          type: "link_row",
          link_row_table_id: tableIds.VOLUNTEER,
        },
      ],
      lookupFields: [],
      formulaFields: [],
    },

    // -----------------------------------------------------------------
    // 15. FEEDBACK_FORM
    // need to check actual feedback forms to confirm these fields and types if not adjusting them to fit the data for now these are place holders.
    // -----------------------------------------------------------------
    FEEDBACK_FORM: {
      nonLinkFields: [
        {
          name: "submitted_at",
          type: "date",
          date_include_time: true,
        },
        { name: "rating", type: "rating", max_value: 5, style: "star" },
        {
          name: "overall_satisfaction",
          type: "rating",
          max_value: 5,
          style: "star",
        },
        {
          name: "connection_quality",
          type: "single_select",
          select_options: [
            { value: "good", color: "green" },
            { value: "fair", color: "yellow" },
            { value: "poor", color: "red" },
          ],
        },
        { name: "issues_noted", type: "long_text" },
        { name: "concerns_raised", type: "boolean" },
        { name: "follow_up_needed", type: "boolean" },
        { name: "comments", type: "long_text" },
        { name: "follow_up_note", type: "long_text" },
        { name: "concern_note", type: "long_text" },
      ],
      linkFields: [
        {
          name: "form_type",
          type: "link_row",
          link_row_table_id: tableIds.FORM_TYPE,
        },
        {
          name: "submitted_by_person",
          type: "link_row",
          link_row_table_id: tableIds.PERSON,
        },
        {
          name: "meeting_instance",
          type: "link_row",
          link_row_table_id: tableIds.MEETING_INSTANCE,
        },
        {
          name: "senior",
          type: "link_row",
          link_row_table_id: tableIds.SENIOR,
        },
      ],
      lookupFields: [],
      formulaFields: [],
    },

    // -----------------------------------------------------------------
    // 16. PROPOSED_CHANGE
    // Approval queue for calendar-affecting edits.
    // Non-admin users submit a row here instead of editing
    // MEETING_INSTANCE / TEAM_MEMBER / MEETING_ATTENDANCE directly.
    // N8N WF9 picks up new rows (approval_status = pending) and routes
    // them to the admin for approve/reject before applying any change.
    // -----------------------------------------------------------------
    PROPOSED_CHANGE: {
      nonLinkFields: [
        // When the proposal was submitted
        { name: "proposed_at", type: "date", date_include_time: true },
        // What kind of calendar change is being requested
        {
          name: "change_type",
          type: "single_select",
          select_options: [
            { value: "cancel_instance", color: "red" },
            { value: "team_change",     color: "blue" },
            { value: "substitution",    color: "yellow" },
            { value: "reschedule",      color: "light-blue" },
          ],
        },
        // Human-readable summary written by the proposer
        { name: "description", type: "long_text" },
        // Only used when change_type = reschedule
        { name: "new_date", type: "date" },
        // Any extra context from the proposer
        { name: "notes", type: "long_text" },
        // Current state of the request — WF9 updates this on approve/reject
        {
          name: "approval_status",
          type: "single_select",
          select_options: [
            { value: "pending",  color: "yellow" },
            { value: "approved", color: "green" },
            { value: "rejected", color: "red" },
          ],
        },
        // When the admin acted on the request
        { name: "reviewed_at", type: "date", date_include_time: true },
        // Populated by WF9 on rejection so proposer knows why
        { name: "rejection_reason", type: "long_text" },
      ],
      linkFields: [
        // Who submitted the proposal
        {
          name: "proposed_by",
          type: "link_row",
          link_row_table_id: tableIds.PERSON,
        },
        // Linked when change_type = cancel_instance or reschedule
        {
          name: "meeting_instance",
          type: "link_row",
          link_row_table_id: tableIds.MEETING_INSTANCE,
        },
        // Linked when change_type = team_change (the member departing)
        {
          name: "team_member",
          type: "link_row",
          link_row_table_id: tableIds.TEAM_MEMBER,
        },
        // Linked when change_type = substitution
        {
          name: "meeting_attendance",
          type: "link_row",
          link_row_table_id: tableIds.MEETING_ATTENDANCE,
        },
        // Admin who approved or rejected — set by WF9 on resolution
        {
          name: "reviewed_by",
          type: "link_row",
          link_row_table_id: tableIds.PERSON,
        },
      ],
      lookupFields: [],
      formulaFields: [],
    },
  };
}

// =============================================================================
// Main execution — runs all 7 phases in sequence
// =============================================================================

async function main() {
  console.log("=".repeat(60));
  console.log("CTR-CRM Baserow Table Creation Script");
  console.log(`Target: ${BASEROW_URL} (Database ID: ${BASEROW_DATABASE_ID})`);
  console.log("=".repeat(60));

  // -------------------------------------------------------------------------
  // Phase 0: Authenticate — get JWT token for schema operations
  // -------------------------------------------------------------------------
  console.log("\n--- Phase 0: Authenticating ---\n");
  await login();

  // -------------------------------------------------------------------------
  // Phase 1: Create all 15 table shells
  // -------------------------------------------------------------------------
  console.log("\n--- Phase 1: Creating table shells ---\n");

  const TABLE_NAMES = [
    "SENIOR_COMMUNITY",        //  1 — no dependencies
    "FORM_TYPE",               //  2 — no dependencies
    "PERSON",                  //  3 — no dependencies
    "PERSON_PHONE",            //  4 → PERSON
    "SENIOR",                  //  5 → PERSON, SENIOR_COMMUNITY
    "CAREGIVER",               //  6 → PERSON, SENIOR_COMMUNITY
    "SENIOR_RELATIONSHIP",     //  7 → SENIOR, PERSON
    "VOLUNTEER",               //  8 → PERSON
    "VOLUNTEER_STATUS_NOTE",   //  9 → VOLUNTEER
    "VOLUNTEER_TEAM",          // 10 → SENIOR
    "TEAM_MEMBER",             // 11 → VOLUNTEER_TEAM, VOLUNTEER
    "MEETING",                 // 12 → VOLUNTEER_TEAM
    "MEETING_INSTANCE",        // 13 → MEETING
    "MEETING_ATTENDANCE",      // 14 → MEETING_INSTANCE, VOLUNTEER
    "FEEDBACK_FORM",           // 15 → FORM_TYPE, PERSON, MEETING_INSTANCE, SENIOR
    "PROPOSED_CHANGE",         // 16 → PERSON, MEETING_INSTANCE, TEAM_MEMBER, MEETING_ATTENDANCE
  ];

  // tableIds will map table name → Baserow table ID
  const tableIds = {};

  for (const name of TABLE_NAMES) {
    const table = await createTable(name);
    tableIds[name] = table.id;
  }

  console.log("\n  All 16 tables created.\n");

  // -------------------------------------------------------------------------
  // Phase 2: Add non-link fields to each table
  // -------------------------------------------------------------------------
  console.log("--- Phase 2: Adding non-link fields ---\n");

  const fieldDefs = buildFieldDefinitions(tableIds);

  // We also need to track field IDs for lookups (we need the link field ID)
  // Store created field IDs: { tableName: { fieldName: fieldId } }
  const fieldIds = {};

  for (const tableName of TABLE_NAMES) {
    const def = fieldDefs[tableName];
    if (!def) continue;

    fieldIds[tableName] = {};
    console.log(`  Table: ${tableName}`);

    for (const field of def.nonLinkFields) {
      const created = await createField(tableIds[tableName], field);
      fieldIds[tableName][field.name] = created.id;
    }
  }

  // -------------------------------------------------------------------------
  // Phase 3: Add link_row fields
  // -------------------------------------------------------------------------
  console.log("\n--- Phase 3: Adding link fields ---\n");

  for (const tableName of TABLE_NAMES) {
    const def = fieldDefs[tableName];
    if (!def || def.linkFields.length === 0) continue;

    console.log(`  Table: ${tableName}`);
    for (const field of def.linkFields) {
      const created = await createField(tableIds[tableName], field);
      fieldIds[tableName][field.name] = created.id;
    }
  }

  // -------------------------------------------------------------------------
  // Phases 4 & 5: Computed fields (lookups + formulas) in dependency order
  //
  // The dependency chain for computed fields is:
  //   Round 1 lookups: SENIOR, VOLUNTEER → target plain text fields in PERSON
  //   Round 1 formulas: PERSON (full_name), SENIOR (display_name), VOLUNTEER (display_name)
  //   Round 2 lookups: VOLUNTEER_TEAM (senior_name) → targets SENIOR.display_name
  //   Round 2 formulas: VOLUNTEER_TEAM (team_name) — uses senior_name lookup
  //   Round 3 lookups: MEETING (team_name_display) → targets VOLUNTEER_TEAM.team_name
  //
  // Processing all lookups then all formulas (as separate phases) fails because
  // VOLUNTEER_TEAM.senior_name lookup needs SENIOR.display_name (a formula) to exist first.
  // -------------------------------------------------------------------------
  console.log(
    "\n--- Phases 4 & 5: Computed fields (in dependency order) ---\n",
  );

  /**
   * Creates a single lookup field on a table.
   * Resolves the through_field_id and target_field_id automatically from
   * the fieldIds map (which is populated as each field is created).
   *
   * @param {string} tableName - The table to add the lookup field to
   * @param {object} lookupDef - { name, through_field_name, target_field_name }
   */
  async function createLookupField(tableName, lookupDef) {
    // The "through" field is the link_row field in this table
    const throughFieldId = fieldIds[tableName][lookupDef.through_field_name];
    if (!throughFieldId) {
      throw new Error(
        `Cannot find link field "${lookupDef.through_field_name}" in ${tableName}. ` +
          `Make sure Phase 3 ran successfully.`,
      );
    }

    // Find which table the link field points to
    const linkFieldDef = fieldDefs[tableName].linkFields.find(
      (f) => f.name === lookupDef.through_field_name,
    );
    const linkedTableId = linkFieldDef.link_row_table_id;
    const linkedTableName = Object.entries(tableIds).find(
      ([, id]) => id === linkedTableId,
    )?.[0];

    // Get the target field ID — must already exist in fieldIds by this point
    const targetFieldId =
      fieldIds[linkedTableName]?.[lookupDef.target_field_name];
    if (!targetFieldId) {
      throw new Error(
        `Cannot find field "${lookupDef.target_field_name}" in table ${linkedTableName}. ` +
          `This usually means a dependency wasn't created yet — check the round ordering.`,
      );
    }

    const created = await createField(tableIds[tableName], {
      name: lookupDef.name,
      type: "lookup",
      through_field_id: throughFieldId,
      target_field_id: targetFieldId,
    });
    fieldIds[tableName][lookupDef.name] = created.id;
  }

  /**
   * Creates a single formula field on a table.
   *
   * @param {string} tableName - The table to add the formula field to
   * @param {object} formulaDef - { name, type: "formula", formula: "..." }
   */
  async function createFormulaField(tableName, formulaDef) {
    const created = await createField(tableIds[tableName], formulaDef);
    fieldIds[tableName][formulaDef.name] = created.id;
  }

  // --- Round 1: Lookups targeting plain text fields (safe after Phase 3) ---
  console.log(
    "  Round 1 — Lookups (SENIOR, VOLUNTEER → PERSON plain text fields)\n",
  );
  for (const tableName of ["SENIOR", "VOLUNTEER"]) {
    console.log(`  Table: ${tableName}`);
    for (const lookupDef of fieldDefs[tableName].lookupFields) {
      await createLookupField(tableName, lookupDef);
    }
  }

  // --- Round 1: Formulas using plain fields or Round 1 lookups ---
  console.log("\n  Round 1 — Formulas (PERSON, SENIOR, VOLUNTEER)\n");
  for (const tableName of ["PERSON", "SENIOR", "VOLUNTEER"]) {
    if (!fieldDefs[tableName].formulaFields.length) continue;
    console.log(`  Table: ${tableName}`);
    for (const formulaDef of fieldDefs[tableName].formulaFields) {
      await createFormulaField(tableName, formulaDef);
    }
  }

  // --- Round 2: Lookups targeting Round 1 formula fields ---
  // VOLUNTEER_TEAM.senior_name → SENIOR.display_name (just created above)
  console.log("\n  Round 2 — Lookups (VOLUNTEER_TEAM → SENIOR.display_name)\n");
  console.log(`  Table: VOLUNTEER_TEAM`);
  for (const lookupDef of fieldDefs.VOLUNTEER_TEAM.lookupFields) {
    await createLookupField("VOLUNTEER_TEAM", lookupDef);
  }

  // --- Round 2: Formulas using Round 2 lookups ---
  // VOLUNTEER_TEAM.team_name uses senior_name (just created above)
  console.log("\n  Round 2 — Formulas (VOLUNTEER_TEAM.team_name)\n");
  console.log(`  Table: VOLUNTEER_TEAM`);
  for (const formulaDef of fieldDefs.VOLUNTEER_TEAM.formulaFields) {
    await createFormulaField("VOLUNTEER_TEAM", formulaDef);
  }

  // --- Round 3: Lookups targeting Round 2 formula fields ---
  // MEETING.team_name_display → VOLUNTEER_TEAM.team_name (just created above)
  console.log("\n  Round 3 — Lookups (MEETING → VOLUNTEER_TEAM.team_name)\n");
  console.log(`  Table: MEETING`);
  for (const lookupDef of fieldDefs.MEETING.lookupFields) {
    await createLookupField("MEETING", lookupDef);
  }

  // -------------------------------------------------------------------------
  // Phase 6: Seed FORM_TYPE with 4 required rows
  // -------------------------------------------------------------------------
  console.log("\n--- Phase 6: Seeding FORM_TYPE table ---\n");

  const formTypeSeeds = [
    {
      Name: "volunteer_per_meeting",
      frequency: "per_meeting",
      target: "meeting_instance",
    },
    {
      Name: "call_support_per_meeting",
      frequency: "per_meeting",
      target: "meeting_instance",
    },
    { Name: "senior_monthly", frequency: "monthly", target: "senior" },
    { Name: "caregiver_monthly", frequency: "monthly", target: "senior" },
  ];

  for (const seed of formTypeSeeds) {
    console.log(`  Seeding: ${seed.Name}`);
    await createRow(tableIds.FORM_TYPE, seed);
  }

  // -------------------------------------------------------------------------
  // Phase 7: Print summary
  // -------------------------------------------------------------------------
  console.log("\n" + "=".repeat(60));
  console.log("SETUP COMPLETE");
  console.log("=".repeat(60));
  console.log(
    "\nTable ID mapping (save these for your .env / configuration):\n",
  );

  for (const [name, id] of Object.entries(tableIds)) {
    console.log(`  BASEROW_TABLE_${name}=${id}`);
  }

  console.log("\n" + "-".repeat(60));
  console.log("Next steps:");
  console.log("  1. Open Baserow at " + BASEROW_URL);
  console.log("  2. Verify all 16 tables exist with correct fields");
  console.log("  3. Check that FORM_TYPE has 4 seed rows");
  console.log(
    '  4. Rename the auto-created "Name" primary field as needed per table',
  );
  console.log("  5. Create views and form views as described in the plan");
  console.log("  6. Copy the table IDs above into your frontend .env");
  console.log("  7. In PROPOSED_CHANGE: create a filtered view 'Pending Approvals'");
  console.log("     (filter: approval_status = pending, sort: proposed_at ASC)");
  console.log("  8. Create a shareable Baserow form view on PROPOSED_CHANGE");
  console.log("     for Proposers — show: change_type, description, meeting_instance,");
  console.log("     team_member, meeting_attendance, new_date, notes, proposed_by");
  console.log("=".repeat(60));
}

// Run the script
main().catch((err) => {
  console.error("\nFATAL ERROR:", err.message);
  process.exit(1);
});
