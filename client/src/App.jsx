import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import LoginPage     from './pages/LoginPage';
import LeadsPage     from './pages/LeadsPage';
import EventsPage    from './pages/EventsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import CalendarPage  from './pages/CalendarPage';
import TasksPage     from './pages/TasksPage';
import PostponePage    from './pages/PostponePage';
import TaskActionPage  from './pages/TaskActionPage';
import AdminPage       from './pages/AdminPage';
import SignaturePage   from './pages/SignaturePage';
import { AppModeProvider, useAppMode } from './context/AppModeContext';
import api from './api';

function PrivateRoute({ children }) {
  return localStorage.getItem('crm_token') ? children : <Navigate to="/login" replace />;
}

function GlobalHeader() {
  const navigate       = useNavigate();
  const { mode, setMode } = useAppMode();
  const location       = useLocation();
  const isPublic       = ['/login','/postpone','/task-action','/sign'].some(p => location.pathname.startsWith(p));
  if (isPublic) return null;

  function handleModeChange(e) {
    const m = e.target.value;
    setMode(m);
    navigate(m === 'הפקה' ? '/events' : '/');
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4"
      style={{ height: 44, background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', borderBottom: '1px solid rgba(255,255,255,0.15)' }}
      dir="rtl"
    >
      <span className="text-white font-black text-sm opacity-90">שרביה CRM</span>
      <select
        value={mode}
        onChange={handleModeChange}
        className="text-xs font-black px-3 py-1 rounded-lg border-0 focus:outline-none cursor-pointer"
        style={{ background: 'rgba(255,255,255,0.18)', color: '#ffffff' }}
      >
        <option value="מכירות" style={{ color: '#1e293b' }}>מכירות</option>
        <option value="הפקה"   style={{ color: '#1e293b' }}>הפקה</option>
      </select>
    </div>
  );
}

function AppShellNav() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { mode }  = useAppMode();
  const user      = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const isAdmin   = user.role === 'admin';
  const [overdueCount, setOverdueCount] = useState(0);

  useEffect(() => {
    if (!localStorage.getItem('crm_token')) return;
    const load = () => api.get(`/tasks/overdue-count?mode=${encodeURIComponent(mode)}`).then(r => setOverdueCount(r.data.count)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [mode]);

  const isProduction = mode === 'הפקה';

  const tabs = isProduction
    ? [
        { path: '/events',   icon: '🎉', label: 'אירועים' },
        { path: '/tasks',    icon: '✅', label: 'משימות' },
        { path: '/calendar', icon: '📅', label: 'לוח שנה' },
      ]
    : [
        { path: '/',          icon: '👥', label: 'לידים' },
        { path: '/calendar',  icon: '📅', label: 'לוח שנה' },
        { path: '/analytics', icon: '📊', label: 'אנליטיקס' },
        { path: '/tasks',     icon: '✅', label: 'משימות' },
      ];

  const NavBtn = ({ path, icon, label }) => {
    const active = location.pathname === path;
    const isTasksTab = path === '/tasks';
    return (
      <button
        onClick={() => navigate(path)}
        className="flex-1 flex flex-col items-center py-2 text-xs font-bold transition relative"
        style={{ color: active ? '#ffffff' : 'rgba(255,255,255,0.6)' }}
      >
        {active && (
          <span className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-white" />
        )}
        <span className="text-xl mb-0.5 relative leading-none">
          {icon}
          {isTasksTab && overdueCount > 0 && (
            <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[9px] font-black rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-0.5 leading-none">
              {overdueCount > 99 ? '99+' : overdueCount}
            </span>
          )}
        </span>
        {label}
      </button>
    );
  };

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 shadow-2xl" style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', borderTop: '1px solid rgba(255,255,255,0.15)' }}>
      <div className="flex">
        {tabs.map(t => <NavBtn key={t.path} {...t} />)}
      </div>
      {isAdmin && (
        <div className="flex" style={{ background: 'rgba(0,0,0,0.18)', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <NavBtn path="/admin" icon="⚙️" label="הגדרות" />
        </div>
      )}
    </nav>
  );
}

function AppRoutes() {
  const [calendarOpenLead, setCalendarOpenLead] = useState(null);

  return (
    <>
      <GlobalHeader />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={
          <PrivateRoute>
            <>
              <div className="pt-11" />
              <LeadsPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/events" element={
          <PrivateRoute>
            <>
              <div className="pt-11" />
              <EventsPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/analytics" element={
          <PrivateRoute>
            <>
              <div className="pt-11" />
              <AnalyticsPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/calendar" element={
          <PrivateRoute>
            <>
              <div className="pt-11" />
              <CalendarPage onOpenLead={(id) => setCalendarOpenLead(id)} />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/tasks" element={
          <PrivateRoute>
            <>
              <div className="pt-11" />
              <TasksPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/admin" element={
          <PrivateRoute>
            <>
              <div className="pt-11" />
              <AdminPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/postpone/:taskId"    element={<PostponePage />} />
        <Route path="/task-action/:taskId" element={<TaskActionPage />} />
        <Route path="/sign/:token"         element={<SignaturePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <AppModeProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AppModeProvider>
  );
}
