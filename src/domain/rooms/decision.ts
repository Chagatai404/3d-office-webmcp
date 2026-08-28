import {
  finalDecisionCandidateSchema,
  type FinalDecisionCandidate,
  type FinalDecisionPreview,
  type JsonValue,
} from "@/contracts/room";

export function decisionCandidateFromPreview(
  preview: FinalDecisionPreview,
): FinalDecisionCandidate {
  return {
    proposal: preview.proposal,
    rationale: preview.rationale,
    acceptedTradeoffs: preview.acceptedTradeoffs,
    unresolvedWarnings: preview.unresolvedWarnings,
    votes: preview.votes,
    owners: preview.owners,
    deadlines: preview.deadlines,
    actionItems: preview.actionItems,
    dissent: preview.dissent,
    requiredApprovalParticipantIds: preview.requiredApprovalParticipantIds,
  };
}

function byId<T extends { id: string }>(left: T, right: T) {
  return left.id.localeCompare(right.id);
}

/**
 * Defines which approval-sensitive arrays are semantic sets and gives them a
 * deterministic order before canonical JSON serialization.
 */
export function normalizeDecisionCandidate(
  input: FinalDecisionCandidate,
): FinalDecisionCandidate {
  const candidate = finalDecisionCandidateSchema.parse(input);
  return {
    ...candidate,
    proposal: {
      ...candidate.proposal,
      expectedOutcomes: [...candidate.proposal.expectedOutcomes].sort(),
      referencedConstraintIds: [...candidate.proposal.referencedConstraintIds].sort(),
    },
    acceptedTradeoffs: [...candidate.acceptedTradeoffs]
      .map((tradeoff) => ({
        ...tradeoff,
        conflictIds: [...tradeoff.conflictIds].sort(),
      }))
      .sort(byId),
    unresolvedWarnings: [...candidate.unresolvedWarnings].sort(byId),
    votes: [...candidate.votes].sort((left, right) =>
      `${left.proposalId}:${left.participantId}`.localeCompare(
        `${right.proposalId}:${right.participantId}`,
      )),
    owners: [...candidate.owners].sort((left, right) =>
      left.participantId.localeCompare(right.participantId),
    ),
    deadlines: [...candidate.deadlines].sort((left, right) =>
      `${left.dueAt}:${left.label}`.localeCompare(`${right.dueAt}:${right.label}`),
    ),
    actionItems: [...candidate.actionItems].sort(byId),
    dissent: [...candidate.dissent].sort(),
    requiredApprovalParticipantIds: [
      ...candidate.requiredApprovalParticipantIds,
    ].sort(),
  };
}

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(",")}}`;
}

export function serializeDecisionCandidate(input: FinalDecisionCandidate): string {
  return canonicalJson(normalizeDecisionCandidate(input) as JsonValue);
}

export async function hashDecisionCandidate(
  input: FinalDecisionCandidate,
): Promise<string> {
  const bytes = new TextEncoder().encode(serializeDecisionCandidate(input));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
