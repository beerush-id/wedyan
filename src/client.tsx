import { hydrateRoot } from 'react-dom/client';
import App from './app.js';
import router from './router.js';

import '@/styles/index.css';
import { acceptInteractions } from '@airlib/react/browser';
import { boot } from '@/lib/systems/boot.js';

router
  .activate(window.location.href)
  .then(() => {
    hydrateRoot(document.getElementById('root')!, <App />);
  })
  .then(() => acceptInteractions())
  .then(() => boot());