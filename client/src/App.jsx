import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useState, useEffect, useRef, useCallback } from 'react';
import LoginPage     from './pages/LoginPage';
import LeadsPage     from './pages/LeadsPage';
import LeadDetailPage from './pages/LeadDetailPage';
import CallLeadPage from './pages/CallLeadPage';
import EventsPage    from './pages/EventsPage';
import AnalyticsPage from './pages/AnalyticsPage';
import SalesPerformancePage from './pages/SalesPerformancePage';
import SalesWorklistPage from './pages/SalesWorklistPage';
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
import MyActivityPage   from './pages/MyActivityPage';
import CostsPage        from './pages/CostsPage';
import FinancePage      from './pages/FinancePage';
import JobsPage          from './pages/candidates/JobsPage';
import CandidateListPage from './pages/candidates/CandidateListPage';
import ClockPage        from './pages/attendance/ClockPage';
import MyHoursPage      from './pages/attendance/MyHoursPage';
import AttendancePage   from './pages/attendance/AttendancePage';
import AIChat           from './components/AIChat';
import useBackGuard, { afterBackGuardsSettle } from './hooks/useBackGuard';
import { useLeadCardNav, openCalendarOverCard, closeCalendarOverCard, closeTopLeadCard, closeAllLeadCards } from './utils/leadCardNav';
import PendingDocsModal  from './components/PendingDocsModal';
import PaymentSignalsModal from './components/PaymentSignalsModal';
import UnreadyEventsModal from './components/UnreadyEventsModal';
import OverdueTasksModal  from './components/OverdueTasksModal';
import { docTypeLabel }   from './utils/docTypes';
import { AppModeProvider, useAppMode } from './context/AppModeContext';
import { CallProvider, useCalls } from './context/CallContext';
import CallBar from './components/CallBar';
import FileBoxHost from './components/FileBoxHost';
import usePresencePing from './hooks/usePresencePing';
import api from './api';

function PrivateRoute({ children }) {
  const location = useLocation();
  // Remember where the user was heading (e.g. /call/<lead> from a WhatsApp link) so the
  // login page can return there instead of the home page.
  return localStorage.getItem('crm_token') ? children : <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
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
  const isProduction       = isManager || userRoles.includes('production');
  const [pendingCount, setPendingCount] = useState(0);
  const [showPending, setShowPending]   = useState(false);
  const [unreadyCount, setUnreadyCount] = useState(0);
  const [showUnready, setShowUnready]   = useState(false);
  const isFinanceUser = isManager || userRoles.includes('finance');
  const [paymentCount, setPaymentCount] = useState(0);
  // Phase 55: the signed-in user's own overdue tasks — red badge + a window that opens by itself
  const [overdueTasks, setOverdueTasks] = useState(0);
  const [showOverdue, setShowOverdue]   = useState(false);
  const loadOverdueTasks = useCallback(() => {
    if (!localStorage.getItem('crm_token')) return;
    api.get('/my-tasks/overdue').then(r => {
      const n = r.data.count || 0;
      setOverdueTasks(n);
      // open once per visit (sessionStorage), and again if the number grew since the user closed it
      let seen = 0; try { seen = Number(sessionStorage.getItem('crm_overdue_seen') || 0); } catch {}
      if (n > 0 && n > seen) setShowOverdue(true);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!localStorage.getItem('crm_token')) return;
    loadOverdueTasks();
    const t = setInterval(loadOverdueTasks, 120_000);
    return () => clearInterval(t);
  }, [loadOverdueTasks]);
  function closeOverdue() {
    try { sessionStorage.setItem('crm_overdue_seen', String(overdueTasks)); } catch {}
    setShowOverdue(false);
    loadOverdueTasks();
  }
  const [showPayments, setShowPayments] = useState(false);

  // Amber "תשלומים ללא מסמך" badge — managers + finance
  const loadPaymentCount = useCallback(() => {
    if (!isFinanceUser || !localStorage.getItem('crm_token')) return;
    api.get('/payment-signals/count').then(r => setPaymentCount(r.data.count || 0)).catch(() => {});
  }, [isFinanceUser]);

  useEffect(() => {
    if (!isFinanceUser || !localStorage.getItem('crm_token')) return;
    loadPaymentCount();
    const t = setInterval(loadPaymentCount, 120_000);
    return () => clearInterval(t);
  }, [isFinanceUser, loadPaymentCount]);
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef(null);

  const loadPendingCount = useCallback(() => {
    if (!isManager || !localStorage.getItem('crm_token')) return;
    api.get('/greeninvoice/pending/count').then(r => setPendingCount(r.data.count)).catch(() => {});
  }, [isManager]);

  useEffect(() => {
    if (!isManager || !localStorage.getItem('crm_token')) return;
    loadPendingCount();
    const t = setInterval(loadPendingCount, 60_000);
    return () => clearInterval(t);
  }, [isManager, loadPendingCount]);

  // Red "אירועים לא מוכנים" badge — production users + managers, events in the next 7 days with open items
  const loadUnreadyCount = useCallback(() => {
    if (!isProduction || !localStorage.getItem('crm_token')) return;
    api.get('/production/unready-events').then(r => setUnreadyCount(r.data.count)).catch(() => {});
  }, [isProduction]);

  useEffect(() => {
    if (!isProduction || !localStorage.getItem('crm_token')) return;
    loadUnreadyCount();
    const t = setInterval(loadUnreadyCount, 60_000);
    return () => clearInterval(t);
  }, [isProduction, loadUnreadyCount]);

  // Creator banner — notify the user when a doc they submitted was approved/rejected.
  const [reviewedDocs, setReviewedDocs] = useState([]);
  useEffect(() => {
    if (!localStorage.getItem('crm_token')) return;
    const load = () => api.get('/greeninvoice/reviewed-for-me').then(r => setReviewedDocs(r.data)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, []);

  function dismissReviewed() {
    setReviewedDocs([]);
    api.post('/greeninvoice/reviewed-for-me/seen').catch(() => {});
  }

  useEffect(() => {
    function handler(e) { if (dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Deep link from the manager WhatsApp notification: /?pendingDocs=1 opens the approvals modal.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('pendingDocs') && isManager) {
      setShowPending(true);
      params.delete('pendingDocs');
      navigate({ pathname: location.pathname, search: params.toString() }, { replace: true });
    }
  }, [location.search, isManager, navigate, location.pathname]);

  const hasBadges = overdueTasks > 0 || (isManager && pendingCount > 0) || (isProduction && unreadyCount > 0) || (isFinanceUser && paymentCount > 0);

  // Phones (< sm): when there are badges the bar is two rows (brand + mode on top, badges below)
  // and the page spacers (.crm-header-spacer) grow to match — see index.css. Desktop stays one row.
  useEffect(() => {
    document.documentElement.classList.toggle('crm-header-tall', hasBadges && !isPublic);
    return () => document.documentElement.classList.remove('crm-header-tall');
  }, [hasBadges, isPublic]);

  if (isPublic) return null;

  function selectMode(m) {
    setMode(m);
    setDropOpen(false);
    if (m === 'הפקה') navigate('/events');
    else if (m === 'ספקים') navigate('/suppliers');
    else if (m === 'אישורי הגעה') navigate('/rsvps');
    else if (m === 'תפעול') navigate('/operations');
    else if (m === 'ניהול') navigate('/management');
    else if (m === 'כספים') navigate('/finance');
    else if (m === 'רווחים') navigate('/sales-performance');
    else if (m === 'מועמדים') navigate('/candidates');
    else navigate('/');
  }

  return (
    <div
      className={`crm-header ${hasBadges ? 'crm-header-tall' : ''} fixed top-0 left-0 right-0 z-40 flex flex-wrap items-center justify-between gap-y-1 px-4 ${hasBadges ? 'h-20 sm:h-11' : 'h-11'}`}
      style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', borderBottom: '1px solid rgba(255,255,255,0.15)' }}
      dir="rtl"
    >
      <div className="order-1 flex items-center gap-2 shrink-0 h-11">
        <img src="/logo/mark-mono-white.svg" alt="" className="w-5 h-5 opacity-90 shrink-0" />
        <span className="text-white font-black text-sm opacity-90 shrink-0">ProEvent CRM</span>
      </div>

      {hasBadges && (
      <div className="order-3 basis-full h-8 sm:order-2 sm:basis-auto sm:flex-1 sm:min-w-0 sm:h-11 sm:mr-2 flex items-center gap-2 overflow-x-auto whitespace-nowrap" style={{ scrollbarWidth: 'none' }}>
        {overdueTasks > 0 && (
          <button
            onClick={() => setShowOverdue(true)}
            className="crm-blink shrink-0 bg-red-600 text-white text-xs font-black rounded-full px-3 py-1 leading-none hover:bg-red-700 transition cursor-pointer">
            ⏰ {overdueTasks > 99 ? '99+' : overdueTasks} {overdueTasks === 1 ? 'משימה באיחור' : 'משימות באיחור'}
          </button>
        )}
        {isManager && pendingCount > 0 && (
          <button
            onClick={() => setShowPending(true)}
            className="shrink-0 bg-red-500 text-white text-[10px] font-black rounded-full px-2 py-0.5 leading-none hover:bg-red-600 transition cursor-pointer">
            {pendingCount > 99 ? '99+' : pendingCount} ממתינים
          </button>
        )}
        {isProduction && unreadyCount > 0 && (
          <button
            onClick={() => setShowUnready(true)}
            className="shrink-0 bg-red-500 text-white text-[10px] font-black rounded-full px-2 py-0.5 leading-none hover:bg-red-600 transition cursor-pointer">
            {unreadyCount > 99 ? '99+' : unreadyCount} אירועים לא מוכנים
          </button>
        )}
        {isFinanceUser && paymentCount > 0 && (
          <button
            onClick={() => setShowPayments(true)}
            className="shrink-0 bg-amber-400 text-amber-950 text-[10px] font-black rounded-full px-2 py-0.5 leading-none hover:bg-amber-300 transition cursor-pointer">
            🧾 {paymentCount > 99 ? '99+' : paymentCount} תשלומים בלי קבלה
          </button>
        )}
      </div>
      )}

      {showPayments && (
        <PaymentSignalsModal onClose={() => { setShowPayments(false); loadPaymentCount(); }} />
      )}

      {showUnready && (
        <UnreadyEventsModal onClose={() => { setShowUnready(false); loadUnreadyCount(); }} />
      )}

      {showOverdue && !isPublic && <OverdueTasksModal onClose={closeOverdue} />}

      {showPending && (
        <PendingDocsModal
          onClose={() => setShowPending(false)}
          onChanged={loadPendingCount}
        />
      )}

      {reviewedDocs.length > 0 && (
        <div className="fixed left-1/2 -translate-x-1/2 z-[70] w-[92%] max-w-md" style={{ top: 'calc(var(--crm-header-h) + 8px)' }}>
          {reviewedDocs.map(d => {
            const ok = d.status === 'approved';
            return (
              <div key={d.id}
                className={`flex items-start gap-2 rounded-2xl shadow-lg px-4 py-3 mb-2 text-sm font-bold ${ok ? 'bg-emerald-500' : 'bg-red-500'} text-white`}>
                <span className="flex-1">
                  המסמך שלך ({docTypeLabel(d.payload?.type)}{d.lead_name ? `, ${d.lead_name}` : ''}) {ok ? 'אושר ✓' : 'נדחה ✗'}
                  {!ok && d.rejection_comment && <span className="block font-normal text-white/90 mt-0.5">סיבה: {d.rejection_comment}</span>}
                </span>
                <button onClick={dismissReviewed} className="text-white/80 hover:text-white text-lg leading-none">&times;</button>
              </div>
            );
          })}
        </div>
      )}

      <div className="order-2 sm:order-3 flex items-center gap-1.5 shrink-0 h-11">
      {/* Phase 63: a back button everywhere — the browser's own back, so an open card closes first
          (useBackGuard) and a card opened from another screen returns there. */}
      <button onClick={() => window.history.back()} title="חזרה למסך הקודם" aria-label="חזרה"
        className="flex items-center gap-1 text-xs font-black px-2.5 py-1.5 rounded-xl cursor-pointer hover:bg-white/25 transition"
        style={{ background: 'rgba(255,255,255,0.18)', color: '#fff' }}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        <span className="hidden sm:inline">חזרה</span>
      </button>
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
            {(isAdmin ? ['מכירות','הפקה','ספקים','אישורי הגעה','תפעול','ניהול','כספים','רווחים','מועמדים'] : [
              ...(userRoles.includes('sales') || userRoles.includes('sales_manager') ? ['מכירות'] : []),
              ...(userRoles.includes('production') ? ['הפקה']         : []),
              ...(userRoles.includes('suppliers')  ? ['ספקים']        : []),
              ...(userRoles.includes('rsvp')       ? ['אישורי הגעה']  : []),
              ...(userRoles.includes('operations') ? ['תפעול']        : []),
              ...(isManager                        ? ['ניהול']        : []),
              ...(isManager || userRoles.includes('finance') ? ['כספים'] : []),
              ...(isManager || userRoles.includes('sales') || userRoles.includes('sales_manager') ? ['רווחים'] : []),
              ...(isManager                        ? ['מועמדים']      : []),
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
    </div>
  );
}

// ✈️ "I'm abroad": incoming calls skip my mobile and ring straight in the app.
// Removed from the top bar on 2026-10-14 (Oran: the plane should not appear up there). Kept here in case it gets a new home (e.g. הגדרות).
// eslint-disable-next-line no-unused-vars
function AbroadToggle() {
  const { enabled, ready, config, setAbroad } = useCalls();
  if (!enabled) return null;
  const on = !!config.abroad_mode;
  return (
    <button
      onClick={() => setAbroad(!on).catch(() => {})}
      title={on ? 'מצב חו"ל פעיל — שיחות נכנסות מצלצלות רק באפליקציה' : 'מצב חו"ל כבוי — שיחות נכנסות מצלצלות קודם בנייד'}
      className="flex items-center gap-1 text-[11px] font-black px-2 py-1.5 rounded-xl cursor-pointer hover:bg-white/25 transition"
      style={{ background: on ? 'rgba(251,191,36,0.9)' : 'rgba(255,255,255,0.18)', color: on ? '#1e1b4b' : '#fff' }}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${ready ? 'bg-emerald-300' : 'bg-red-300'}`} title={ready ? 'הטלפון מחובר' : 'הטלפון לא מחובר'} />
      ✈️{on ? ' חו"ל' : ''}
    </button>
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
  // Phase 83 — נוכחות: does this user clock in ("שעות" tab), is he a manager ("נוכחות" tab in ניהול)
  // and how many items wait for a decision. Cached so the tabs don't pop in after a reload.
  const [att, setAtt] = useState(() => { try { return JSON.parse(localStorage.getItem('crm_att') || '{}'); } catch { return {}; } });
  useEffect(() => {
    if (!localStorage.getItem('crm_token')) return;
    const load = () => api.get('/attendance/status').then(r => { setAtt(r.data); try { localStorage.setItem('crm_att', JSON.stringify(r.data)); } catch {} }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [location.pathname === '/attendance']);

  // Phase 81 — the nav stays on screen while a lead card is open. Lead cards (and the
  // calendar overlay below) end at `bottom: var(--crm-nav-h)`, so publish the nav's height.
  const leadNav = useLeadCardNav();
  const navRef  = useRef(null);
  useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--crm-nav-h', `${el.offsetHeight}px`);
    set();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => { ro?.disconnect(); root.style.removeProperty('--crm-nav-h'); };
  }, []);
  useBackGuard(leadNav.calendarOpen, closeCalendarOverCard);

  // A tab tapped while a lead card is open: "לוח שנה" opens the calendar over the card (× returns
  // to the card); every other tab closes the card and goes there. With no card open: plain navigate.
  function go(path) {
    if (!leadNav.count) { navigate(path); return; }
    if (path === '/calendar') {
      if (location.pathname === '/calendar' && !leadNav.calendarOpen) closeTopLeadCard(); // card opened from the calendar page itself
      else openCalendarOverCard();
      return;
    }
    closeAllLeadCards();
    afterBackGuardsSettle(() => navigate(path));
  }

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
  const isFinance      = mode === 'כספים';
  const isProfit       = mode === 'רווחים';
  const isCandidates   = mode === 'מועמדים';

  const tabs = isCandidates
    ? [
        { path: '/candidates',     icon: '💼', label: 'משרות',       prefix: '/candidates/jobs' },
        { path: '/candidates/all', icon: '👥', label: 'כל המועמדים' },
      ]
    : isProfit
    ? [{ path: '/sales-performance', icon: '💰', label: 'רווחים' }]
    : isFinance
    ? [{ path: '/finance', icon: '💰', label: 'כספים' }]
    : isManagement
    ? [
        { path: '/management',     icon: '📈', label: 'ניהול' },
        { path: '/sales-worklist', icon: '💡', label: 'AI מכירות' },
        { path: '/costs',          icon: '💸', label: 'עלויות' },
        { path: '/my-activity',    icon: '👤', label: 'הפעילות שלי' },
      ]
    : isRSVP
    ? [{ path: '/rsvps', icon: '📋', label: 'אישורי הגעה', prefix: '/rsvps' }]
    : isSuppliers
    ? [{ path: '/suppliers', icon: '🏢', label: 'ספקים' }]
    : isOperations
    ? [
        { path: '/operations', icon: '🔧', label: 'תפעול' },
        { path: '/calendar',   icon: '📅', label: 'לוח שנה' },
        { path: '/my-activity',    icon: '👤', label: 'הפעילות שלי' },
      ]
    : isProduction
    ? [
        { path: '/events',   icon: '🎉', label: 'אירועים' },
        { path: '/tasks',    icon: '✅', label: 'משימות' },
        { path: '/calendar', icon: '📅', label: 'לוח שנה' },
        { path: '/my-activity',    icon: '👤', label: 'הפעילות שלי' },
      ]
    : [
        { path: '/',               icon: '👥', label: 'לידים' },
        { path: '/sales-worklist', icon: '💡', label: 'AI מכירות' },
        { path: '/calendar',       icon: '📅', label: 'לוח שנה' },
        { path: '/analytics',      icon: '📊', label: 'אנליטיקס' },
        { path: '/tasks',          icon: '✅', label: 'משימות' },
        { path: '/my-activity',    icon: '👤', label: 'הפעילות שלי' },
      ];

  // Phase 83: the attendance tabs are added after the mode's own tabs, which stay as they were.
  const navTabs = [
    ...tabs,
    ...(isManagement && att.manager ? [{ path: '/attendance', icon: '🕒', label: 'נוכחות', badge: att.pending }] : []),
    ...(att.enabled ? [{ path: '/my-hours', icon: '⏱️', label: 'שעות' }] : []),
  ];

  const NavBtn = ({ path, icon, label, prefix, badge }) => {
    const active = leadNav.calendarOpen ? path === '/calendar' : prefix
      ? location.pathname === path || location.pathname.startsWith(prefix + '/') || (prefix === '/candidates/jobs' && location.pathname === '/candidates/unassigned')
      : location.pathname === path;
    const isTasksTab = path === '/tasks';
    return (
      <button
        onClick={() => go(path)}
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
          {badge > 0 && (
            <span className="absolute -top-1 -right-2 bg-red-500 text-white text-[9px] font-black rounded-full min-w-[15px] h-[15px] flex items-center justify-center px-0.5 leading-none">
              {badge > 99 ? '99+' : badge}
            </span>
          )}
        </span>
        {label}
      </button>
    );
  };

  return (
    <>
    {leadNav.calendarOpen && (
      // The calendar opened from inside a lead card: sits over the card, under nothing but the nav.
      <div className="fixed inset-x-0 top-0 z-[56] overflow-y-auto" style={{ bottom: 'var(--crm-nav-h, 0px)', background: '#fdf8f0' }} dir="rtl">
        <div className="sticky top-0 z-10 flex items-center gap-2 px-4 py-2.5 text-white shadow" style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
          <button onClick={closeCalendarOverCard} aria-label="חזרה לכרטיס הליד" className="text-white/90 hover:text-white text-2xl leading-none px-1">&times;</button>
          <span className="font-bold text-sm truncate min-w-0">חזרה ל{leadNav.name || 'כרטיס הליד'}</span>
          <span className="mr-auto shrink-0 font-black text-sm opacity-90">📅 לוח שנה</span>
        </div>
        <CalendarPage />
      </div>
    )}
    <nav ref={navRef} className="fixed bottom-0 left-0 right-0 z-30 shadow-2xl" style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', borderTop: '1px solid rgba(255,255,255,0.15)' }}>
      <div className="flex">
        {navTabs.map(t => <NavBtn key={t.path} {...t} />)}
      </div>
      {isAdmin && (
        <div className="flex" style={{ background: 'rgba(0,0,0,0.18)', borderTop: '1px solid rgba(255,255,255,0.1)' }}>
          <NavBtn path="/admin" icon="⚙️" label="הגדרות" />
        </div>
      )}
    </nav>
    </>
  );
}

function RootRedirect() {
  const { mode, setMode } = useAppMode();
  const navigate  = useNavigate();
  const location  = useLocation();
  useEffect(() => {
    // Deep link to a lead (/?lead=ID from calendar events, WhatsApp/email
    // notifications, the AI chat, task reminders). LeadsPage opens the card
    // from that param, so never bounce to the last-used mode's page — that
    // silently dropped the param and landed on רווחים/הפקה/etc. instead of
    // the lead. Switch to sales mode so the header and nav match the page.
    if (new URLSearchParams(location.search).get('lead')) {
      if (mode !== 'מכירות') setMode('מכירות');
      return;
    }
    if      (mode === 'הפקה')        navigate('/events',     { replace: true });
    else if (mode === 'ספקים')       navigate('/suppliers',  { replace: true });
    else if (mode === 'אישורי הגעה') navigate('/rsvps',      { replace: true });
    else if (mode === 'תפעול')       navigate('/operations', { replace: true });
    else if (mode === 'ניהול')       navigate('/management', { replace: true });
    else if (mode === 'כספים')       navigate('/finance',    { replace: true });
    else if (mode === 'רווחים')      navigate('/sales-performance', { replace: true });
    else if (mode === 'מועמדים')     navigate('/candidates', { replace: true });
  }, []);
  return <LeadsPage />;
}

// Phase 83 — clock-only users: logged in with the single permission "נוכחות בלבד".
function isClockOnlyUser() {
  if (!localStorage.getItem('crm_token')) return false;
  try {
    const u = JSON.parse(localStorage.getItem('crm_user') || '{}');
    return Array.isArray(u.roles) && u.roles.length > 0 && u.roles.every(r => r === 'attendance');
  } catch { return false; }
}
function ClockOnlyRoutes() {
  const navigate = useNavigate();
  function logout() {
    localStorage.removeItem('crm_token'); localStorage.removeItem('crm_user'); localStorage.removeItem('crm_att');
    navigate('/login', { replace: true });
  }
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/clock" element={<PrivateRoute><ClockPage /></PrivateRoute>} />
      <Route path="/my-hours" element={
        <PrivateRoute>
          <>
            <div className="flex items-center justify-between px-5 py-2 text-white" dir="rtl" style={{ background: 'linear-gradient(135deg, #7c3aed, #4f46e5)' }}>
              <span className="font-black">ProEvent CRM</span>
              <button onClick={logout} className="min-h-11 px-2 text-sm font-bold text-white/90">יציאה מהמערכת</button>
            </div>
            <MyHoursPage />
          </>
        </PrivateRoute>
      } />
      <Route path="*" element={<Navigate to="/my-hours" replace />} />
    </Routes>
  );
}

function AppRoutes() {
  const [calendarOpenLead, setCalendarOpenLead] = useState(null);
  usePresencePing(); // track connected-hours heartbeat (no-op on public routes)
  // Phase 83 — a clock-only user (roles = ['attendance']) gets the two attendance screens and
  // nothing else; and the NFC page (/clock) is shown bare for everyone, without header / call bar / AI.
  const location = useLocation();
  if (isClockOnlyUser()) return <ClockOnlyRoutes />;
  const bare = location.pathname.startsWith('/clock');

  return (
    <>
      {!bare && <GlobalHeader />}
      {!bare && <CallBar />}
      {!bare && <AIChat />}
      <FileBoxHost />
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <RootRedirect />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/events" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <EventsPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/analytics" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <AnalyticsPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/sales-performance" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <SalesPerformancePage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/sales-worklist" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <SalesWorklistPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/calendar" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <CalendarPage onOpenLead={(id) => setCalendarOpenLead(id)} />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/tasks" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <TasksPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/admin" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <AdminPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/finance" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <FinancePage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/suppliers" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <SuppliersPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/rsvps" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <RSVPsPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/rsvps/:id" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <RSVPDetailPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/operations" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <OperationsPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/costs" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <CostsPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/candidates" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <JobsPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/candidates/all" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <CandidateListPage scope="all" />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/candidates/unassigned" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <CandidateListPage scope="unassigned" />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/candidates/jobs/:jobId" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <CandidateListPage scope="job" />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/management" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <ManagementPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/my-activity" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <MyActivityPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/clock" element={<PrivateRoute><ClockPage /></PrivateRoute>} />
        <Route path="/my-hours" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <MyHoursPage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/attendance" element={
          <PrivateRoute>
            <>
              <div className="crm-header-spacer pt-11" />
              <AttendancePage />
              <AppShellNav />
              <div className="pb-28" />
            </>
          </PrivateRoute>
        } />
        <Route path="/leads/:id" element={
          <PrivateRoute>
            <LeadDetailPage />
          </PrivateRoute>
        } />
        <Route path="/call/:leadId" element={
          <PrivateRoute>
            <CallLeadPage />
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
      <CallProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
      </CallProvider>
    </AppModeProvider>
  );
}
