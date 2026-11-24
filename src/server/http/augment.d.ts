import type { SessionUser } from '../../shared/types';

declare module 'http' {
  interface IncomingMessage {
    ip: string;
    user: SessionUser | null;
    sessionId?: number;
    csrfToken: string;
    cookieCsrfValid: boolean;
    nivoAttached?: boolean;
    query: Record<string, string | string[] | undefined>;
    params: Record<string, string | string[] | undefined>;
    body: any;
  }
}
