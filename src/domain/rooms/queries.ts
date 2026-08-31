import type {
  ActorType,
  Conflict,
  Constraint,
  Proposal,
} from "@/contracts/room";
import type { RoomRepository } from "./repository";

export interface OpenIssue {
  conflictId: Conflict["id"];
  proposal: Pick<Proposal, "id" | "title" | "summary">;
  constraint: Pick<Constraint, "id" | "category" | "text" | "priority"> | null;
  raisedBy: {
    actorType: ActorType;
    actorId: string | null;
    displayName: string;
  };
  severity: Conflict["severity"];
  reason: string;
  status: "open";
  latestRelatedProposalId: string | null;
}

export async function getOpenIssues(
  repository: RoomRepository,
  actorUserId: string,
  roomId: string,
): Promise<OpenIssue[]> {
  const room = await repository.getRoom(roomId, actorUserId);
  if (!room) return [];

  const participants = new Map(room.participants.map((participant) => [participant.id, participant]));
  const proposals = new Map(room.proposals.map((proposal) => [proposal.id, proposal]));
  const constraints = new Map(room.constraints.map((constraint) => [constraint.id, constraint]));

  return room.conflicts.flatMap((conflict) => {
    if (conflict.status !== "open") return [];
    const proposal = proposals.get(conflict.proposalId);
    if (!proposal) return [];
    const constraint = conflict.constraintId ? constraints.get(conflict.constraintId) : undefined;
    const participant = conflict.raisedByActorId
      ? participants.get(conflict.raisedByActorId)
      : undefined;

    return [{
      conflictId: conflict.id,
      proposal: { id: proposal.id, title: proposal.title, summary: proposal.summary },
      constraint: constraint
        ? {
            id: constraint.id,
            category: constraint.category,
            text: constraint.text,
            priority: constraint.priority,
          }
        : null,
      raisedBy: {
        actorType: conflict.raisedByActorType,
        actorId: conflict.raisedByActorId,
        displayName: participant?.name
          ?? (conflict.raisedByActorType === "expert" ? "Expert" : "System"),
      },
      severity: conflict.severity,
      reason: conflict.reason,
      status: "open" as const,
      latestRelatedProposalId:
        room.activeProposalId && room.activeProposalId !== proposal.id
          ? room.activeProposalId
          : null,
    }];
  });
}
