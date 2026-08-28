/**
 * Small stroke icons, inlined so the plan pulls in no icon dependency.
 *
 * Every icon in this file is decorative: it always sits beside a text label,
 * never replaces one.
 */

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg
      className="plan-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconPlan = () => (
  <Icon>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 10h11M14 3v18" />
  </Icon>
);

export const IconTable = () => (
  <Icon>
    <ellipse cx="12" cy="12" rx="5" ry="8" />
    <path d="M4 8v8M20 8v8" />
  </Icon>
);

export const IconWall = () => (
  <Icon>
    <path d="M3 6h18M3 12h18M3 18h18M9 6v6M15 12v6" />
  </Icon>
);

export const IconLounge = () => (
  <Icon>
    <path d="M4 14v-3a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v3" />
    <rect x="2" y="14" width="20" height="5" rx="2" />
  </Icon>
);

export const IconOffice = () => (
  <Icon>
    <rect x="4" y="4" width="16" height="16" rx="2" />
    <path d="M8 14h8M8 10h4" />
  </Icon>
);

export const IconActivity = () => (
  <Icon>
    <path d="M3 12h4l3 8 4-16 3 8h4" />
  </Icon>
);

export const IconAlert = () => (
  <Icon>
    <path d="M12 4 2.5 20h19L12 4Z" />
    <path d="M12 10v4M12 17.5v.01" />
  </Icon>
);

export const IconExternal = () => (
  <Icon>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </Icon>
);

export const IconMinus = () => (
  <Icon>
    <path d="M5 12h14" />
  </Icon>
);

export const IconPlus = () => (
  <Icon>
    <path d="M12 5v14M5 12h14" />
  </Icon>
);

export const IconClose = () => (
  <Icon>
    <path d="M6 6l12 12M18 6 6 18" />
  </Icon>
);

export const IconChevron = () => (
  <Icon>
    <path d="m9 6 6 6-6 6" />
  </Icon>
);

export const IconMark = () => (
  <svg
    className="plan-mark"
    viewBox="0 0 24 24"
    aria-hidden="true"
    focusable="false"
  >
    <rect x="2" y="2" width="9" height="9" rx="2" fill="currentColor" />
    <rect x="13" y="2" width="9" height="9" rx="2" fill="currentColor" opacity="0.45" />
    <rect x="2" y="13" width="9" height="9" rx="2" fill="currentColor" opacity="0.45" />
    <rect x="13" y="13" width="9" height="9" rx="2" fill="currentColor" />
  </svg>
);
