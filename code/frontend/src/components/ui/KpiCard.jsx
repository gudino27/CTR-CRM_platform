/**
 * KpiCard.jsx — Dashboard metric card
 *
 * Displays a single key performance indicator with a title, numeric value,
 * an optional icon, and an optional trend string.
 *
 * Props:
 *   title  {string}          — Label shown above the number (e.g. "Active Seniors")
 *   value  {number|string}   — The main metric value to display prominently
 *   icon   {LucideIcon}      — Optional icon component rendered in the card header
 *   trend  {string}          — Optional trend text (e.g. "+2 this month").
 *                              Strings NOT starting with "-" are styled green (up);
 *                              strings starting with "-" are styled red (down).
 */
import "./KpiCard.css";

export default function KpiCard({ title, value, icon: Icon, trend }) {
  // A trend is positive if it doesn't start with a minus sign
  const trendPositive = trend && !String(trend).startsWith("-");

  return (
    <div className="kpi-card">
      <div className="kpi-card__header">
        <span className="kpi-card__title">{title}</span>
        {Icon && (
          <span className="kpi-card__icon">
            <Icon size={20} />
          </span>
        )}
      </div>

      {/* Large numeric value */}
      <div className="kpi-card__value">{value}</div>

      {/* Trend line — only rendered when a trend string is provided */}
      {trend && (
        <div className={`kpi-card__trend ${trendPositive ? "kpi-card__trend--up" : "kpi-card__trend--down"}`}>
          {trend}
        </div>
      )}
    </div>
  );
}
