import { NavLink, Outlet } from 'react-router';
import TestModeBanner from './TestModeBanner.jsx';

const links = [
  ['/compose', 'Compose'],
  ['/queue', 'Queue'],
  ['/schedule', 'Schedule'],
  ['/platforms', 'Platforms'],
];

export default function Layout() {
  return (
    <>
      <TestModeBanner />
      <header className="topbar">
        <span className="brand">CTR Social Scheduler</span>
        <nav>
          {links.map(([to, label]) => (
            <NavLink key={to} to={to}>{label}</NavLink>
          ))}
        </nav>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  );
}
