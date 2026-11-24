import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './api-client';
import type { ApiError } from './api-client';

export const POLL_MS = 2500;

export default function usePoll<T>(active: boolean, url: string, onData: (d: T) => void, initial?: T): void {
  const cb = useRef(onData); cb.current = onData;
  const seen = useRef<T | undefined>(initial);
  const q = useQuery<T, ApiError>({
    queryKey: ['poll', url],
    queryFn: ({ signal }) => api<T>(url, { method: 'GET', signal }),
    enabled: active,
    initialData: initial,
    gcTime: 0,
    staleTime: POLL_MS,
    refetchOnWindowFocus: true,
    refetchIntervalInBackground: false,
    retry: false,
    refetchInterval: (query) => { const s = (query.state.error as ApiError | null)?.status; return s === 401 || s === 404 ? false : POLL_MS; },
  });
  useEffect(() => {
    if (q.data !== undefined && q.data !== seen.current) { seen.current = q.data; cb.current(q.data); }
  }, [q.data]);
}
