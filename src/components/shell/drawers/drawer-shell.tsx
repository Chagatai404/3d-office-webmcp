"use client";

import type { ReactNode } from "react";
import { useShell } from "../shell-provider";

/**
 * Shared chrome for every meeting-controls drawer: a title, an optional
 * subtitle, and one close button. The content below is what makes each
 * drawer different.
 */
export function DrawerShell({
  label,
  title,
  subtitle,
  dark = false,
  children,
}: {
  label: string;
  title: string;
  subtitle?: string;
  dark?: boolean;
  children: ReactNode;
}) {
  const { closeDrawer } = useShell();

  return (
    <aside
      aria-label={label}
      className={dark ? "meeting-drawer meeting-drawer-dark" : "meeting-drawer"}
    >
      <div className="drawer-head">
        <h3 className="drawer-title">{title}</h3>
        {subtitle ? <span className="drawer-subtitle">{subtitle}</span> : null}
        <button type="button" className="drawer-close" aria-label="Close" onClick={closeDrawer}>
          ✕
        </button>
      </div>
      {children}
    </aside>
  );
}
