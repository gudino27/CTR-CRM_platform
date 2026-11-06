/**
 * Inventory page: library stock against the empty slots still to come, plus the next
 * days of scheduled posts (the weekly brief's data).
 *
 * What lives here:
 *   monthsLabel  "YYYY-MM" list -> "November and December 2026"
 *   stockText    one count cell's text ("3 in library · 5 empty slots")
 *   Inventory    the page (route /inventory)
 *
 * How many months are counted and how many days the brief list covers are
 * inventoryMonths and inventoryBriefDays in settings.js.
 */
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { formatDateTime, formatLocal, formatSlotTime, monthKey, shiftMonth } from "../time.js";
import { ColorBadge, TypeBadge } from "../components/PostFields.jsx";
import { inventoryBriefDays, inventoryMonths } from "../settings.js";

/**
 * Turns the months the counts cover into one readable phrase for the page's intro.
 *
 * Usage:
 *   monthsLabel(["2026-11", "2026-12"])  // "November and December 2026"
 *
 * Takes:
 *   months - array of "YYYY-MM" strings, in order
 *
 * Returns:
 *   A string. One month: "November 2026". Several in one year: the year only on the last
 *   ("October, November and December 2026"). Across a new year every month gets its year
 *   ("December 2026 and January 2027"). Empty array: "".
 *
 * How it works:
 *   1. Splits each key into year and month and gets the English month name (in UTC, so the
 *      viewer's zone cannot move it into the month before).
 *   2. If all share one year, only the last name carries it; otherwise every name does.
 *   3. Joins with commas and a final "and".
 */
function monthsLabel(months) {
  const parts = months.map((month) => {
    const [year, m] = month.split("-").map(Number);
    return { year, name: new Date(Date.UTC(year, m - 1, 1)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long" }) };
  });
  const sameYear = parts.every((part) => part.year === parts[0].year);
  const names = parts.map((part, index) => (sameYear && index < parts.length - 1 ? part.name : `${part.name} ${part.year}`));
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/**
 * The text of one count cell: library posts against empty slots.
 *
 * Usage:
 *   stockText(row)  // "3 in library · 1 empty slot"
 *
 * Takes:
 *   row - one row from GET /api/inventory: { inLibrary, emptySlots, low, ... }
 *
 * Returns:
 *   A string; "slot" becomes "slots" unless the count is exactly 1.
 */
function stockText(row) {
  const slots = `${row.emptySlots} empty slot${row.emptySlots === 1 ? "" : "s"}`;
  return `${row.inLibrary} in library · ${slots}`;
}

/**
 * The Inventory page: a table of library posts not yet placed, per platform x post type x
 * color, against the empty slots in the coming months (red when there are more empty slots
 * than posts), and a list of everything scheduled in the next days with the empty slots.
 *
 * Usage:
 *   Rendered by App.jsx for the /inventory route: <Inventory />
 *
 * Returns:
 *   The page section. Errors from the API show as one red line.
 *
 * How it works:
 *   1. On load, fetches platforms, the inventory counts (inventoryMonths), the brief
 *      (inventoryBriefDays) and the status (time zone and the app clock) together.
 *   2. The months shown in the intro start at the app clock's month, not the browser's,
 *      because test mode can move the app clock.
 *   3. Groups the inventory rows into one table row per platform x post type, with the
 *      Blue and Purple counts side by side; a type without colors (color null) spans
 *      both columns and says "(no color)".
 *   4. Low cells are red and also say "(low)" to screen readers, so the state is not
 *      shown by color alone.
 *   5. The brief list shows Specific Date posts at their fixedAt and Library posts at
 *      their slot time, then the empty slots in that window.
 *
 * When editing:
 *   The row shapes come from inventory() in server/src/services/views.js and GET /api/brief
 *   in server/src/routes/inventory.js; change both sides together. The "Next N days" heading is built from inventoryBriefDays so it
 *   stays right when the setting changes.
 */
export default function Inventory() {
  const [platforms, setPlatforms] = useState([]);
  const [rows, setRows] = useState([]);
  const [brief, setBrief] = useState(null);
  const [timezone, setTimezone] = useState();
  const [months, setMonths] = useState([]); // "YYYY-MM" the counts cover
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([api.platforms(), api.inventory(inventoryMonths), api.brief(inventoryBriefDays), api.status()])
      .then(([allPlatforms, inventory, nextDays, status]) => {
        setPlatforms(allPlatforms);
        setRows(inventory);
        setBrief(nextDays);
        setTimezone(status.timezone);
        const first = monthKey(status.now, status.timezone);
        setMonths(Array.from({ length: inventoryMonths }, (_, index) => shiftMonth(first, index)));
      })
      .catch((error) => setMessage(error.message));
  }, []);

  const tableRows = [];
  for (const row of rows) {
    let entry = tableRows.find((r) => r.platformId === row.platformId && r.postTypeId === row.postTypeId);
    if (!entry) {
      entry = { platformId: row.platformId, platformName: row.platformName, postTypeId: row.postTypeId, postTypeName: row.postTypeName, byColor: {} };
      tableRows.push(entry);
    }
    entry.byColor[row.color ?? "none"] = row;
  }
  const lowCount = rows.filter((row) => row.low).length;
  const platformName = (id) => platforms.find((p) => p.id === id)?.name ?? "Unknown";

  function cell(row, key) {
    if (!row) return <td key={key}>-</td>;
    return (
      <td key={key} className={row.low ? "inventory-low" : undefined}>
        {stockText(row)}
        {row.low && <span className="sr-only"> (low)</span>}
      </td>
    );
  }

  return (
    <section>
      <h1>Inventory</h1>
      <p>
        Library posts not yet placed, by post type and color, against the empty slots still to come
        {months.length > 0 ? <> in <strong className="inventory-months">{monthsLabel(months)}</strong></> : " this month and next"}.
        Red means there are more empty slots than posts, so more content is needed.
      </p>

      {message && <p className="error-text">{message}</p>}

      <div className="table-wrap">
        <table className="inventory-table">
          <thead>
            <tr>
              <th>Platform</th>
              <th>Post type</th>
              <th>Blue</th>
              <th>Purple</th>
            </tr>
          </thead>
          <tbody>
            {tableRows.map((entry) => (
              <tr key={`${entry.platformId}-${entry.postTypeId}`}>
                <td>{entry.platformName}</td>
                <td>{entry.postTypeName}</td>
                {entry.byColor.none ? (
                  <td colSpan={2} className={entry.byColor.none.low ? "inventory-low" : undefined}>
                    {stockText(entry.byColor.none)} <span className="field-hint">(no color)</span>
                  </td>
                ) : (
                  [cell(entry.byColor.Blue, "blue"), cell(entry.byColor.Purple, "purple")]
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {rows.length > 0 && (
        <p className="field-hint">
          {lowCount === 0 ? "Every combination has enough content." : `${lowCount} combination${lowCount === 1 ? " needs" : "s need"} more content.`}
        </p>
      )}

      <h2>Next {inventoryBriefDays} days</h2>
      {brief && (
        <>
          <p className="field-hint">
            Everything scheduled across all platforms for a final check (the data for the weekly brief).
          </p>

          {brief.posts.length === 0 ? (
            <p>Nothing scheduled.</p>
          ) : (
            <ul className="brief-list">
              {brief.posts.map((post) => (
                <li key={post.id} className={`brief-item${post.kind === "fixed" ? " brief-item-fixed" : ""}`}>
                  <strong>
                    {post.kind === "fixed" && post.fixedAt ? formatLocal(post.fixedAt, timezone) : formatDateTime(post.scheduledAt, timezone)}
                  </strong>{" "}
                  <span>{platformName(post.platformId)}</span>{" "}
                  {post.kind === "fixed" ? (
                    <span className="badge badge-fixed">Specific Date</span>
                  ) : (
                    <>
                      <TypeBadge name={post.postTypeName} /> <ColorBadge color={post.color} />
                    </>
                  )}
                  <p>{post.caption}</p>
                </li>
              ))}
            </ul>
          )}

          {brief.emptySlots.length > 0 && (
            <>
              <h3 className="error-text">Empty slots ({brief.emptySlots.length})</h3>
              <ul className="brief-list">
                {brief.emptySlots.map((slot) => (
                  <li key={slot.id} className="brief-item brief-item-empty">
                    <strong>{slot.date} at {formatSlotTime(slot.date, slot.time, timezone)}</strong>{" "}
                    <span>{platformName(slot.platformId)}</span>{" "}
                    <TypeBadge name={slot.postTypeName} /> <ColorBadge color={slot.color} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  );
}
