import { Navigate, Route, Routes } from 'react-router';
import Layout from './components/Layout.jsx';
import Composer from './pages/Composer.jsx';
import Library from './pages/Library.jsx';
import Calendar from './pages/Calendar.jsx';
import Inventory from './pages/Inventory.jsx';
import Platforms from './pages/Platforms.jsx';
import Media from './pages/Media.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/compose" replace />} />
        <Route path="compose" element={<Composer />} />
        <Route path="library" element={<Library />} />
        <Route path="calendar" element={<Calendar />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="media" element={<Media />} />
        <Route path="platforms" element={<Platforms />} />
        {/* Old Sprint 4 links */}
        <Route path="queue" element={<Navigate to="/library" replace />} />
        <Route path="schedule" element={<Navigate to="/calendar" replace />} />
      </Route>
    </Routes>
  );
}
