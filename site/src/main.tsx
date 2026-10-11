import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { bind } from 'cuelume';
import './index.css';
import App from './App.tsx';

/* one delegated listener for every data-cuelume-* control */
bind();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
