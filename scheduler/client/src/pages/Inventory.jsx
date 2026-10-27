// Library stock against empty slots, plus the next 14 days (the weekly brief's data).
import { useEffect, useState } from "react";
import { api } from "../api.js";
import { formatClock, formatDateTime, formatLocal } from "../time.js";
import { ColorBadge, TypeBadge } from "../components/PostFields.jsx";

function stockText(row) {
  const slots = `${row.emptySlots} empty slot${row.emptySlots === 1 ? "" : "s"}`;
  return `${row.inLibrary} in library · ${slots}`;
}

export default function Inventory() {
  const [platforms, setPlatforms] = useState([]);
  const [rows, setRows] = useState([]);
  const [brief, setBrief] = useState(null);
  const [timezone, setTimezone] = useState();
  const [message, setMessage] = useState("");

  useEffect(() => {
    Promise.all([api.platforms(), api.inventory(), api.brief(14), api.status()])
      .then(([allPlatforms, inventory, nextDays, status]) => {
        setPlatforms(allPlatforms);
        setRows(inventory);
        setBrief(nextDays);
        setTimezone(status.timezone);
      })
      .catch((error) => setMessage(error.message));
  }, []);

  // One table row per platform x post type, with the Blue and Purple counts side by side
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
        Library posts not yet placed, by post type and color, against the empty slots this month and next.
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

      <h2>Next 14 days</h2>
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
                    {post.kind === "fixed" && post.fixedAt ? formatLocal(post.fixedAt) : formatDateTime(post.scheduledAt, timezone)}
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
                    <strong>{slot.date} at {formatClock(slot.time)}</strong>{" "}
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
