import { Navigate, Route, Routes } from 'react-router';
import Layout from './components/Layout.jsx';
import Composer from './pages/Composer.jsx';
import Queue from './pages/Queue.jsx';
import Schedule from './pages/Schedule.jsx';
import Platforms from './pages/Platforms.jsx';

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Navigate to="/compose" replace />} />
        <Route path="compose" element={<Composer />} />
        <Route path="queue" element={<Queue />} />
        <Route path="schedule" element={<Schedule />} />
        <Route path="platforms" element={<Platforms />} />
      </Route>
    </Routes>
  );
}
