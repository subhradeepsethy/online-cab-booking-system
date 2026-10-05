import { useCallback, useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../lib/apiClient.js';
import { isSessionEnded, SessionContext, sessionRoles as roles, storageKey } from '../lib/session.js';

// Earlier versions kept login tokens in localStorage; remove them so none linger in the browser.
for (const role of roles) {
  try {
    localStorage.removeItem(`cab-system-session-${role}`);
  } catch {
    // Storage may be unavailable (private mode); nothing to clean up then.
  }
}

function readProfile(role) {
  try {
    const user = JSON.parse(localStorage.getItem(storageKey(role)) ?? 'null');
    return user?.id && user.role === role ? user : null;
  } catch {
    return null;
  }
}

function writeProfile(role, user) {
  try {
    if (user) localStorage.setItem(storageKey(role), JSON.stringify(user));
    else localStorage.removeItem(storageKey(role));
  } catch {
    // Without storage the app still works; it just re-checks the session on each load.
  }
}

function SessionProvider({ children }) {
  const [sessions, setSessions] = useState(() => Object.fromEntries(roles.map((role) => [role, readProfile(role)])));
  const [isRestoring, setIsRestoring] = useState(true);

  const setUser = useCallback((role, user) => {
    writeProfile(role, user);
    setSessions((current) => ({ ...current, [role]: user }));
  }, []);

  // Ask the server which sessions are still valid (the cookies are invisible to scripts).
  useEffect(() => {
    let isMounted = true;

    Promise.all(roles.map(async (role) => {
      try {
        const { user } = await apiRequest('/auth/me', { role });
        if (isMounted) setUser(role, user);
      } catch (error) {
        if (isMounted && isSessionEnded(error)) setUser(role, null);
      }
    })).finally(() => {
      if (isMounted) setIsRestoring(false);
    });

    return () => {
      isMounted = false;
    };
  }, [setUser]);

  const signIn = useCallback(({ user }) => setUser(user.role, user), [setUser]);

  // `revoke` asks the server to end the session (and clear the cookie). It is skipped when the
  // server has already rejected the session (expired, revoked, blocked).
  const signOut = useCallback((role, { revoke = true } = {}) => {
    if (revoke) apiRequest('/auth/logout', { method: 'POST', role }).catch(() => {});
    setUser(role, null);
  }, [setUser]);

  const updateUser = useCallback((role, user) => setSessions((current) => {
    if (!current[role]) return current;
    writeProfile(role, user);
    return { ...current, [role]: user };
  }), []);

  const value = useMemo(
    () => ({ sessions, isRestoring, signIn, signOut, updateUser }),
    [sessions, isRestoring, signIn, signOut, updateUser],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export default SessionProvider;
