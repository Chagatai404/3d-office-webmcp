"use client";

import type { AttentionItem } from "@/contracts/room";
import { targetFor } from "../attention-routes";
import { useAttentionItems } from "../use-attention-items";
import { useShell } from "../shell-provider";
import { DrawerShell } from "./drawer-shell";

export function AttentionDrawer() {
  const items = useAttentionItems();
  const { openDrawer, goToWorkspace, closeDrawer } = useShell();

  function open(item: AttentionItem) {
    const target = targetFor(item, item.phase);
    if (target.drawer) openDrawer(target.drawer);
    else if (target.workspace) goToWorkspace(target.workspace);
    else closeDrawer();
  }

  return (
    <DrawerShell
      label="Needs you"
      title="Needs you"
      subtitle={items.length === 0 ? "You're all caught up" : `${items.length} item${items.length === 1 ? "" : "s"}`}
    >
      {items.length === 0 ? (
        <p className="panel-note">Nothing needs your attention right now. Your agent can keep going.</p>
      ) : (
        <ul className="participant-list">
          {items.map((item) => (
            <li key={item.id} className="participant-row">
              <div className="participant-identity">
                <span className="participant-name">
                  {item.title}
                  {item.priority === "critical" ? <span className="tag tag-owner">Critical</span> : null}
                </span>
                <span className="participant-role">{item.summary}</span>
              </div>
              <div className="participant-tags">
                <button type="button" className="button-quiet" onClick={() => open(item)}>
                  Review
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </DrawerShell>
  );
}
