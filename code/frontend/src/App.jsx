/**
 * App.jsx — Root component: routing and layout shell
 *
 * Uses React Router v6 nested routes:
 *   - AppLayout is the persistent shell (Topbar + Sidebar + main content area)
 *   - <Outlet> renders whichever child page matches the current URL
 *
 * All 7 pages live as siblings under one layout route so navigation
 * never remounts the shell (sidebar/topbar stay mounted on every page).
 *
 * Route map:
 *   /            → Dashboard  (KPI cards, recent activity, quick links)
 *   /seniors     → Seniors list + detail/edit modal
 *   /volunteers  → Volunteers list + detail + onboarding email preview
 *   /groups      → Visit Teams cards + rotation scheduler + month calendar
 *   /schedule    → 7-column weekly visit grid (Mon–Sun)
 *   /meetings    → Meeting instances list + status filter + detail modal
 *   /feedback    → Feedback form submissions + type filter + detail modal
 */
import { BrowserRouter, Routes, Route, Outlet } from "react-router-dom";
import Sidebar from "./components/layout/Sidebar";
import Topbar from "./components/layout/Topbar";
import Dashboard from "./pages/Dashboard";
import Seniors from "./pages/Seniors";
import Volunteers from "./pages/Volunteers";
import Groups from "./pages/Groups";
import Schedule from "./pages/Schedule";
import Meetings from "./pages/Meetings";
import FeedbackForms from "./pages/FeedbackForms";

/**
 * AppLayout — persistent chrome rendered around every page.
 *
 * Topbar  : visible on mobile only (hamburger menu → slide-in drawer)
 * Sidebar : visible on desktop only (left nav column)
 * <Outlet>: the active page component renders here
 */
function AppLayout() {
  return (
    <div className="app-shell">
      <Topbar />
      <Sidebar />
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Dashboard />} />
          <Route path="seniors"    element={<Seniors />} />
          <Route path="volunteers" element={<Volunteers />} />
          <Route path="groups"     element={<Groups />} />
          <Route path="schedule"   element={<Schedule />} />
          <Route path="meetings"   element={<Meetings />} />
          <Route path="feedback"   element={<FeedbackForms />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
