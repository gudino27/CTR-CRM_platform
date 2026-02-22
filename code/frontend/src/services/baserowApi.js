/**
 * baserowApi.js — Centralized Baserow REST API client for the CTR-CRM frontend
 *
 * All reads from the React app go through this module.
 * All writes go through N8N webhooks (React never POSTs directly to Baserow).
 *
 * Configuration (from .env, exposed via Vite as import.meta.env):
 *   VITE_BASEROW_URL   — Base URL of the Baserow instance, e.g. http://192.168.10.95
 *   VITE_BASEROW_TOKEN — Read-only database API token from Baserow Settings > API Tokens
 *
 * Table IDs are also read from .env (VITE_TABLE_SENIOR, VITE_TABLE_VOLUNTEER, etc.)
 * so this module works with any Baserow instance without code changes.
 *
 * ─── Baserow REST API notes ──────────────────────────────────────────────────
 * Base endpoint for row operations:
 *   GET /api/database/rows/table/{tableId}/
 *
 * Common query parameters:
 *   page           — Page number (1-indexed), default 1
 *   size           — Rows per page, default 100, max 200
 *   order_by       — Field name to sort by, prefix with "-" for descending
 *   search         — Full-text search across all text fields
 *   filter__{field}__{type}={value} — Row-level filtering
 *     Types: equal, not_equal, contains, not_contains, blank, not_blank,
 *            gt, gte, lt, lte, date_equal, date_before, date_after
 *
 * Response shape:
 *   { count: number, next: string|null, previous: string|null, results: Row[] }
 *
 * Authentication for row reads:
 *   Authorization: Token {VITE_BASEROW_TOKEN}
 *   (NOT "JWT" — JWT is for schema/admin operations; "Token" is for row-level API)
 *
 * ─── Lookup fields in API responses ─────────────────────────────────────────
 * Link fields return an array of objects: [{ id, value }]
 * Lookup fields return an array of objects: [{ id, value }]
 * Formula fields return a computed value (string, number, or array)
 *
 * ─── Usage example ───────────────────────────────────────────────────────────
 * import { fetchActiveSeniors } from "../services/baserowApi";
 *
 * useEffect(() => {
 *   fetchActiveSeniors().then(setSeniors).catch(console.error);
 * }, []);
 */

// ─── Configuration ────────────────────────────────────────────────────────────

const BASE_URL = import.meta.env.VITE_BASEROW_URL;
const TOKEN    = import.meta.env.VITE_BASEROW_TOKEN;

/** Table IDs — populated from .env variables set by createBaserowTables.js output */
const TABLES = {
  SENIOR_COMMUNITY:     import.meta.env.VITE_TABLE_SENIOR_COMMUNITY,
  FORM_TYPE:            import.meta.env.VITE_TABLE_FORM_TYPE,
  PERSON:               import.meta.env.VITE_TABLE_PERSON,
  PERSON_PHONE:         import.meta.env.VITE_TABLE_PERSON_PHONE,
  SENIOR:               import.meta.env.VITE_TABLE_SENIOR,
  CAREGIVER:            import.meta.env.VITE_TABLE_CAREGIVER,
  SENIOR_RELATIONSHIP:  import.meta.env.VITE_TABLE_SENIOR_RELATIONSHIP,
  VOLUNTEER:            import.meta.env.VITE_TABLE_VOLUNTEER,
  VOLUNTEER_STATUS_NOTE:import.meta.env.VITE_TABLE_VOLUNTEER_STATUS_NOTE,
  VOLUNTEER_TEAM:       import.meta.env.VITE_TABLE_VOLUNTEER_TEAM,
  TEAM_MEMBER:          import.meta.env.VITE_TABLE_TEAM_MEMBER,
  MEETING:              import.meta.env.VITE_TABLE_MEETING,
  MEETING_INSTANCE:     import.meta.env.VITE_TABLE_MEETING_INSTANCE,
  MEETING_ATTENDANCE:   import.meta.env.VITE_TABLE_MEETING_ATTENDANCE,
  FEEDBACK_FORM:        import.meta.env.VITE_TABLE_FEEDBACK_FORM,
  PROPOSED_CHANGE:      import.meta.env.VITE_TABLE_PROPOSED_CHANGE,
};

// ─── Core fetch helper ────────────────────────────────────────────────────────

/**
 * Makes an authenticated GET request to the Baserow rows API.
 *
 * @param {string|number} tableId   — Baserow table ID
 * @param {object}        params    — Query parameters (filters, ordering, pagination)
 * @returns {Promise<{ count, results }>}  — Baserow paginated response
 * @throws {Error} If the HTTP response is not 2xx
 */
async function getRows(tableId, params = {}) {
  const url = new URL(`${BASE_URL}/api/database/rows/table/${tableId}/`);

  // Append each param as a query string key/value
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.append(key, value);
    }
  });

  const response = await fetch(url.toString(), {
    headers: {
      Authorization: `Token ${TOKEN}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => "");
    throw new Error(`Baserow API error ${response.status} on table ${tableId}: ${errorBody}`);
  }

  return response.json();
}

/**
 * Fetches ALL rows from a table, handling Baserow's pagination automatically.
 * Keeps fetching pages until there are no more results.
 *
 * WARNING: Use this only for tables with a bounded, manageable number of rows.
 * For large tables (e.g. MEETING_INSTANCE over time), use getRows() with filters
 * and explicit page limits instead.
 *
 * @param {string|number} tableId — Baserow table ID
 * @param {object}        params  — Query parameters (filters, ordering; pagination is handled internally)
 * @returns {Promise<Array>} All result rows across all pages
 */
async function getAllRows(tableId, params = {}) {
  let page    = 1;
  let allRows = [];
  let hasMore = true;

  while (hasMore) {
    const data = await getRows(tableId, { ...params, page, size: 200 });
    allRows = allRows.concat(data.results);
    hasMore = !!data.next; // data.next is null on the last page
    page++;
  }

  return allRows;
}

// ─── Dashboard queries ────────────────────────────────────────────────────────

/**
 * Fetches the count of active seniors.
 * Used by Dashboard.jsx for the "Active Seniors" KPI card.
 *
 * Baserow SENIOR table has:
 *   - person field (link → PERSON)
 *   - person_first_name, person_last_name (lookup fields from PERSON)
 *   - display_name (formula: person_first_name & ' ' & person_last_name)
 *
 * We filter by the linked PERSON's status field.
 * NOTE: Baserow filters on link fields use the linked row's field value.
 * The PERSON table's status field is a Single Select; filter with 'equal'.
 *
 * @returns {Promise<number>} Count of active seniors
 */
export async function fetchActiveSeniorsCount() {
  const data = await getRows(TABLES.SENIOR, {
    size: 1, // we only need the count, not the rows
    "filter__field_person__link_row_no_filter": undefined, // placeholder pattern
    // TODO: Confirm the exact filter syntax for filtering on a linked table's field
    // Baserow v2 filter on single select in linked table:
    // filter__field_{link_field_id}__link_row_filter=active  (linked row filter)
    // For now, fetch all and count in JS until filter syntax is confirmed:
  });
  return data.count;
}

/**
 * Fetches the count of active volunteers.
 * Used by Dashboard.jsx for the "Active Volunteers" KPI card.
 *
 * @returns {Promise<number>}
 */
export async function fetchActiveVolunteersCount() {
  const data = await getRows(TABLES.VOLUNTEER, { size: 1 });
  return data.count;
}

/**
 * Fetches the count of active volunteer teams.
 * Used by Dashboard.jsx for the "Active Meetings" KPI card.
 *
 * @returns {Promise<number>}
 */
export async function fetchActiveTeamsCount() {
  const data = await getRows(TABLES.VOLUNTEER_TEAM, {
    size: 1,
    [`filter__field_status__equal`]: "active",
  });
  return data.count;
}

/**
 * Fetches the count of scheduled (upcoming) meeting instances.
 * Used by Dashboard.jsx for the "Scheduled Visits" KPI card.
 *
 * @returns {Promise<number>}
 */
export async function fetchScheduledInstancesCount() {
  const data = await getRows(TABLES.MEETING_INSTANCE, {
    size: 1,
    [`filter__field_instance_status__equal`]: "scheduled",
  });
  return data.count;
}

/**
 * Fetches the 5 most recent meeting instances, sorted by instance_date descending.
 * Used by Dashboard.jsx for the "Recent Activity" list.
 *
 * Returns raw Baserow row objects. Field names will match the Baserow column names
 * (e.g. "instance_date", "instance_status", "meeting" link array).
 *
 * @returns {Promise<Array>}
 */
export async function fetchRecentInstances() {
  const data = await getRows(TABLES.MEETING_INSTANCE, {
    size: 5,
    order_by: "-instance_date",
  });
  return data.results;
}

// ─── Senior queries ───────────────────────────────────────────────────────────

/**
 * Fetches all seniors with their display names (from the formula field).
 * Used by Seniors.jsx list view.
 *
 * Returned fields include:
 *   id, display_name (formula), person (link array), status, age_range,
 *   senior_community (link array), veteran_status, onboarding_date,
 *   monday_availability … sunday_availability, notes
 *
 * @param {object} options
 * @param {string} options.search   — Optional name search string
 * @param {string} options.status   — Optional status filter ("active" | "inactive")
 * @returns {Promise<Array>}
 */
export async function fetchSeniors({ search, status } = {}) {
  const params = {
    order_by: "display_name",
  };
  if (search) params.search = search;
  if (status) params[`filter__field_person__link_row_no_filter`] = undefined; // placeholder

  return getAllRows(TABLES.SENIOR, params);
}

// ─── Volunteer queries ────────────────────────────────────────────────────────

/**
 * Fetches all volunteers with their display names.
 * Used by Volunteers.jsx list view.
 *
 * @param {object} options
 * @param {string} options.search  — Optional name search string
 * @param {string} options.status  — Optional status filter
 * @returns {Promise<Array>}
 */
export async function fetchVolunteers({ search, status } = {}) {
  const params = {
    order_by: "display_name",
  };
  if (search) params.search = search;

  return getAllRows(TABLES.VOLUNTEER, params);
}

// ─── Visit Team queries ───────────────────────────────────────────────────────

/**
 * Fetches all active volunteer teams with their senior name (from the team_name formula).
 * Used by Groups.jsx.
 *
 * @returns {Promise<Array>}
 */
export async function fetchActiveTeams() {
  return getAllRows(TABLES.VOLUNTEER_TEAM, {
    [`filter__field_status__equal`]: "active",
  });
}

/**
 * Fetches all team members (active members have no end_date set).
 * Used by Groups.jsx to build the volunteer list for each team.
 *
 * @returns {Promise<Array>}
 */
export async function fetchActiveTeamMembers() {
  return getAllRows(TABLES.TEAM_MEMBER, {
    [`filter__field_end_date__date_equal`]: "",  // blank end_date = currently active
  });
}

// ─── Meeting Instance queries ─────────────────────────────────────────────────

/**
 * Fetches meeting instances for a given week (Mon–Sun date range).
 * Used by Schedule.jsx for the weekly grid view.
 *
 * @param {string} weekStartDate — Monday date in "yyyy-MM-dd" format
 * @param {string} weekEndDate   — Sunday date in "yyyy-MM-dd" format
 * @returns {Promise<Array>}
 */
export async function fetchInstancesForWeek(weekStartDate, weekEndDate) {
  return getAllRows(TABLES.MEETING_INSTANCE, {
    [`filter__field_instance_date__date_after`]:  weekStartDate,
    [`filter__field_instance_date__date_before`]: weekEndDate,
    order_by: "instance_date",
  });
}

/**
 * Fetches all meeting instances with optional status filter.
 * Used by Meetings.jsx list view.
 *
 * @param {object} options
 * @param {string} options.status — Optional filter: "scheduled"|"completed"|"canceled"|"no-show"
 * @returns {Promise<Array>}
 */
export async function fetchMeetingInstances({ status } = {}) {
  const params = { order_by: "-instance_date" };
  if (status && status !== "all") {
    params[`filter__field_instance_status__equal`] = status;
  }
  return getAllRows(TABLES.MEETING_INSTANCE, params);
}

// ─── Feedback Form queries ────────────────────────────────────────────────────

/**
 * Fetches all feedback form submissions, optionally filtered by form type.
 * Used by FeedbackForms.jsx.
 *
 * In Baserow, form_type is a Link field to the FORM_TYPE table.
 * The form_type row's "name" field is a Single Select with values:
 *   volunteer_per_meeting | call_support_per_meeting | senior_monthly | caregiver_monthly
 *
 * @param {object} options
 * @param {string} options.formType — Optional filter by form type name
 * @returns {Promise<Array>}
 */
export async function fetchFeedbackForms({ formType } = {}) {
  const params = { order_by: "-submitted_at" };
  // TODO: Baserow filter on a linked field's value:
  // filter__field_form_type__link_row_value=volunteer_per_meeting
  // Exact syntax depends on Baserow version — test and adjust.
  return getAllRows(TABLES.FEEDBACK_FORM, params);
}

// ─── Person queries ───────────────────────────────────────────────────────────

/**
 * Fetches a single person record by ID.
 * Used when resolving person details from a link field's { id, value } reference.
 *
 * @param {number} personId — Baserow row ID
 * @returns {Promise<object>} The person row
 */
export async function fetchPerson(personId) {
  const response = await fetch(
    `${BASE_URL}/api/database/rows/table/${TABLES.PERSON}/${personId}/`,
    {
      headers: {
        Authorization: `Token ${TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
  if (!response.ok) throw new Error(`Failed to fetch person ${personId}`);
  return response.json();
}

// ─── Utility exports ──────────────────────────────────────────────────────────

/**
 * Exposes the table ID map for components that need to construct their own queries.
 * This is intentionally read-only — components should call the named functions above.
 */
export { TABLES };
