// Renderer entry. Mounts the existing React app from `frontend/src/App.tsx`
// via the `@frontend` Vite alias. Keeping this file microscopic ensures
// that any UI change ships equally to the web (Netlify) and Electron
// targets without duplication.

import { createRoot } from 'react-dom/client';
import App from '@frontend/App';
import '@frontend/index.css';
import './index.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('renderer: #root mount point missing from index.html');
}
createRoot(container).render(<App />);
