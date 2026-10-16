import { useCallback, useEffect, useState } from 'react';

export interface BrowserPath {
  readonly pathname: string;
  navigate(path: string): void;
}

export function useBrowserPath(): BrowserPath {
  const [pathname, setPathname] = useState(() => window.location.pathname);

  useEffect(() => {
    const syncPath = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', syncPath);
    return () => window.removeEventListener('popstate', syncPath);
  }, []);

  const navigate = useCallback((path: string) => {
    const url = new URL(path, window.location.href);
    url.searchParams.delete('actor');
    const target = url.pathname + url.search + url.hash;
    if (window.location.pathname + window.location.search + window.location.hash === target) return;
    window.history.pushState(null, '', target);
    setPathname(window.location.pathname);
  }, []);

  return { pathname, navigate };
}
