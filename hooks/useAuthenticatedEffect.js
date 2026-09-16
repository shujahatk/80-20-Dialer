import { useEffect } from 'react';
import { apiRequest } from '@/lib/apiClient';

// Bootstrap protected pages from the current server account rather than trusting
// a cached browser role. The caller controls the mount dependencies.
export function useAuthenticatedEffect(initialize, dependencies) {
  useEffect(() => {
    let cancelled = false;
    let cleanup;
    apiRequest('/api/auth/me').then(result => {
      if (!cancelled) cleanup = initialize(result.data);
    }).catch(() => {
      if (!cancelled) window.location.href = new URL('/login', window.location.origin).href;
    });
    return () => { cancelled = true; if (typeof cleanup === 'function') cleanup(); };
    // Initialization is intentionally scoped to the caller's page lifecycle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, dependencies);
}
