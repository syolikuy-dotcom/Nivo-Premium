import type { ReactNode } from 'react';
import type { SiteInfo } from '@/shared/types';

interface Props { site: SiteInfo; title: string; sub: string; children?: ReactNode; alt?: ReactNode }
export default function AuthCard({ site, title, sub, children, alt }: Props) {
  return (
    <div className="auth"><div className="auth-card">
      <div className="auth-logo"><span className="logo lg"><img src={site.logo || '/icon.webp'} alt="" /></span><b>{site.name}</b></div>
      <h1>{title}</h1><p className="sub">{sub}</p>{children}{alt ? <p className="auth-alt">{alt}</p> : null}
    </div></div>
  );
}
