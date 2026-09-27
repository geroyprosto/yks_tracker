'use client';

import { useEffect } from 'react';
import type { Account } from './api';

/** A device lease describes an open page. The saved study timer has its own lifecycle. */
export function useStudentPresence(account: Account | null | undefined) {
  useEffect(() => {
    if (account?.role !== 'student' || account.status !== 'approved' || !account.teacher_id) return;

    // A fresh ID prevents a late leave from the previous page from clearing this page's lease.
    let deviceId = crypto.randomUUID();
    let left = false;
    let suspended = false;
    const send = (type: 'presence.heartbeat' | 'presence.leave') => {
      void fetch('/api/classroom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          request_id: crypto.randomUUID(), type,
          payload: { device_id: deviceId, visible: document.visibilityState === 'visible' },
        }),
        keepalive: type === 'presence.leave',
      }).catch(() => {});
    };
    const heartbeat = () => {
      if (suspended || !navigator.onLine) return;
      send('presence.heartbeat');
    };
    const leave = () => {
      if (left) return;
      left = true;
      suspended = true;
      send('presence.leave');
    };
    const resume = () => {
      // A bfcache restore must not reuse an ID whose leave may still be in flight.
      if (left) deviceId = crypto.randomUUID();
      left = false;
      suspended = false;
      heartbeat();
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') heartbeat();
    };

    heartbeat();
    const timer = window.setInterval(heartbeat, 30000);
    window.addEventListener('online', heartbeat);
    window.addEventListener('pageshow', resume);
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('online', heartbeat);
      window.removeEventListener('pageshow', resume);
      window.removeEventListener('pagehide', leave);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      leave();
    };
  }, [account?.id, account?.role, account?.status, account?.teacher_id]);
}
