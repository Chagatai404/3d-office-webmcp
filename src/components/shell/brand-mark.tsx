/**
 * Quorum's mark: a lime ring on the app's dark surface, echoing the plain
 * accent square (`.flow-brand-mark`) it replaces wherever the wordmark
 * appears — the favicon (`src/app/icon.svg`) is the same shape in literal
 * hex, since a favicon renders outside this stylesheet's custom properties.
 */
export function BrandMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className="brand-mark"
    >
      <rect width="32" height="32" rx="7" fill="var(--dark)" />
      <circle cx="15.2" cy="15.2" r="7.4" fill="none" stroke="var(--accent)" strokeWidth="3" />
      <line x1="20" y1="20" x2="24.5" y2="24.5" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
