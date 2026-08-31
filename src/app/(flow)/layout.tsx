import type { ReactNode } from "react";
import { FlowStage } from "@/components/onboarding/flow-stage";

/**
 * The pre-meeting flow shares one persistent 3D stage.
 *
 * This layout stays mounted while the user moves between welcome, create and
 * lobby, so the `<Canvas>` is never torn down and rebuilt. `FlowStage` owns
 * the camera pose, the framing, and the flight that carries the user from one
 * screen to the next.
 */
export default function FlowLayout({ children }: { children: ReactNode }) {
  return <FlowStage>{children}</FlowStage>;
}
