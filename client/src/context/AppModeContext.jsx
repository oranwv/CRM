import { createContext, useContext, useState } from 'react';

const AppModeContext = createContext(null);

export function AppModeProvider({ children }) {
  const [mode, setModeState] = useState(
    () => localStorage.getItem('crm_mode') || 'מכירות'
  );
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
