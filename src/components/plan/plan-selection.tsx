"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { PlanZoneId } from "@/floorplan/floorplan-view-model";

/**
 * Presentation state for the plan view: what is selected, how far it is
 * zoomed, and which overlays are open.
 *
 * None of this is room state. It never reaches `RoomClient` and is not part of
 * any snapshot.
 */

export const ZOOM_STEPS: readonly number[] = [50, 75, 100, 125, 150, 200];
const DEFAULT_ZOOM = 100;

export interface PlanSelectionValue {
  selected: PlanZoneId | null;
  hovered: PlanZoneId | null;
  select(zone: PlanZoneId | null): void;
  setHovered(zone: PlanZoneId | null): void;

  zoom: number;
  zoomIn(): void;
  zoomOut(): void;
  resetZoom(): void;

  ledgerOpen: boolean;
  toggleLedger(): void;

  positionDialogOpen: boolean;
  openPositionDialog(): void;
  closePositionDialog(): void;
}

const PlanSelectionContext = createContext<PlanSelectionValue | null>(null);

export function usePlanSelection(): PlanSelectionValue {
  const value = useContext(PlanSelectionContext);
  if (!value) {
    throw new Error("usePlanSelection must be used inside a PlanSelectionProvider.");
  }
  return value;
}

function stepZoom(current: number, direction: 1 | -1): number {
  const index = ZOOM_STEPS.indexOf(current);
  if (index === -1) return DEFAULT_ZOOM;
  const next = ZOOM_STEPS[index + direction];
  return next ?? current;
}

export function PlanSelectionProvider({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState<PlanZoneId | null>(null);
  const [hovered, setHovered] = useState<PlanZoneId | null>(null);
  const [zoom, setZoom] = useState(DEFAULT_ZOOM);
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const [positionDialogOpen, setPositionDialogOpen] = useState(false);

  const select = useCallback((zone: PlanZoneId | null) => {
    // Clicking the selected room again returns to the whole-room overview.
    setSelected((current) => (current === zone ? null : zone));
  }, []);

  const value = useMemo<PlanSelectionValue>(
    () => ({
      selected,
      hovered,
      select,
      setHovered,
      zoom,
      zoomIn: () => setZoom((current) => stepZoom(current, 1)),
      zoomOut: () => setZoom((current) => stepZoom(current, -1)),
      resetZoom: () => setZoom(DEFAULT_ZOOM),
      ledgerOpen,
      toggleLedger: () => setLedgerOpen((current) => !current),
      positionDialogOpen,
      openPositionDialog: () => setPositionDialogOpen(true),
      closePositionDialog: () => setPositionDialogOpen(false),
    }),
    [selected, hovered, select, zoom, ledgerOpen, positionDialogOpen],
  );

  return (
    <PlanSelectionContext.Provider value={value}>
      {children}
    </PlanSelectionContext.Provider>
  );
}
