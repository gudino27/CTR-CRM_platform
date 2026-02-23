/**
 * setupAppUsers.js
 *
 * PURPOSE:
 *   Creates a dedicated APP_USERS table in the CRM database and wires it to
 *   the Baserow App Builder's user source so that app login works.
 *
 * WHY A SEPARATE TABLE:
 *   The App Builder's "local_baserow" user source treats every row in the
 *   chosen table as a login account. Pointing it at PERSON would expose
 *   seniors, volunteers and caregivers as potential logins — wrong.
 *   APP_USERS is a small, explicit whitelist of staff who can log in.
 *
 * APP_USERS FIELDS:
 *   email    (Email)         — Login identifier, used by auth_form element
 *   password (Password)     — Baserow encrypts this with bcrypt internally.
 *                             Required by the local_baserow user source.
 *                             Set via App Builder UI or API after table creation.
 *   name     (Text)         — Display name shown inside the app
 *   role     (Single Select) — "admin" | "editor" | "proposer"
 *                             Controls which pages they can access:
 *                               admin    → all pages including Approvals
 *                               editor   → all pages except Approvals
 *                               proposer → read-only, can submit PROPOSED_CHANGE
 *   person   (Link → PERSON) — Optional link to their PERSON record (for context)
 *   notes    (Long Text)    — Optional staff notes
 *
 * NOTE ON PASSWORDS:
 *   The "password" field type in Baserow stores a bcrypt hash — never plaintext.
 *   Set user passwords via:
 *     App Builder UI: Settings → User sources → Baserow table auth → Users tab
 *     API: POST /api/user-source/90/user/ with { email, password, role }
 *
 * WHAT IT DOES:
 *   Phase 1: Create APP_USERS table with all fields
 *   Phase 2: Wire user source 90 to the new table (email/name/role field IDs)
 *   Phase 3: Print the table ID for .env and instructions for adding users
 *
 * USAGE:
 *   cd code/scripts
 *   node setupAppUsers.js
 *
 * SAFE TO RE-RUN: NO — creates a new table each run. Only run once.
 *   If you need to reset, delete the APP_USERS table in Baserow and re-run.
 *
 * ENV VARS (same .env as other scripts):
 *   BASEROW_URL       — e.g. http://192.168.10.95
 *   BASEROW_EMAIL     — Admin login email
 *   BASEROW_PASSWORD  — Admin login password
 *   BASEROW_DATABASE_ID — Database ID (237)
 *   BASEROW_TABLE_PERSON — PERSON table ID (for the link field)
 *
 * =============================================================================
 */

import { config } from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, ".env") });

// =============================================================================
// Configuration
// =============================================================================

const BASEROW_URL    = process.env.BASEROW_URL;
const BASEROW_EMAIL  = process.env.BASEROW_EMAIL;
const BASEROW_PASSWORD = process.env.BASEROW_PASSWORD;
const DATABASE_ID    = parseInt(process.env.BASEROW_DATABASE_ID, 10);
const PERSON_TABLE_ID = parseInt(process.env.BASEROW_TABLE_PERSON, 10);

// The App Builder user source ID — confirmed as 90 on this instance
const USER_SOURCE_ID = 90;

// Validate required env vars
const missing = ["BASEROW_URL", "BASEROW_EMAIL", "BASEROW_PASSWORD", "BASEROW_DATABASE_ID"]
  .filter((k) => !process.env[k]);
if (missing.length > 0) {
  console.error(`ERROR: Missing env vars: ${missing.join(", ")}`);
  process.exit(1);
}

// =============================================================================
// Runtime state
// =============================================================================

let JWT_TOKEN = null;

// =============================================================================
// HTTP helper
// =============================================================================

async function api(endpoint, method = "GET", body = null) {
  const url = `${BASEROW_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      Authorization: `JWT ${JWT_TOKEN}`,
      "Content-Type": "application/json",
    },
  };
  if (body !== null) options.body = JSON.stringify(body);

  const response = await fetch(url, options);
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`${method} ${endpoint} → ${response.status}\n${err}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

// =============================================================================
// Auth
// =============================================================================

async function login() {
  console.log(`\n[Auth] Logging in as ${BASEROW_EMAIL}...`);
  const res = await fetch(`${BASEROW_URL}/api/user/token-auth/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: BASEROW_EMAIL, password: BASEROW_PASSWORD }),
  });
  if (!res.ok) throw new Error(`Login failed: ${res.status}\n${await res.text()}`);
  const data = await res.json();
  JWT_TOKEN = data.token || data.access_token;
  console.log("  ✓ JWT token obtained.");
}

// =============================================================================
// Phase 1: Create APP_USERS table
// =============================================================================

async function createField(tableId, fieldDef) {
  console.log(`    + ${fieldDef.name} (${fieldDef.type})`);
  return api(`/api/database/fields/table/${tableId}/`, "POST", fieldDef);
}

async function createAppUsersTable() {
  console.log("\n[Phase 1] Creating APP_USERS table...");

  // Create the table shell (Baserow auto-creates a "Name" primary field)
  const table = await api(`/api/database/tables/database/${DATABASE_ID}/`, "POST", {
    name: "APP_USERS",
  });
  const tableId = table.id;
  console.log(`  ✓ Table created — ID: ${tableId}`);

  // Rename the auto-created "Name" primary field to "name"
  // First, get its ID
  const fields = await api(`/api/database/fields/table/${tableId}/`);
  const primaryField = fields.find((f) => f.primary) ?? fields[0];
  if (primaryField) {
    await api(`/api/database/fields/${primaryField.id}/`, "PATCH", { name: "name" });
    console.log(`    ~ Renamed primary field to "name" (ID: ${primaryField.id})`);
  }

  // Add email field — used as the login identifier
  const emailField = await createField(tableId, {
    name: "email",
    type: "email",
  });

  // Add password field — Baserow encrypts this internally (bcrypt).
  // Required by the local_baserow user source for authentication.
  // Never stored in plaintext; set via App Builder UI or API.
  const passwordField = await createField(tableId, {
    name: "password",
    type: "password",
  });

  // Add role field — single select with the 3 app roles
  // These role values must match what you configure in the App Builder
  // page visibility settings (role_type / roles array).
  const roleField = await createField(tableId, {
    name: "role",
    type: "single_select",
    select_options: [
      { value: "admin",    color: "red" },    // full access + Approvals page
      { value: "editor",   color: "blue" },   // all pages except Approvals
      { value: "proposer", color: "green" },  // read-only + submit PROPOSED_CHANGE
    ],
  });

  // Add optional link to PERSON (for cross-referencing staff profiles)
  let personLinkField = null;
  if (!isNaN(PERSON_TABLE_ID)) {
    personLinkField = await createField(tableId, {
      name: "person",
      type: "link_row",
      link_row_table_id: PERSON_TABLE_ID,
    });
  } else {
    console.log("     BASEROW_TABLE_PERSON not set — skipping person link field");
  }

  // Add notes field
  await createField(tableId, {
    name: "notes",
    type: "long_text",
  });

  console.log(`\n  ✓ APP_USERS table ready — ${fields.length + 5} fields total`);

  return {
    tableId,
    primaryFieldId:  primaryField?.id,
    emailFieldId:    emailField.id,
    passwordFieldId: passwordField.id,
    roleFieldId:     roleField.id,
  };
}

// =============================================================================
// Phase 2: Wire user source to APP_USERS table
// =============================================================================

async function wireUserSource({ tableId, primaryFieldId, emailFieldId, passwordFieldId, roleFieldId }) {
  console.log(`\n[Phase 2] Wiring user source ${USER_SOURCE_ID} to APP_USERS (table ${tableId})...`);

  await api(`/api/user-source/${USER_SOURCE_ID}/`, "PATCH", {
    table_id:          tableId,
    email_field_id:    emailFieldId,
    name_field_id:     primaryFieldId,   // "name" field = display name in app
    password_field_id: passwordFieldId,  // "password" field = bcrypt-hashed by Baserow
    role_field_id:     roleFieldId,      // "role" field = app permission level
  });

  console.log("  ✓ User source configured:");
  console.log(`    table_id          : ${tableId}`);
  console.log(`    email_field_id    : ${emailFieldId}`);
  console.log(`    name_field_id     : ${primaryFieldId}`);
  console.log(`    password_field_id : ${passwordFieldId}`);
  console.log(`    role_field_id     : ${roleFieldId}`);
}

// =============================================================================
// Main
// =============================================================================

async function main() {
  const bar = "=".repeat(70);
  console.log(bar);
  console.log("  CTR-CRM — setupAppUsers.js");
  console.log(bar);
  console.log(`  Baserow URL  : ${BASEROW_URL}`);
  console.log(`  Database ID  : ${DATABASE_ID}`);

  await login();

  const tableInfo = await createAppUsersTable();
  await wireUserSource(tableInfo);

  console.log("\n" + bar);
  console.log("  SETUP COMPLETE");
  console.log(bar);
  console.log(`
  APP_USERS table ID: ${tableInfo.tableId}

  Add this to your .env file:
    BASEROW_TABLE_APP_USERS=${tableInfo.tableId}

  ── NEXT STEPS ────────────────────────────────────────────────────────

  1. ADD YOUR FIRST ADMIN USER (via Baserow UI — fastest):
       Baserow → CRM database → APP_USERS table → + Row
       Fill in: name, email, role = admin
       Then set the password in the App Builder:
         App Builder → Settings → User sources → "Baserow table auth"
         → Users tab → click the user → set password

  2. ADD USERS VIA API (for bulk add):
       POST /api/user-source/${USER_SOURCE_ID}/user/ with body:
         { "email": "...", "password": "...", "role": "admin" }
       The API creates the row AND sets the password in one step.

  3. CONFIGURE PAGE VISIBILITY BY ROLE:
       App Builder → Approvals page → Visibility tab
         → "Logged in" → Role type: "Only for roles" → select "admin"
       All other pages: "Logged in" with no role restriction (all logged-in users)

  4. ROLE DEFINITIONS:
       admin    → can see all pages + directly edit calendar tables in Baserow
       editor   → can see all pages except Approvals + CRUD non-calendar data
       proposer → read-only in app + can submit PROPOSED_CHANGE rows for approval

  5. ADD AUTH_FORM LOGIN PAGE:
       App Builder → + New page → name "Login", path "/login"
       Add element type "auth_form" → this handles login/logout automatically
       The auth_form redirects to Dashboard on successful login.
`);
  console.log(bar);
}

main().catch((err) => {
  console.error("\nFATAL ERROR:", err.message);
  process.exit(1);
});
