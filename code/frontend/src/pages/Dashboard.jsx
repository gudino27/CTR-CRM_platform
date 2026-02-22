/**
 * Dashboard.jsx — Home page: KPI cards, recent activity, quick navigation
 *
 * This page reads live data from Baserow via baserowApi.js.
 * It is the first page fully wired to the real backend (Sprint 2).
 *
 * Layout:
 *   Row 1: 4 KPI cards (active seniors, active volunteers, active teams, scheduled visits)
 *   Row 2: Two-column grid
 *     Left:  "Recent Activity" — last 5 meeting instances sorted by date (newest first)
 *     Right: "Quick Links" — icon buttons that navigate to key sections
 *
 * Data fetching:
 *   All 5 queries run in parallel via Promise.all() on mount.
 *   A loading state prevents rendering stale/zero values during the fetch.
 *   Errors are caught and logged; the dashboard falls back to showing "—" for failed counts.
 *
 * Baserow field name notes (raw API returns Baserow's field names, not JS camelCase):
 *   - MEETING_INSTANCE rows have: instance_date, instance_status, meeting (link array)
 *   - The meeting link array contains [{ id, value }] where value is the meeting's primary field
 *   - Senior/volunteer names come from the team_name formula on VOLUNTEER_TEAM
 *   - For the Recent Activity list we show instance_date + instance_status + the senior name
 *     from the meeting's linked VOLUNTEER_TEAM → senior_name lookup field
 *
 * Quick Links still use live counts from the API (activeSeniors, activeVolunteers).
 * The "Groups" quick link count is the active team count from VOLUNTEER_TEAM.
 */
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Users, UserCheck, CalendarDays, ClipboardList, UsersRound } from "lucide-react";
import KpiCard from "../components/ui/KpiCard";
import Badge from "../components/ui/Badge";
import {
  fetchActiveSeniorsCount,
  fetchActiveVolunteersCount,
  fetchActiveTeamsCount,
  fetchScheduledInstancesCount,
  fetchRecentInstances,
} from "../services/baserowApi";
import "./Dashboard.css";

export default function Dashboard() {
  const navigate = useNavigate();

  // ─── State ────────────────────────────────────────────────────────────────
  const [loading,         setLoading]         = useState(true);
  const [activeSeniors,   setActiveSeniors]   = useState(null);
  const [activeVolunteers,setActiveVolunteers] = useState(null);
  const [activeTeams,     setActiveTeams]     = useState(null);
  const [scheduledVisits, setScheduledVisits] = useState(null);
  const [recentInstances, setRecentInstances] = useState([]);

  // ─── Data fetch on mount ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false; // prevent setState after unmount

    async function loadDashboard() {
      try {
        // Run all 5 queries in parallel for faster load
        const [seniors, volunteers, teams, instances, recent] = await Promise.all([
          fetchActiveSeniorsCount(),
          fetchActiveVolunteersCount(),
          fetchActiveTeamsCount(),
          fetchScheduledInstancesCount(),
          fetchRecentInstances(),
        ]);

        if (cancelled) return;
        setActiveSeniors(seniors);
        setActiveVolunteers(volunteers);
        setActiveTeams(teams);
        setScheduledVisits(instances);
        setRecentInstances(recent);
      } catch (err) {
        console.error("Dashboard: failed to load Baserow data:", err);
        // Keep null values — KpiCard will show "—" for null
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadDashboard();
    return () => { cancelled = true; }; // cleanup if component unmounts during fetch
  }, []);

  // ─── Quick Links (uses live counts once loaded) ───────────────────────────
  const quickLinks = [
    { to: "/seniors",    label: "Seniors",    Icon: Users,        count: activeSeniors },
    { to: "/volunteers", label: "Volunteers", Icon: UserCheck,    count: activeVolunteers },
    { to: "/groups",     label: "Groups",     Icon: UsersRound,   count: activeTeams },
    { to: "/schedule",   label: "Schedule",   Icon: CalendarDays, count: null },
  ];

  // ─── Helpers for Recent Activity ──────────────────────────────────────────

  /**
   * Extracts a display label for a recent meeting instance.
   * The instance_date field is an ISO date string ("2026-02-24").
   * The instance_status field is a Baserow single-select value string.
   *
   * For the senior name: MEETING_INSTANCE → meeting (link) → VOLUNTEER_TEAM → senior_name (lookup)
   * In the raw Baserow response, the "meeting" field is an array: [{ id, value }]
   * where value is the meeting's display name (the team_name formula from VOLUNTEER_TEAM).
   */
  function instanceLabel(instance) {
    // The meeting link field returns [{ id, value }]; value is the team_name formula
    const meetingLink = instance["meeting"];
    if (Array.isArray(meetingLink) && meetingLink.length > 0) {
      return meetingLink[0].value || "Meeting";
    }
    return "Meeting";
  }

  function instanceDate(instance) {
    return instance["instance_date"] || "—";
  }

  function instanceStatus(instance) {
    return instance["instance_status"] || "scheduled";
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">Dashboard</h1>
        <p className="page-subtitle">Welcome to the CTR CRM — Conversations to Remember</p>
      </div>

      {/* KPI strip — 4 metric cards across the top */}
      <div className="dashboard-kpis">
        <KpiCard
          title="Active Seniors"
          value={loading ? "…" : (activeSeniors ?? "—")}
          icon={Users}
        />
        <KpiCard
          title="Active Volunteers"
          value={loading ? "…" : (activeVolunteers ?? "—")}
          icon={UserCheck}
        />
        <KpiCard
          title="Active Teams"
          value={loading ? "…" : (activeTeams ?? "—")}
          icon={CalendarDays}
        />
        <KpiCard
          title="Scheduled Visits"
          value={loading ? "…" : (scheduledVisits ?? "—")}
          icon={ClipboardList}
        />
      </div>

      {/* Two-column content area */}
      <div className="dashboard-grid">

        {/* Left: Recent Activity list */}
        <section className="dashboard-section">
          <h2 className="dashboard-section__title">Recent Activity</h2>
          <div className="activity-list">
            {loading && <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>Loading…</p>}
            {!loading && recentInstances.length === 0 && (
              <p style={{ color: "var(--text-muted)", fontSize: "0.9rem" }}>No recent activity.</p>
            )}
            {recentInstances.map((mi) => {
              const status = instanceStatus(mi);
              return (
                <div key={mi.id} className="activity-item">
                  <div className="activity-item__info">
                    <span className="activity-item__name">{instanceLabel(mi)}</span>
                    <span className="activity-item__date">{instanceDate(mi)}</span>
                  </div>
                  <Badge label={status} variant={status} />
                </div>
              );
            })}
          </div>
        </section>

        {/* Right: Quick Links grid */}
        <section className="dashboard-section">
          <h2 className="dashboard-section__title">Quick Links</h2>
          <div className="quick-links">
            {quickLinks.map(({ to, label, Icon, count }) => (
              <button
                key={to}
                className="quick-link-card"
                onClick={() => navigate(to)}
              >
                <span className="quick-link-card__icon">
                  <Icon size={22} />
                </span>
                <span className="quick-link-card__label">{label}</span>
                {/* Count badge — shown only when count is non-null and loaded */}
                {count !== null && !loading && (
                  <span className="quick-link-card__count">{count ?? "—"}</span>
                )}
              </button>
            ))}
          </div>
        </section>

      </div>
    </div>
  );
}
