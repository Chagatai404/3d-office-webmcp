/**
 * Client-side bridge from a sensitive WebMCP tool call to the *existing*
 * visible confirmation surface for that action.
 *
 * A WebMCP tool's `execute()` runs outside the React tree — `document.
 * modelContext` calls it directly, not a component. This module is the only
 * channel it has to reach into the mounted UI, and deliberately does
 * nothing else: it never performs the mutation, never records an approval,
 * and never bypasses the human's own click. `transfer_ownership` and
 * `remove_participant` (`src/webmcp/room-tools.ts`) validate their target
 * read-only and then call `requestUiConfirmation` instead of calling the
 * domain layer at all; `approve_final_decision` calls the
 * domain layer (which itself refuses without a human confirmation, per
 * `approve_participant_final_decision`'s `p_human_confirmed` gate) and then
 * calls `requestUiConfirmation` so the Decision workspace is already open
 * when the result comes back.
 */

export type ConfirmationRequest =
  | { kind: "participants"; action: "remove" | "transfer"; participantId: string }
  | { kind: "decision" }
  | { kind: "sources"; action: "upload" };

type ParticipantsRequest = Extract<ConfirmationRequest, { kind: "participants" }>;

type Listener = (request: ConfirmationRequest) => void;

const listeners = new Set<Listener>();

/**
 * One-shot "arm the exact confirmation dialog" signal, consumed by
 * `ParticipantPanel` through `useSyncExternalStore` so it can pre-open its
 * own alertdialog for the named participant exactly as if the human had
 * clicked Remove/Make owner themselves.
 */
let latestParticipantsRequest: ParticipantsRequest | null = null;
const armListeners = new Set<() => void>();

export function requestUiConfirmation(request: ConfirmationRequest): void {
  if (request.kind === "participants") {
    latestParticipantsRequest = request;
    for (const listener of armListeners) listener();
  }
  for (const listener of listeners) listener(request);
}

/** Subscribed once by the meeting shell to open the right drawer/workspace. */
export function subscribeToUiConfirmation(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function subscribeToArmedParticipantsRequest(onStoreChange: () => void): () => void {
  armListeners.add(onStoreChange);
  return () => armListeners.delete(onStoreChange);
}

export function getArmedParticipantsRequestSnapshot(): ParticipantsRequest | null {
  return latestParticipantsRequest;
}

/** Called by `ParticipantPanel` once it has consumed the armed request. */
export function consumeArmedParticipantsRequest(): void {
  latestParticipantsRequest = null;
}
