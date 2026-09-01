import Link from "next/link";
import type { ReactNode } from "react";
import { BrandMark } from "@/components/shell/brand-mark";

/**
 * The wrapper every pre-meeting screen shares: the 3D room behind a scrim, a
 * back link, and a breadcrumb chip naming where you are. Create and Join used
 * to build this by hand differently — Create got it, Join didn't — so it's
 * one component now rather than two drifting copies.
 */
export function FlowPageChrome({
  backHref,
  brandLabel,
  step,
  caption,
  children,
}: {
  backHref: string;
  brandLabel: string;
  step: string;
  caption?: ReactNode;
  children: ReactNode;
}) {
  return (
    <main className="flow-page">
      <div className="flow-scrim flow-scrim-panel" aria-hidden="true" />

      <div className="flow-content">
        <div className="flow-topbar">
          <div className="flow-topbar-group">
            <Link className="flow-back" href={backHref}>
              <span aria-hidden="true">←</span> Back
            </Link>
            <span className="flow-chip">
              <BrandMark size={14} />
              <span className="flow-chip-name">{brandLabel}</span>
              <span aria-hidden="true" className="flow-chip-divider" />
              <span className="flow-chip-step">{step}</span>
            </span>
          </div>
        </div>

        {children}
      </div>

      {caption}
    </main>
  );
}
