import { createContext, useContext, useState } from 'react';

const AppModeContext = createContext(null);

export function AppModeProvider({ children }) {
  const [mode, setModeState] = useState(() => {
    const stored = localStorage.getItem('crm_mode');
    const user   = (() => { try { return JSON.parse(localStorage.getItem('crm_user') || '{}'); } catch { return {}; } })();
    const roles  = user.roles?.length ? user.roles : (user.role ? [user.role] : []);
    const isAM   = roles.includes('admin') || roles.includes('manager');
    const permitted = {
      'מכירות':      isAM || roles.includes('sales'),
      'הפקה':        isAM || roles.includes('production'),
      'ספקים':       isAM || roles.includes('suppliers'),
      'אישורי הגעה': isAM || roles.includes('rsvp'),
      'תפעול':       isAM || roles.includes('operations'),
      'ניהול':       isAM,
    };
    if (stored && permitted[stored]) return stored;
    return Object.keys(permitted).find(k => permitted[k]) || 'מכירות';
  });
  const [openLeadId, setOpenLeadId] = useState(null);

  function setMode(m) {
    localStorage.setItem('crm_mode', m);
    setModeState(m);
  }

  return (
    <AppModeContext.Provider value={{ mode, setMode, openLeadId, setOpenLeadId }}>
      {children}
    </AppModeContext.Provider>
  );
}

export function useAppMode() {
  return useContext(AppModeContext);
}
