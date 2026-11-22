import type { ReactNode } from 'react';

const icons = {
  overview: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
  atlas: <><circle cx="12" cy="4" r="2" /><path d="M12 7v8m-7-5 7-3 7 3m-7 5-4 6m4-6 4 6" /></>,
  brain: <><path d="M12 4a4 4 0 0 0-7 3 5 5 0 0 0 0 9 4 4 0 0 0 7 4m0-16a4 4 0 0 1 7 3 5 5 0 0 1 0 9 4 4 0 0 1-7 4V4M5 7l3 2m11-2-3 2M5 16l3-2m11 2-3-2" /></>,
  activity: <><path d="M2 12h5l3-8 4 16 3-8h5" /></>,
  watch: <><rect x="6" y="6" width="12" height="12" rx="3" /><path d="M9 6V2h6v4m-6 12v4h6v-4m-3-9v3l2 2" /></>,
  history: <><path d="M3 12a9 9 0 1 1 3 6.7M3 5v7h7m2-5v5l4 2" /></>,
  heart: <><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8Z" /></>,
  droplet: <><path d="M12 2C9 7 5 11 5 15a7 7 0 1 0 14 0c0-4-4-8-7-13Z" /></>,
  scale: <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M7 8a5 5 0 0 1 10 0m-5 0 3-2" /></>,
  file: <><path d="M6 3h8l4 4v14H6zM14 3v5h4M9 12h6m-6 4h6" /></>,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6"/>,
  info: <><circle cx="12" cy="12" r="10"/><path d="M12 11v5m0-8h.01"/></>,
} satisfies Record<string, ReactNode>;

export default function Icon({ name, size = 18 }: { name: keyof typeof icons; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[name]}</svg>;
}
