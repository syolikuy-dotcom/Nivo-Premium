import { useEffect } from 'react';
import dynamic from 'next/dynamic';
import '../styles/globals.css';
import { setCsrf } from '@/shared/api-client';
import { QueryProvider } from '@/shared/query';
import { installGuard } from '@/shared/protect';
import type { AppProps } from 'next/app';
import type { BaseProps } from '@/shared/types';

const Toast = dynamic(() => import('@/components/Toast'), { ssr: false });

export default function App({ Component, pageProps }: AppProps<Partial<BaseProps>>) {
  if (pageProps && pageProps.csrf) setCsrf(pageProps.csrf);
  const shell = pageProps && pageProps.shell;
  useEffect(() => { document.body.classList.toggle('app', shell === 'app' && !!pageProps.user); }, [shell, pageProps]);
  const guard = !(pageProps && pageProps.admin);
  useEffect(() => (guard ? installGuard() : undefined), [guard]);
  return (<QueryProvider><Component {...pageProps} />{shell !== 'app' || !pageProps.admin ? <Toast /> : null}</QueryProvider>);
}
