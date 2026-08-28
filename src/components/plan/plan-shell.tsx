"use client";

import { useMemo } from "react";
import { useRoom } from "@/components/room/room-provider";
import { createFloorPlanState } from "@/floorplan/floorplan-view-model";
import { PlanCanvas } from "./plan-canvas";
import { PlanDetailRail } from "./plan-detail-rail";
import { PlanLedger } from "./plan-ledger";
import { PlanPositionDialog } from "./plan-position-dialog";
import { PlanSelectionProvider } from "./plan-selection";
import { PlanSidebar } from "./plan-sidebar";
import { PlanTopbar, PlanToolbar } from "./plan-topbar";

/**
 * The 2D floor-plan surface.
 *
 * Three columns: navigation, the plan, and the detail rail that follows the
 * selection. It reads the same `RoomState` snapshot the 3D office reads, from
 * the same `RoomProvider`, and projects it through its own view model.
 *
 * Nothing in this subtree touches domain state. Mutations go out through
 * `RoomClient`, and updates arrive back as a new snapshot.
 */

function Plan() {
  const { room } = useRoom();
  const view = useMemo(() => createFloorPlanState(room), [room]);

  return (
    <div className="plan-root">
      <PlanSidebar view={view} />

      <main className="plan-main">
        <PlanTopbar view={view} />
        <div className="plan-stage">
          <PlanToolbar view={view} />
          <PlanCanvas view={view} />
        </div>
        <PlanLedger view={view} />
      </main>

      <PlanDetailRail view={view} />
      <PlanPositionDialog />
    </div>
  );
}

export function FloorPlanShell() {
  return (
    <PlanSelectionProvider>
      <Plan />
    </PlanSelectionProvider>
  );
}
