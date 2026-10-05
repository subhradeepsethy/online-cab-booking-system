import { createContext, useCallback, useContext } from 'react';
import { apiRequest } from './apiClient.js';

export const SessionContext = createContext(null);

export const sessionRoles = ['customer', 'driver', 'admin'];
export const roleSlugs = { customer: 'rider', driver: 'driver', admin: 'admin' };

// Only the (non-secret) profile is cached so pages render instantly; the login token itself is
// an HttpOnly cookie the browser manages. Each role has its own session, so one browser can be
// logged in as rider, driver and admin at once (handy for testing a trip with a few tabs).
export const storageKey = (role) => `cab-system-profile-${role}`;

// Errors that mean the session can no longer be used.
export const isSessionEnded = (error) => error?.status === 401 || error?.code === 'ACCOUNT_BLOCKED';

export function useSession(role) {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>.');

  const { sessions, isRestoring, signIn, signOut, updateUser } = context;

  return {
    user: sessions[role] ?? null,
    isRestoring,
    signIn,
    signOut: useCallback(() => signOut(role), [signOut, role]),
    updateUser: useCallback((user) => updateUser(role, user), [updateUser, role]),
  };
}

// Returns an API caller for this role's session that logs the user out if it stops working.
export function useApi(role) {
  const { signOut } = useContext(SessionContext);

  return useCallback(async (path, options = {}) => {
    try {
      return await apiRequest(path, { ...options, role });
    } catch (error) {
      if (isSessionEnded(error)) signOut(role, { revoke: false });
      throw error;
    }
  }, [signOut, role]);
}
