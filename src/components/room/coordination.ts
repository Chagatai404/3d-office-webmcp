import type { Participant, RoomPhase, RoomState } from "@/contracts/room";
import {
  ALIGNMENT_CHOICE_LABEL,
  PHASE_FOCUS,
  PHASE_LABEL,
} from "./room-labels";

/**
 * One coordination story, derived from the canonical room snapshot.
 *
 * This is the visible half of the same question an agent asks through
 * WebMCP: where are we, what is this phase for, who have we got, and who are
 * we still waiting for. It is a pure projection of `RoomState` — it decides
 * nothing, gates nothing, and is recomputed on every render, so the screen
 * and the protocol can never drift into two different stories.
 *
 * Removed participants are excluded everywhere below: someone who has left
 * the meeting is not pending work, and counting them would leave a room
 * permanently "waiting" for a person who is gone.
 */

export interface CoordinationPerson {
  id: string;
  name: string;
  /** The human-readable role the person holds, e.g. "CTO". */
  role: string;
  /** Whether this person has finished what the current phase asks of them. */
  done: boolean;
  /** Their state in words, never a colour or a tick alone. */
  detail: string;
}

export interface CoordinationFact {
  label: string;
  value: string;
  /** Draws the eye without being the only signal — the words still say it. */
  warn?: boolean;
}

export interface CoordinationStatus {
  phase: RoomPhase;
  phaseLabel: string;
  /** What this phase is trying to accomplish, in one line. */
  goal: string;
  /** Roster progress, e.g. "3 / 4 ready". Null where the phase has no roster. */
  progressLabel: string | null;
  /** The roster this phase is actually waiting on. Empty when it has none. */
  people: CoordinationPerson[];
  /** What the tick against each person means in this phase. */
  peopleLegend: string | null;
  /** Who or what is still holding the room up, by name. */
  waitingFor: string[];
  /**
   * The participants the room is waiting on, by id.
   *
   * Deliberately narrower than `waitingFor`: in Proposals the room is waiting
   * for *an option*, and in Deliberation for an objection to be settled, so
   * this is empty there. It holds people only where a named person is what the
   * room is actually short of — which is exactly what a seat in the 3D room can
   * honestly mark.
   */
  waitingParticipantIds: string[];
  /** The same answer as one sentence, for strips and screen readers. */
  waitingLine: string;
  facts: CoordinationFact[];
  /** Whether the room could move on, and what would let it. */
  advanceHint: string;
}

function activeHumans(room: RoomState): Participant[] {
  return room.participants.filter(
    (participant) => participant.status === "active" && participant.kind === "human",
  );
}

function nameList(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names.at(-1)}`;
}

function participantLabel(room: RoomState, participantId: string | null): string {
  if (!participantId) return "Someone";
  const participant = room.participants.find((candidate) => candidate.id === participantId);
  return participant ? participant.name : "Someone";
}

/** The first 12 characters are plenty to compare two screens by eye. */
export function shortDecisionHash(hash: string): string {
  return hash.length <= 12 ? hash : `${hash.slice(0, 12)}…`;
}

export function deriveCoordinationStatus(room: RoomState): CoordinationStatus {
  const humans = activeHumans(room);
  const base = {
    phase: room.phase,
    phaseLabel: PHASE_LABEL[room.phase],
    goal: PHASE_FOCUS[room.phase],
  };

  switch (room.phase) {
    case "input": {
      const sharedInput = new Set(room.positions.map((position) => position.participantId));
      const people = humans.map<CoordinationPerson>((participant) => ({
        id: participant.id,
        name: participant.name,
        role: participant.role,
        done: participant.isReady,
        detail: participant.isReady
          ? "Ready"
          : !participant.isClaimed
            ? "Has not joined yet"
            : sharedInput.has(participant.id)
              ? "Shared input, not ready yet"
              : "Nothing shared yet",
      }));
      const waitingFor = people.filter((person) => !person.done).map((person) => person.name);

      return {
        ...base,
        progressLabel: `${people.length - waitingFor.length} / ${people.length} ready`,
        people,
        peopleLegend: "Marked their input ready",
        waitingFor,
        waitingParticipantIds: people.filter((person) => !person.done).map((person) => person.id),
        waitingLine:
          waitingFor.length === 0
            ? "Everyone has marked their input ready."
            : `Waiting for ${nameList(waitingFor)} to mark input ready.`,
        facts: [],
        advanceHint:
          waitingFor.length === 0
            ? "Input is complete. The room can move to Proposals."
            : "Input stays open until everyone above has marked ready.",
      };
    }

    case "proposals": {
      const proposalsBy = new Map<string, number>();
      for (const proposal of room.proposals) {
        proposalsBy.set(proposal.participantId, (proposalsBy.get(proposal.participantId) ?? 0) + 1);
      }
      const active = room.proposals.find((proposal) => proposal.id === room.activeProposalId) ?? null;
      const people = humans.map<CoordinationPerson>((participant) => {
        const count = proposalsBy.get(participant.id) ?? 0;
        return {
          id: participant.id,
          name: participant.name,
          role: participant.role,
          done: count > 0,
          detail: count === 0 ? "Has not proposed anything" : `${count} proposed`,
        };
      });

      return {
        ...base,
        progressLabel:
          room.proposals.length === 1 ? "1 option proposed" : `${room.proposals.length} options proposed`,
        people,
        peopleLegend: "Put an option on the table",
        waitingFor: active ? [] : ["an option on the table"],
        // Nobody personally owes the room a proposal, so no seat is marked.
        waitingParticipantIds: [],
        waitingLine: active
          ? `“${active.title}” is on the table.`
          : "Waiting for someone to put an option on the table.",
        facts: [
          { label: "On the table", value: active ? active.title : "Nothing yet", warn: !active },
          {
            label: "Proposed by",
            value: active ? participantLabel(room, active.participantId) : "—",
          },
        ],
        advanceHint: active
          ? "An option is active. Deliberation can open."
          : "Deliberation opens once one option is active.",
      };
    }

    case "deliberation": {
      const open = room.conflicts.filter((conflict) => conflict.status === "open");
      const blocking = open.filter((conflict) => conflict.severity === "blocking");
      const warnings = open.filter((conflict) => conflict.severity === "warning");
      const waitingFor = blocking.map(
        (conflict) => `${participantLabel(room, conflict.raisedByActorId)}’s blocking objection`,
      );

      return {
        ...base,
        progressLabel: `${blocking.length} blocking · ${warnings.length} warning${
          warnings.length === 1 ? "" : "s"
        }`,
        people: [],
        peopleLegend: null,
        waitingFor,
        // The room is short of a settled objection, not of a person.
        waitingParticipantIds: [],
        waitingLine:
          blocking.length === 0
            ? warnings.length === 0
              ? "Nothing is open against the current option."
              : `${warnings.length} warning${warnings.length === 1 ? "" : "s"} open — none of them block the room.`
            : `Waiting on ${nameList(waitingFor)}.`,
        facts: [
          {
            label: "Blocking",
            value: blocking.length === 0 ? "None" : `${blocking.length} to settle`,
            warn: blocking.length > 0,
          },
          {
            label: "Warnings",
            value: warnings.length === 0 ? "None" : `${warnings.length} noted, not blocking`,
          },
        ],
        advanceHint:
          blocking.length === 0
            ? "Nothing blocking. Alignment can open."
            : `Alignment opens once ${
                blocking.length === 1 ? "this blocking objection is" : "these blocking objections are"
              } settled.`,
      };
    }

    case "voting": {
      const alignments = new Map(
        room.alignments
          .filter((alignment) => alignment.proposalId === room.activeProposalId)
          .map((alignment) => [alignment.participantId, alignment]),
      );
      const people = humans.map<CoordinationPerson>((participant) => {
        const alignment = alignments.get(participant.id);
        return {
          id: participant.id,
          name: participant.name,
          role: participant.role,
          done: alignment !== undefined,
          // Never "neutral" and never "no objection": a person who has not
          // spoken has not agreed to anything.
          detail: alignment ? ALIGNMENT_CHOICE_LABEL[alignment.choice] : "Waiting",
        };
      });
      const waitingFor = people.filter((person) => !person.done).map((person) => person.name);

      return {
        ...base,
        progressLabel: `${people.length - waitingFor.length} / ${people.length} shared`,
        people,
        peopleLegend: "Shared where they stand",
        waitingFor,
        waitingParticipantIds: people.filter((person) => !person.done).map((person) => person.id),
        waitingLine:
          waitingFor.length === 0
            ? "Everyone has said where they stand."
            : `Not heard from ${nameList(waitingFor)} yet.`,
        facts: [],
        advanceHint:
          "Alignment tells the decision maker how the room feels. It is not a vote, and it is not a requirement to proceed.",
      };
    }

    case "approval": {
      const preview = room.finalDecisionPreview;
      if (!preview) {
        return {
          ...base,
          progressLabel: null,
          people: [],
          peopleLegend: null,
          waitingFor: ["an exact decision to review"],
          waitingParticipantIds: [],
          waitingLine: "Waiting for the decision maker to open the exact decision for review.",
          facts: [{ label: "Decision", value: "Not frozen yet", warn: true }],
          advanceHint: "Nothing can be approved until an exact decision is frozen.",
        };
      }

      const approved = new Set(
        room.approvals
          .filter((approval) => approval.decisionHash === preview.decisionHash)
          .map((approval) => approval.participantId),
      );
      const people = preview.requiredApprovalParticipantIds.map<CoordinationPerson>((id) => {
        const participant = room.participants.find((candidate) => candidate.id === id);
        return {
          id,
          name: participant?.name ?? "Unknown participant",
          role: participant?.role ?? "Required approver",
          done: approved.has(id),
          detail: approved.has(id) ? "Approved" : "Has not confirmed yet",
        };
      });
      const waitingFor = people.filter((person) => !person.done).map((person) => person.name);

      return {
        ...base,
        progressLabel: `${people.length - waitingFor.length} / ${people.length} approved`,
        people,
        peopleLegend: "Confirmed this exact decision",
        waitingFor,
        waitingParticipantIds: people.filter((person) => !person.done).map((person) => person.id),
        waitingLine:
          waitingFor.length === 0
            ? "Every required approval is in."
            : `Waiting for ${nameList(waitingFor)} to confirm.`,
        facts: [
          { label: "Decision", value: preview.proposal.title },
          { label: "Frozen as", value: shortDecisionHash(preview.decisionHash) },
          { label: "Confirmation", value: "A person confirms, never an agent" },
        ],
        advanceHint:
          "An agent can prepare this exact decision for review. Only the approver's own confirmation finalizes it.",
      };
    }

    case "finalized": {
      const preview = room.finalDecisionPreview;
      return {
        ...base,
        progressLabel: null,
        people: [],
        peopleLegend: null,
        waitingFor: [],
        waitingParticipantIds: [],
        waitingLine: "Nothing. The decision is recorded and the same for everyone.",
        facts: preview
          ? [
              { label: "Decision", value: preview.proposal.title },
              { label: "Frozen as", value: shortDecisionHash(preview.decisionHash) },
            ]
          : [],
        advanceHint: "The record is immutable. Every participant reads the same one.",
      };
    }
  }
}
