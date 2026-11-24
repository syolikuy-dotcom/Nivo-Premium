import { useState } from 'react';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ApiError } from './api-client';

const make = () => new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (n, e) => { const s = (e as ApiError).status; return n < 1 && !(s && s < 500); },
    },
  },
});

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(make);
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
