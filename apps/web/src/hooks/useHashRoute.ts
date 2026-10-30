import { useEffect, useState } from 'react';

export type Route = { page: 'new' } | { page: 'queue' } | { page: 'lead'; id: string };

export function parseHash(hash: string): Route {
  const lead = /^#\/leads\/([0-9a-f-]{36})$/i.exec(hash);
  if (lead?.[1]) return { page: 'lead', id: lead[1] };
  if (hash === '#/queue') return { page: 'queue' };
  return { page: 'new' };
}

export const hrefFor = (route: Route) =>
  route.page === 'lead' ? `#/leads/${route.id}` : `#/${route.page}`;

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route);
}

/** Three screens do not need a router: the hash is the state, so links and refresh work. */
export function useHashRoute(): Route {
  const [route, setRoute] = useState(() => parseHash(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}
