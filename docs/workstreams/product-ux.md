# Product UX / 3D Workstream — Meeting Room Overhaul

This checklist replaces the earlier mini-office / desktop-window / floor-plan
workstream.

The backend/domain contract is not being redesigned here. The target is a
presentation-layer overhaul on top of the existing `RoomProvider`,
`RoomClient`, and canonical `RoomState`.

## 0. Cleanup baseline

- [x] **UX-000** Rewrite canonical product docs around one meeting room.
- [x] **UX-001** Remove standalone 2D floor-plan prototype and tests.
- [x] **UX-002** Remove generic committed low-poly asset packs and generators.
- [x] **UX-003** Remove loose generated/reference files and obsolete prompt docs.
- [x] **UX-004** Document legacy `DesktopShell` as migration-only.

Exit gate: no new work should depend on the removed `/plan` prototype or generic
asset pipeline.

## 1. New meeting shell

- [ ] **UX-100** Create `src/components/meeting/meeting-shell.tsx`.
- [ ] **UX-101** Make `/room/[roomId]` render `MeetingShell` instead of
  `DesktopShell` outside the E2E harness.
- [ ] **UX-102** Keep `RoomProvider` as the single canonical snapshot/action
  owner.
- [ ] **UX-103** Add compact title/phase/status treatment that does not compete
  with the 3D stage.
- [ ] **UX-104** Preserve useful error/action feedback without permanent large
  panels.

Exit gate: the room opens into one clean stage with no floating OS windows.

## 2. Meeting toolbar — metadata

- [ ] **UX-200** Add Participants drawer.
- [ ] **UX-201** Add My Role / seat-state drawer or popover.
- [ ] **UX-202** Add Invite / Share controls for organizers.
- [ ] **UX-203** Add Activity / provenance drawer.
- [ ] **UX-204** Add WebMCP connection/status guidance.
- [ ] **UX-205** Add organizer phase controls in an organizer-only drawer.
- [ ] **UX-206** Add Settings / Leave controls as applicable.
- [ ] **UX-207** Do not add fake mic/camera/screen-share controls.

Exit gate: all meeting metadata is reachable without placing it permanently over
the stage.

## 3. Workspace dock

- [ ] **UX-300** Define presentation-only `MeetingWorkspace` IDs:
  `room | brief | constraints | proposals | issues | whiteboard | vote | decision`.
- [ ] **UX-301** Add a keyboard-reachable bottom workspace dock.
- [ ] **UX-302** Derive availability/attention/completion state from canonical
  room state.
- [ ] **UX-303** Add issue-count and approval/vote attention indicators without
  turning the dock into a status dashboard.
- [ ] **UX-304** Keep workspace selection out of `RoomState`.

Exit gate: users can intentionally choose one meeting artifact without opening a
stack of panels.

## 4. Camera system

- [ ] **UX-400** Replace free-flight/god-view input with fixed camera poses.
- [ ] **UX-401** Create `workspace-layout.ts` containing deterministic target
  poses for every workspace.
- [ ] **UX-402** Add eased camera transitions with safe retargeting.
- [ ] **UX-403** Respect `prefers-reduced-motion`.
- [ ] **UX-404** Clicking a 3D workspace object selects the same workspace action
  used by the DOM dock.
- [ ] **UX-405** Add unit tests for deterministic pose lookup and workspace
  selection.

Exit gate: camera movement communicates “we are looking at this part of the
meeting now,” not “you are navigating a game level.”

## 5. Neutral procedural meeting room

- [ ] **UX-500** Build a single architectural room shell with procedural geometry.
- [ ] **UX-501** Build one central meeting table and participant seats.
- [ ] **UX-502** Represent participants with restrained seat/nameplate markers.
- [ ] **UX-503** Add a subtle active-agent pulse sourced from activity state.
- [ ] **UX-504** Use a bright neutral material/lighting system matching the
  reference mood.
- [ ] **UX-505** Keep all temporary objects replaceable by semantic component.

Exit gate: the stage is visually clean before any custom Blender asset exists.

## 6. 3D decision workspaces

Implement one at a time. Each includes a 3D surface plus its accessible DOM
workspace panel.

- [ ] **UX-600** Room overview / central table.
- [ ] **UX-610** Brief board.
- [ ] **UX-620** Constraint board.
- [ ] **UX-630** Proposal board / active proposal focus.
- [ ] **UX-640** Issue/evaluation board with proposal↔constraint linkage.
- [ ] **UX-650** Whiteboard / notes surface.
- [ ] **UX-660** Vote surface and own-vote action.
- [ ] **UX-670** Decision/approval surface with exact hash-bound review.

Exit gate: only one workspace is foregrounded at a time, while canonical room
state remains unchanged by navigation.

## 7. Phase choreography

- [ ] **UX-700** Input phase defaults to Room or Constraints as appropriate.
- [ ] **UX-701** Proposals phase guides attention toward Proposals.
- [ ] **UX-702** Deliberation highlights Issues when blocking objections exist.
- [ ] **UX-703** Voting brings Vote into focus without auto-casting anything.
- [ ] **UX-704** Approval brings Decision into deliberate review mode.
- [ ] **UX-705** Finalized state locks the Decision workspace into a read-only
  final-record presentation.
- [ ] **UX-706** Automatic attention changes never override an active form/action
  unexpectedly.

## 8. Blender MCP asset handoff

Do not start until the procedural scene UX works.

- [ ] **UX-800** Freeze semantic object list and approximate dimensions.
- [ ] **UX-801** Define a small `.glb` asset naming/coordinate convention.
- [ ] **UX-802** Create room shell + furniture in Blender MCP.
- [ ] **UX-803** Create dedicated board assets for each workspace.
- [ ] **UX-804** Replace procedural placeholders one component at a time.
- [ ] **UX-805** Keep total asset count intentionally small and optimize for web.
- [ ] **UX-806** Never reintroduce a generic asset pack.

## 9. Accessibility and fallback

- [ ] **UX-900** Every workspace dock item is keyboard reachable.
- [ ] **UX-901** Every 3D concept has readable DOM content.
- [ ] **UX-902** WebGL failure keeps the full decision workflow usable.
- [ ] **UX-903** Focus management follows opened drawers/workspaces.
- [ ] **UX-904** Camera motion honors reduced-motion preferences.
- [ ] **UX-905** Color is never the only status cue.

## 10. Tests / hardening

- [ ] **UX-950** Meeting shell renders canonical room snapshot.
- [ ] **UX-951** Workspace selection does not mutate room state/version.
- [ ] **UX-952** Phase gating derives from canonical room state.
- [ ] **UX-953** Participants/activity drawers show canonical data.
- [ ] **UX-954** WebMCP activity visibly maps to the correct participant.
- [ ] **UX-955** Proposal/conflict/vote/approval workspaces use existing actions.
- [ ] **UX-956** E2E judge path remains functional during the migration.
- [ ] **UX-957** Run `npm run check`, `npm run build`, domain tests, and E2E.

## 11. Legacy deletion after cutover

Only delete these after `MeetingShell` is the working default:

- [ ] **UX-980** Remove `src/components/shell/**`.
- [ ] **UX-981** Remove mini-office/common-area/roaming scene components.
- [ ] **UX-982** Remove god-view/free-flight controls and old scene-focus model.
- [ ] **UX-983** Remove obsolete office-layout geometry no longer needed by the
  meeting scene.
- [ ] **UX-984** Remove tests that only protect deleted shell/navigation behavior.
- [ ] **UX-985** Update README/status with the final new file map.

## Definition of done

- [ ] A first-time user sees one uncluttered 3D meeting room.
- [ ] Participant/role/invite/activity/settings information is accessible from
  meeting controls rather than permanent panels.
- [ ] Constraints/proposals/issues/notes/vote/decision are separate focused
  workspaces.
- [ ] Workspace selection causes a clear camera transition.
- [ ] Only one decision workspace is foregrounded at a time.
- [ ] 3D and DOM read the same canonical room state.
- [ ] No low-poly/generic office asset pack remains.
- [ ] Human vote and approval authority remain unchanged.
- [ ] Existing backend/WebMCP tests still pass.
