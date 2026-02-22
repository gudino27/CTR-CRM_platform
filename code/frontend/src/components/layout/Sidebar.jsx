/**
 * Sidebar.jsx — Primary navigation (desktop sidebar + mobile bottom nav)
 *
 * Renders two navigation surfaces from the same navItems list:
 *
 *   Desktop: vertical left sidebar with logo, nav links, and org name footer.
 *            Shown/hidden via CSS media query (≥ 768 px breakpoint).
 *
 *   Mobile:  horizontal bottom tab bar showing the first 5 items only.
 *            Meetings and Feedback are accessible via the Topbar drawer on mobile.
 *
 * NavLink from react-router-dom automatically applies the "active" class
 * when its `to` path matches the current URL.
 * The `end` prop on the "/" route prevents it from matching every sub-path.
 */
import { NavLink, useLocation } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  UserCheck,
  UsersRound,
  CalendarDays,
  ClipboardList,
  ClipboardCheck,
} from "lucide-react";
import "./Sidebar.css";

/** All 7 navigation destinations in display order. */
const navItems = [
  { to: "/",          label: "Dashboard",  Icon: LayoutDashboard },
  { to: "/seniors",   label: "Seniors",    Icon: Users },
  { to: "/volunteers",label: "Volunteers", Icon: UserCheck },
  { to: "/groups",    label: "Visit Teams", Icon: UsersRound },
  { to: "/schedule",  label: "Schedule",   Icon: CalendarDays },
  { to: "/meetings",  label: "Meetings",   Icon: ClipboardList },
  { to: "/feedback",  label: "Feedback",   Icon: ClipboardCheck },
];

export default function Sidebar() {
  // useLocation kept here in case future code needs to react to route changes
  // (e.g., collapsing sub-menus). Currently unused beyond what NavLink handles.
  const location = useLocation();

  return (
    <>
      {/* Desktop sidebar — hidden on mobile via CSS */}
      <aside className="sidebar">
        <div className="sidebar__brand">
          <img src="/logo.png" alt="CTR" className="sidebar__logo" />
        </div>
        <nav className="sidebar__nav">
          {navItems.map(({ to, label, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"} // exact match for root so "/" doesn't stay active on /seniors etc.
              className={({ isActive }) =>
                `sidebar__link${isActive ? " sidebar__link--active" : ""}`
              }
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar__footer">
          <span className="sidebar__org">Conversations to Remember</span>
        </div>
      </aside>

      {/* Mobile bottom tab bar — shows first 5 items only; hidden on desktop via CSS */}
      <nav className="bottom-nav">
        {navItems.slice(0, 5).map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className={({ isActive }) =>
              `bottom-nav__item${isActive ? " bottom-nav__item--active" : ""}`
            }
          >
            <Icon size={22} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
}
