import type { ReactNode } from 'react';
import Icon from './Icon';

export function PageHeader({ eyebrow, title, subtitle, action }: {
  eyebrow: string; title: string; subtitle: string; action?: ReactNode;
}) {
  return <div className="page-heading"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p>{subtitle}</p></div>{action}</div>;
}

export function Card({ title, action, className = '', children }: {
  title?: string; action?: ReactNode; className?: string; children: ReactNode;
}) {
  return <section className={`surface ${className}`}>
    {title && <div className="surface-heading"><h2>{title}</h2>{action}</div>}
    {children}
  </section>;
}

export function MetricCard({ label, value, unit, detail, icon }: {
  label: string; value: ReactNode; unit?: string; detail: string; icon: React.ComponentProps<typeof Icon>['name'];
}) {
  return <article className="surface metric-card">
    <div className="surface-heading"><h2 className="caps">{label}</h2><Icon name={icon}/></div>
    <div className="metric-value">{value ?? '—'}{unit && <small>{unit}</small>}</div>
    <p className="muted-note">{detail}</p>
  </article>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="empty-state">{children}</p>;
}
