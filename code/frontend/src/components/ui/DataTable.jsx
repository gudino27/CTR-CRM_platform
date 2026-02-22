/**
 * DataTable.jsx — Responsive data table / card list
 *
 * Renders the same data in two responsive layouts:
 *   Desktop: a standard <table> with header columns and clickable rows
 *   Mobile:  a stacked card list where each row becomes a labeled card
 *
 * CSS media queries in DataTable.css control which layout is visible.
 *
 * Props:
 *   columns   {Array}    — Column definitions. Each item has:
 *                            key    {string}   — field name from row object
 *                            label  {string}   — column header text
 *                            render {function} — optional: (row) => ReactNode for custom cell rendering
 *   rows      {Array}    — Data rows. Each row must have a unique `id` field (used as React key).
 *   onRowClick {function} — Optional callback fired with the row object when a row is clicked.
 *                           When provided, rows get a pointer cursor (data-table__row--clickable).
 */
import "./DataTable.css";

export default function DataTable({ columns, rows, onRowClick }) {
  return (
    <div className="data-table-wrapper">
      {/* Desktop: standard HTML table */}
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.id}
              onClick={() => onRowClick?.(row)}
              className={onRowClick ? "data-table__row--clickable" : ""}
            >
              {columns.map((col) => (
                // Use custom renderer if provided, otherwise fall back to raw field value
                <td key={col.key}>{col.render ? col.render(row) : row[col.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {/* Mobile: stacked label/value cards — same data, different layout */}
      <div className="data-table-cards">
        {rows.map((row) => (
          <div
            key={row.id}
            className={`data-table-card ${onRowClick ? "data-table-card--clickable" : ""}`}
            onClick={() => onRowClick?.(row)}
          >
            {columns.map((col) => (
              <div key={col.key} className="data-table-card__row">
                <span className="data-table-card__label">{col.label}</span>
                <span className="data-table-card__value">
                  {col.render ? col.render(row) : row[col.key]}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>

      {/* Empty state — shown when the filtered result set is empty */}
      {rows.length === 0 && (
        <p className="data-table-empty">No records found.</p>
      )}
    </div>
  );
}
