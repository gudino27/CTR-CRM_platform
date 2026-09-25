import { useEffect, useState } from 'react';
import { api } from '../api.js';

// Deliverable 2: posting days, times, and calendar color per platform.
// TODO(Sprint 4): editable settings that trigger a projection recalculation.
export default function Platforms() {
  const [platforms, setPlatforms] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.platforms().then(setPlatforms).catch((e) => setError(e.message));
  }, []);

  return (
    <section>
      <h1>Platforms</h1>
      {error && <p className="error">{error}</p>}
      <table>
        <thead>
          <tr><th>Platform</th><th>Days</th><th>Times</th><th>Color ID</th></tr>
        </thead>
        <tbody>
          {platforms.map((p) => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{p.posting_days.join(', ')}</td>
              <td>{p.posting_times.join(', ')}</td>
              <td>{p.calendar_color_id}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
