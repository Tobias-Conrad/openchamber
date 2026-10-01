import React from 'react';

import { useGlobalBlockingRequestsStore } from '@/sync/global-blocking-requests';

/**
 * Pending answers a sidebar row's own directory store cannot know about, read
 * from the cross-directory request index (#3430).
 *
 * A row counts permissions for itself and questions for itself plus any hidden
 * descendants, always per session id. The directory store is the primary
 * source, but it only holds what its own bootstrap loaded: for a directory
 * this client never opened it stays empty, so a row the index lifted into the
 * top zone still showed no badge. The index consumes the same request events,
 * so its counts measure the same requests and the caller takes the larger of
 * the two — a second measurement, never a second sum.
 *
 * Each kind gets its own id list (permissions count the row's own session,
 * questions the whole subtree) so the value stays comparable to the directory
 * count it is merged with, and so a row re-renders only when a number it shows
 * actually changes.
 */
export const useGlobalPendingCounts = (
  permissionSessionIds: readonly string[],
  formSessionIds: readonly string[],
): { permissionCount: number; formCount: number } => {
  const permissionCount = useGlobalBlockingRequestsStore(React.useCallback((state) => {
    let count = 0;
    for (const sessionId of permissionSessionIds) count += state.bySession.get(sessionId)?.permissions.length ?? 0;
    return count;
  }, [permissionSessionIds]));
  const formCount = useGlobalBlockingRequestsStore(React.useCallback((state) => {
    let count = 0;
    for (const sessionId of formSessionIds) count += state.bySession.get(sessionId)?.forms.length ?? 0;
    return count;
  }, [formSessionIds]));
  return { permissionCount, formCount };
};
