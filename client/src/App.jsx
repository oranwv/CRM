import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef } from 'react';
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
import SuppliersPage  from './pages/SuppliersPage';
import RSVPsPage        from './pages/RSVPs/RSVPsPage';
import RSVPDetailPage   from './pages/RSVPs/RSVPDetailPage';
import OperationsPage    from './pages/OperationsPage';
import ManagementPage   from './pages/ManagementPage';
import { AppModeProvider, useAppMode } from './context/AppModeContext';
import api from './api';

function PrivateRoute({ children }) {
  return localStorage.getItem('crm_token') ? children : <Navigate to="/login" replace />;
}

function GlobalHeader() {
  const navigate           = useNavigate();
  const { mode, setMode }  = useAppMode();
  const location           = useLocation();
  const isPublic           = ['/login','/postpone','/task-action','/sign'].some(p => location.pathname.startsWith(p));
  const user               = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const userRoles          = user.roles?.length ? user.roles : [user.role];
  const isAdmin            = userRoles.includes('admin');
  const isManager          = isAdmin || userRoles.includes('manager');
  const [pendingCount, setPendingCount] = useState(0);
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef(null);

  useEffect(() => {
    if (!isManager || !localStorage.getItem('crm_token')) return;
    const load = () => api.get('/greeninvoice/pending/count').then(r => setPendingCount(r.data.count)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [isManager]);

  useEffect(() => {
    function handler(e) { if (dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (isPublic) return null;

  function selectMode(m) {
    setMode(m);
    setDropOpen(false);
    if (m === 'הפקה') navigate('/events');
    else if (m === 'ספקים') navigate('/suppliers');
    else if (m === 'אישורי הגעה') navigate('/rsvps');
    else if (m === 'תפעול') navigate('/operations');
    else if (m === 'ניהול') navigate('/management');
    else navigate('/');
  }

  return (
    <div
      className="fixed top-0 left-0 right-0 z-40 flex items-center justify-between px-4"
      style={{ height: 44, background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', borderBottom: '1px solid rgba(255,255,255,0.15)' }}
      dir="rtl"
    >
      <div className="flex items-center gap-2">
        <span className="text-white font-black text-sm opacity-90">שרביה CRM</span>
        {isManager && pendingCount > 0 && (
          <span className="bg-red-500 text-white text-[10px] font-black rounded-full px-1.5 py-0.5 leading-none">
            {pendingCount > 99 ? '99+' : pendingCount} ממתינים
          </span>
        )}
      </div>

      <div ref={dropRef} className="relative">
        <button
          onClick={() => setDropOpen(o => !o)}
          className="flex items-center gap-1.5 text-xs font-black px-3 py-1.5 rounded-xl cursor-pointer hover:bg-white/25 transition"
          style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}
        >
          {mode}
          <span style={{ fontSize: 10, opacity: 0.8, display: 'inline-block', transition: 'transform 0.15s', transform: dropOpen ? 'rotate(180deg)' : 'none' }}>▾</span>
        </button>

        {dropOpen && (
          <div
            className="absolute left-0 mt-1.5 bg-white rounded-2xl shadow-2xl overflow-hidden border border-slate-100 z-50"
            style={{ minWidth: 140, top: '100%' }}
          >
            {(isAdmin ? ['מכירות','הפקה','ספקים','אישורי הגעה','תפעול','ניהול'] : [
              ...(userRoles.includes('sales')      ? ['מכירות']      : []),
              ...(userRoles.includes('production') ? ['הפקה']         : []),
              ...(userRoles.includes('suppliers')  ? ['ספקים']        : []),
              ...(userRoles.includes('rsvp')       ? ['אישורי הגעה']  : []),
              ...(userRoles.includes('operations') ? ['תפעול']        : []),
              ...(isManager                        ? ['ניהול']        : []),
            ]).map(m => (
              <button
                key={m}
                onClick={() => selectMode(m)}
                className={`block w-full text-right px-4 py-2.5 text-sm font-bold transition cursor-pointer border-b border-slate-50 last:border-0 ${
                  m === mode ? 'bg-violet-50 text-violet-700' : 'text-slate-700 hover:bg-slate-50'
                }`}
              >
                {m}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function AppShellNav() {
  const location  = useLocation();
  const navigate  = useNavigate();
  const { mode }  = useAppMode();
  const user      = JSON.parse(localStorage.getItem('crm_user') || '{}');
  const userRolesNav = user.roles?.length ? user.roles : [user.role];
  const isAdmin   = userRolesNav.includes('admin');
  const [overdueCount, setOverdueCount] = useState(0);

  useEffect(() => {
    if (!localStorage.getItem('crm_token')) return;
    const load = () => api.get(`/tasks/overdue-count?mode=${encodeURIComponent(mode)}`).then(r => setOverdueCount(r.data.count)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [mode]);

  const isProduction   = mode === 'הפקה';
  const isSuppliers    = mode === 'ספקים';
  const isRSVP         = mode === 'אישורי הגעה';
  const isOperations   = mode === 'תפעול';
  const isManagement   = mode === 'ניהול';

  const tabs = isManagement
    ? [{ path: '/management', icon: '📈', label: 'ניהול' }]
    : isRSVP
    ? [{ path: '/rsvps', icon: '📋', label: 'אישורי הגעה', prefix: '/rsvps' }]
    : isSuppliers
    ? [{ path: '/suppliers', icon: '🏢', label: 'ספקים' }]
    : isOperations
    ? [
        { path: '/operations', icon: '🔧', label: 'תפעול' },
        { path: '/calendar',   icon: '📅', label: 'לוח שנה' },
      ]
    : isProduction
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

  const NavBtn = ({ path, icon, label, prefix }) => {
    const active = prefix
      ? location.pathname === path || location.pathname.startsWith(prefix + '/')
      : location.pathname === path;
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
        <Route path="/suppliers" element={
          <PrivateRoute>
            <>
              <div className="pt-11" />
              <SuppliersPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/rsvps" element={
          <PrivateRoute>
            <>
              <div className="pt-11" />
              <RSVPsPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/rsvps/:id" element={
          <PrivateRoute>
            <>
              <div className="pt-11" />
              <RSVPDetailPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/operations" element={
          <PrivateRoute>
            <>
              <div className="pt-11" />
              <OperationsPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/management" element={
          <PrivateRoute>
            <>
              <div className="pt-11" />
              <ManagementPage />
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
