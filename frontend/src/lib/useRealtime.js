import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { apiOrigin } from './apiClient.js';
import { useSession } from './session.js';

// Subscribes to server push events for this role's session. `handlers` maps event names
// (ride:changed, requests:changed, account:changed, admin:changed) to callbacks.
// Returns whether the live connection is up, so screens can show a fallback state.
export function useRealtime(role, handlers) {
  const { user } = useSession(role);
  const userId = user?.id;
  const handlersRef = useRef(handlers);
  const [isConnected, setIsConnected] = useState(false);

  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    if (!userId) return undefined;

    // The session cookie authenticates the socket; `role` says which of the user's sessions.
    const socket = io(apiOrigin, { auth: { role }, withCredentials: true, transports: ['websocket', 'polling'] });
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));
    socket.onAny((event, payload) => handlersRef.current[event]?.(payload));

    return () => {
      socket.disconnect();
      setIsConnected(false);
    };
  }, [role, userId]);

  return isConnected;
}
