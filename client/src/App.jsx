import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import LoginPage     from './pages/LoginPage';
import LeadsPage     from './pages/LeadsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import CalendarPage  from './pages/CalendarPage';

function PrivateRoute({ children }) {
  return localStorage.getItem('crm_token') ? children : <Navigate to="/login" replace />;
}

function AppShell() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const [openLeadId, setOpenLeadId] = useState(null);

  if (location.pathname === '/login') return null;

  const tabs = [
    { path: '/',          icon: '👥', label: 'לידים' },
    { path: '/calendar',  icon: '📅', label: 'לוח שנה' },
    { path: '/analytics', icon: '📊', label: 'אנליטיקס' },
  ];

  return (
    <>
      {/* Bottom nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-100 flex shadow-lg">
        {tabs.map(t => {
          const active = location.pathname === t.path;
          return (
            <button key={t.path} onClick={() => navigate(t.path)}
              className={`flex-1 flex flex-col items-center py-2 text-xs font-bold transition ${active ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-600'}`}>
              <span className="text-xl">{t.icon}</span>
              {t.label}
            </button>
          );
        })}
      </nav>
      {/* Spacer so content isn't hidden behind nav */}
      <div className="pb-16" />
    </>
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
            </>
          </PrivateRoute>
        } />
        <Route path="/analytics" element={
          <PrivateRoute>
            <>
              <AnalyticsPage />
              <AppShellNav />
            </>
          </PrivateRoute>
        } />
        <Route path="/calendar" element={
          <PrivateRoute>
            <>
              <CalendarPage onOpenLead={(id) => setCalendarOpenLead(id)} />
              <AppShellNav />
            </>
          </PrivateRoute>
        } />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

function AppShellNav() {
  const location = useLocation();
  const navigate = useNavigate();

  const tabs = [
    { path: '/',          icon: '👥', label: 'לידים' },
    { path: '/calendar',  icon: '📅', label: 'לוח שנה' },
    { path: '/analytics', icon: '📊', label: 'אנליטיקס' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white border-t border-slate-100 flex shadow-lg">
      {tabs.map(t => {
        const active = location.pathname === t.path;
        return (
          <button key={t.path} onClick={() => navigate(t.path)}
            className={`flex-1 flex flex-col items-center py-2 text-xs font-bold transition ${active ? 'text-emerald-600' : 'text-slate-400 hover:text-slate-600'}`}>
            <span className="text-xl">{t.icon}</span>
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
