import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import LoginPage     from './pages/LoginPage';
import LeadsPage     from './pages/LeadsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import CalendarPage  from './pages/CalendarPage';

function PrivateRoute({ children }) {
  return localStorage.getItem('crm_token') ? children : <Navigate to="/login" replace />;
}

const NAV_TABS = [
  { path: '/',          icon: '👥', label: 'לידים' },
  { path: '/calendar',  icon: '📅', label: 'לוח שנה' },
  { path: '/analytics', icon: '📊', label: 'אנליטיקס' },
];

function AppShellNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 flex shadow-2xl" style={{ background: '#1c1007', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
      {NAV_TABS.map(t => {
        const active = location.pathname === t.path;
        return (
          <button
            key={t.path}
            onClick={() => navigate(t.path)}
            className="flex-1 flex flex-col items-center py-2.5 text-xs font-bold transition relative"
            style={{ color: active ? '#d97706' : '#a8895e' }}
          >
            {active && (
              <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full" style={{ background: '#d97706' }} />
            )}
            <span className="text-xl mb-0.5">{t.icon}</span>
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}

export default function App() {
  const [calendarOpenLead, setCalendarOpenLead] = useState(null);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={
          <PrivateRoute>
            <>
              <LeadsPage />
              <AppShellNav />
              <div className="pb-16" />
            </>
          </PrivateRoute>
        } />
        <Route path="/analytics" element={
          <PrivateRoute>
            <>
              <AnalyticsPage />
              <AppShellNav />
              <div className="pb-16" />
            </>
          </PrivateRoute>
        } />
        <Route path="/calendar" element={
          <PrivateRoute>
            <>
              <CalendarPage onOpenLead={(id) => setCalendarOpenLead(id)} />
              <AppShellNav />
              <div className="pb-16" />
            </>
          </PrivateRoute>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
