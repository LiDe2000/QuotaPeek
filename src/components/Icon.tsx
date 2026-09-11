import type { ReactNode } from "react";

type IconName = "user" | "gauge" | "refresh" | "settings" | "close" | "chevron";

export default function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21v-2a8 8 0 0 1 16 0v2" /></>,
    gauge: <><path d="M4.9 19a9 9 0 1 1 14.2 0" /><path d="m12 13 4-5" /><circle cx="12" cy="13" r="1" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M6.1 7a7 7 0 0 1 11.6-1L20 9M4 15l2.3 3A7 7 0 0 0 17.9 17" /></>,
    settings: <><path d="m9.5 3-.7 2.4-2 .9-2.4-.6-2 3.5 1.7 1.8v2L2.4 15l2 3.5 2.4-.6 2 .9.7 2.2h5l.7-2.2 2-.9 2.4.6 2-3.5-1.7-2v-2l1.7-1.8-2-3.5-2.4.6-2-.9L14.5 3z" /><circle cx="12" cy="12" r="3" /></>,
    close: <path d="m6 6 12 12M18 6 6 18" />,
    chevron: <path d="m9 5 7 7-7 7" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
