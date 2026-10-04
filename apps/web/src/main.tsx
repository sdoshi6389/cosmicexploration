import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';

// Dev-only test hook: e2e tests drive scenarios through the same tool path as voice/chat.
if (import.meta.env.DEV) {
  void Promise.all([import('./state/world'), import('./state/ui'), import('./ai/tools'), import('./ai/chat'), import('./ai/voice')]).then(([w, u, t, c, v]) => {
    (window as unknown as Record<string, unknown>).__cosmos = { useWorld: w.useWorld, useUi: u.useUi, executeTool: t.executeTool, sendCommand: c.sendCommand, voice: v.voice };
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
