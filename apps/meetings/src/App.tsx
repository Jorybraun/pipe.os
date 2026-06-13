import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { ClerkProvider } from '@clerk/react';
import { ThemeProvider } from './contexts/ThemeContext';
import { Layout, SidebarNav, ChromeMeshGrid } from '@pipe/ui';
import ContactsPage from './pages/ContactsPage';
import MeetingsPage from './pages/MeetingsPage';
import AIAssistant from './components/AIAssistant';
import { useState } from 'react';
import { Bot } from 'lucide-react';

function AppContent() {
  const location = useLocation();
  const isPublicRoute = location.pathname.startsWith('/meet/');
  const [aiPanelOpen, setAiPanelOpen] = useState(false);

  const getActiveSection = () => {
    if (location.pathname === '/contacts') return 'contacts';
    if (location.pathname === '/meetings') return 'meetings';
    if (location.pathname === '/settings') return 'settings';
    return 'contacts';
  };

  const handleNav = (path: string) => {
    window.location.href = path;
  };

  if (isPublicRoute) {
    return (
      <div style={{ padding: '24px' }}>
        <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>Meeting Join</h1>
        <p style={{ color: 'var(--pipe-text-muted)' }}>
          Public meeting route - placeholder for external participants
        </p>
      </div>
    );
  }

  return (
    <>
      <Layout
        sidebar={
          <SidebarNav
            activeSection={getActiveSection()}
            onContactsClick={() => handleNav('/contacts')}
            onMeetingsClick={() => handleNav('/meetings')}
            onSettingsClick={() => handleNav('/settings')}
          />}
      >
        <Routes>
          <Route path="/contacts" element={<ContactsPage />} />
          <Route path="/meetings" element={<MeetingsPage />} />
          <Route path="/settings" element={<div style={{ padding: '24px' }}><h1>Settings</h1></div>} />
          <Route path="/" element={<Navigate to="/contacts" replace />} />
        </Routes>
      </Layout>
      
      {aiPanelOpen && <AIAssistant key="ai-assistant" onClose={() => setAiPanelOpen(false)} />}
      
      <button
        onClick={() => setAiPanelOpen(!aiPanelOpen)}
        style={{
          position: 'fixed',
          right: aiPanelOpen ? '400px' : '20px',
          top: '50%',
          transform: 'translateY(-50%)',
          width: '40px',
          height: '40px',
          borderRadius: '20px',
          background: 'rgba(255,255,255,0.1)',
          border: '1px solid rgba(255,255,255,0.2)',
          color: 'white',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000,
          transition: 'right 0.3s ease',
        }}
      >
        <Bot size={20} />
      </button>
    </>
  );
}

function App() {
  const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;
  
  if (!clerkKey || clerkKey === 'pk_test_placeholder') {
    return (
      <ThemeProvider forceMode="dark">
        <ChromeMeshGrid />
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: '100vh',
          padding: '24px',
          textAlign: 'center',
        }}>
          <h1 style={{ fontSize: '24px', marginBottom: '16px' }}>
            Clerk Key Required
          </h1>
          <p style={{ color: 'var(--pipe-text-muted)', marginBottom: '24px' }}>
            Please set VITE_CLERK_PUBLISHABLE_KEY in apps/meetings/.env
          </p>
          <div style={{
            padding: '16px',
            background: 'rgba(255,255,255,0.05)',
            borderRadius: '8px',
            fontFamily: '"Space Mono", monospace',
            fontSize: '12px',
            maxWidth: '400px',
          }}>
            VITE_CLERK_PUBLISHABLE_KEY=pk_live_your_actual_key_here
          </div>
        </div>
      </ThemeProvider>
    );
  }

  return (
    <ClerkProvider
      publishableKey={clerkKey}
      afterSignOutUrl="/"
    >
      <ThemeProvider forceMode="dark">
        <ChromeMeshGrid />
        <BrowserRouter>
          <AppContent />
        </BrowserRouter>
      </ThemeProvider>
    </ClerkProvider>
  );
}

export default App;
