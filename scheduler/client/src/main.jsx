/**
 * The browser entry point (index.html loads it): mounts the app into <div id="root">.
 *
 * How it works:
 *   Wraps App in React's StrictMode (extra checks while developing) and react-router's
 *   BrowserRouter (page addresses like /compose), and loads the shared styles.css.
 *
 * When editing:
 *   Pages and their addresses are listed in App.jsx, not here. Importing App.jsx also
 *   installs the session watch (installSessionWatch in currentUser.js), so it runs before
 *   the first API call.
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import App from './App.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
