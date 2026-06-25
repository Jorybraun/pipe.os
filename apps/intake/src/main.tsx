import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { IntakePage } from './pages/IntakePage';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/:inviteToken" element={<IntakePage />} />
        <Route path="/" element={<IntakePage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
