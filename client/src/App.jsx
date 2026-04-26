import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import LoginPage     from './pages/LoginPage';
import LeadsPage     from './pages/LeadsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import CalendarPage  from './pages/CalendarPage';
import TasksPage     from './pages/TasksPage';
import PostponePage    from './pages/PostponePage';
import TaskActionPage  from './pages/TaskActionPage';
import AdminPage       from './pages/AdminPage';
import api from './api';

function PrivateRoute({ children }) {
  return localStorage.getItem('crm_token') ? children : <Navigate to="/login" replace />;
}

const ROW1_TABS = [
  { path: '/',          icon: '👥', label: 'לידים' },
  { path: '/calendar',  icon: '📅', label: 'לוח שנה' },
  { path: '/analytics', icon: '📊', label: 'אנליטיקס' },
  { path: '/tasks',     icon: '✅', label: 'משימות' },
];

function AppShellNav() {
  const location = useLocation();
  const navigate = useNavigate();
  const user = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const isAdmin = user.role === 'admin';
  const [overdueCount, setOverdueCount] = useState(0);

  useEffect(() => {
    if (!localStorage.getItem('crm_token')) return;
    const load = () => api.get('/tasks/overdue-count').then(r => setOverdueCount(r.data.count)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

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
        {ROW1_TABS.map(t => <NavBtn key={t.path} {...t} />)}
      </div>
      {isAdmin && (
        <div className="flex" style={{ background: 'rgba(0,0,0,0.18)', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <NavBtn path="/admin" icon="⚙️" label="הגדרות" />
        </div>
      )}
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
              <div className="pb-24" />
            </>
          </PrivateRoute>
        } />
        <Route path="/analytics" element={
          <PrivateRoute>
            <>
              <AnalyticsPage />
              <AppShellNav />
              <div className="pb-24" />
            </>
          </PrivateRoute>
        } />
        <Route path="/calendar" element={
          <PrivateRoute>
            <>
              <CalendarPage onOpenLead={(id) => setCalendarOpenLead(id)} />
              <AppShellNav />
              <div className="pb-24" />
            </>
          </PrivateRoute>
        } />
        <Route path="/tasks" element={
          <PrivateRoute>
            <>
              <TasksPage />
              <AppShellNav />
              <div className="pb-24" />
            </>
          </PrivateRoute>
        } />
        <Route path="/admin" element={
          <PrivateRoute>
            <>
              <AdminPage />
              <AppShellNav />
              <div className="pb-24" />
            </>
          </PrivateRoute>
        } />
        <Route path="/postpone/:taskId"    element={<PostponePage />} />
        <Route path="/task-action/:taskId" element={<TaskActionPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
