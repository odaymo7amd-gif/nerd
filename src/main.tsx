import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import 'katex/dist/katex.min.css';
import './index.css';
import './redesign.css';
import App from './App.tsx';
import { SessionProvider } from './lib/session.tsx';
import { AiAccessProvider } from './components/AiAccess.tsx';

// التسجيل في الإنتاج فقط، حتى لا يعترض عامل الخدمة تحديثات التطوير.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <SessionProvider>
        <AiAccessProvider>
          <App />
        </AiAccessProvider>
      </SessionProvider>
    </BrowserRouter>
  </StrictMode>,
);
