/**
 * Topbar.jsx — Mobile-only top bar with hamburger menu
 *
 * Visible only on small screens (hidden on desktop via CSS where the Sidebar takes over).
 * Renders a fixed top bar with the CTR logo and a hamburger button.
 * Tapping the button opens a slide-in drawer that lists all 7 nav destinations.
 *
 * Drawer behavior:
 *   - Clicking the backdrop (outside the drawer) closes it
 *   - Clicking a nav link closes the drawer (via onClick on each NavLink)
 *   - e.stopPropagation() on the drawer itself prevents backdrop-click from firing
 *     when the user clicks inside the drawer
 */
import { useState } from "react";
import { NavLink } from "react-router-dom";
import { Menu, X, LayoutDashboard, Users, UserCheck, UsersRound, CalendarDays, ClipboardList, ClipboardCheck } from "lucide-react";
import "./Topbar.css";

/** All 7 navigation destinations — same list as Sidebar.jsx */
const navItems = [
  { to: "/",           label: "Dashboard",  Icon: LayoutDashboard },
  { to: "/seniors",    label: "Seniors",    Icon: Users },
  { to: "/volunteers", label: "Volunteers", Icon: UserCheck },
  { to: "/groups",     label: "Visit Teams", Icon: UsersRound },
  { to: "/schedule",   label: "Schedule",   Icon: CalendarDays },
  { to: "/meetings",   label: "Meetings",   Icon: ClipboardList },
  { to: "/feedback",   label: "Feedback",   Icon: ClipboardCheck },
];

export default function Topbar() {
  // Controls whether the slide-in nav drawer is visible
  const [drawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      {/* Fixed top bar — logo on left, hamburger on right */}
      <header className="topbar">
        <img src="/logo.png" alt="CTR" className="topbar__logo" />
        <button
          className="topbar__menu-btn"
          onClick={() => setDrawerOpen(true)}
          aria-label="Open menu"
        >
          <Menu size={24} />
        </button>
      </header>

      {/* Slide-in drawer — conditionally rendered when drawerOpen is true */}
      {drawerOpen && (
        <div className="drawer-backdrop" onClick={() => setDrawerOpen(false)}>
          <nav className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="drawer__header">
              <img src="/logo.png" alt="CTR" className="drawer__logo" />
              <button
                className="drawer__close"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close menu"
              >
                <X size={22} />
              </button>
            </div>
            {navItems.map(({ to, label, Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === "/"}
                className={({ isActive }) =>
                  `drawer__link${isActive ? " drawer__link--active" : ""}`
                }
                onClick={() => setDrawerOpen(false)} // close drawer on navigation
              >
                <Icon size={18} />
                <span>{label}</span>
              </NavLink>
            ))}
          </nav>
        </div>
      )}
    </>
  );
}
