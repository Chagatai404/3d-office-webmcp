import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { MeetingReport } from "@/contracts/room";
import { generateMeetingReportPdf } from "@/domain/rooms/report-pdf";

/**
 * pdf-lib Flate-compresses every content stream by default, and encodes
 * drawn text as PDF hex-string literals (`<48656C6C6F> Tj`) rather than
 * literal parenthesized strings -- so drawn text never appears as a plain
 * byte substring in the saved file. This inflates every
 * `stream ... endstream` block it can (silently skipping ones that are not
 * valid Flate data, e.g. embedded font programs) and hex-decodes every
 * `<...>` run found in the result, so tests can assert on the *rendered*
 * text the same way a human opening the PDF would see it.
 */
function extractDecompressedText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes);
  const streamRe = /(?<!end)stream\r?\n/g;
  let match: RegExpExecArray | null;
  const chunks: string[] = [];
  while ((match = streamRe.exec(raw.toString("latin1"))) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) continue;
    const slice = raw.subarray(start, end);
    try {
      chunks.push(inflateSync(slice).toString("latin1"));
    } catch {
      // Not a Flate stream (e.g. an embedded font program) -- skip it.
    }
  }
  const decompressed = chunks.join("\n");
  const decodedHexRuns = [...decompressed.matchAll(/<([0-9A-Fa-f]+)>/g)]
    .map(([, hex]) => Buffer.from(hex ?? "", "hex").toString("latin1"));
  return [decompressed, ...decodedHexRuns].join("\n");
}

/**
 * A9: `generateMeetingReportPdf` renders `MeetingReport` (A8) to PDF bytes.
 * This is a pure-fixture test of the renderer itself; the authenticated
 * end-to-end route behavior (auth, finalization gate, real decision hash)
 * is covered against real Postgres in
 * tests/domain/report-pdf-route.test.ts.
 */

const fixtureReport: MeetingReport = {
  roomId: "room-under-test",
  title: "Should we ship AI onboarding?",
  brief: "Decide whether to ship AI-assisted onboarding next release.",
  executiveSummary: '"Should we ship AI onboarding?" was finalized as "Reduced scope onboarding" by owner decision -- 1 of 1 required approver confirmed with 1 accepted trade-off, alongside 1 recorded dissent note.',
  finalDecision: { title: "Reduced scope onboarding", summary: "Ship the smallest complete onboarding scope." },
  rationale: "Fits the deadline without an authentication rewrite.",
  participants: [
    { id: "participant-owner", name: "Ata", role: "Founder", kind: "human", meetingRole: "owner", decisionRole: "decision_maker", isClaimed: true, isReady: true, status: "active", removedAt: null, createdAt: "2026-08-30T00:00:00.000Z" },
    { id: "participant-engineer", name: "Maya", role: "Engineer", kind: "human", meetingRole: "participant", decisionRole: "contributor", isClaimed: true, isReady: true, status: "active", removedAt: null, createdAt: "2026-08-30T00:00:01.000Z" },
  ],
  decisionPolicy: "owner_decides",
  keyInputs: [{ id: "position-1", participantId: "participant-engineer", summary: "Capacity is tight this sprint.", category: "capacity", priority: "high", createdAt: "2026-08-30T00:00:00.000Z" }],
  constraints: [{ id: "constraint-1", participantId: "participant-engineer", category: "capacity", text: "No authentication rewrite.", priority: "critical", createdAt: "2026-08-30T00:00:00.000Z" }],
  proposalsConsidered: [{ id: "proposal-1", participantId: "participant-engineer", title: "Reduced scope onboarding", summary: "Ship the smallest complete onboarding scope.", rationale: "Fits the deadline.", expectedOutcomes: ["Launch on time"], referencedConstraintIds: [], parentProposalId: null, status: "accepted", createdAt: "2026-08-30T00:00:00.000Z" }],
  concernsRaised: [{ id: "conflict-1", proposalId: "proposal-1", constraintId: "constraint-1", raisedByActorType: "participant", raisedByActorId: "participant-engineer", severity: "blocking", reason: "Too broad initially.", status: "resolved", resolvedByActorType: "participant", resolvedByActorId: "participant-engineer", resolutionNote: "Scope reduced.", createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: "2026-08-30T00:05:00.000Z" }],
  resolvedConcerns: [{ id: "conflict-1", proposalId: "proposal-1", constraintId: "constraint-1", raisedByActorType: "participant", raisedByActorId: "participant-engineer", severity: "blocking", reason: "Too broad initially.", status: "resolved", resolvedByActorType: "participant", resolvedByActorId: "participant-engineer", resolutionNote: "Scope reduced.", createdAt: "2026-08-30T00:00:00.000Z", resolvedAt: "2026-08-30T00:05:00.000Z" }],
  unresolvedWarnings: [],
  acceptedTradeoffs: [{ id: "tradeoff-1", conflictIds: ["conflict-1"], createdByActorType: "participant", createdByActorId: "participant-engineer", description: "Reduce scope.", expectedEffect: "Fits capacity.", resultingProposalId: "proposal-1", createdAt: "2026-08-30T00:00:00.000Z" }],
  alignment: [{ proposalId: "proposal-1", participantId: "participant-owner", choice: "support", comment: null, updatedAt: "2026-08-30T00:00:00.000Z" }],
  dissent: ["Maya noted residual timeline risk."],
  expertAdvice: [{ expertKey: "security", findingId: "finding-1", proposalId: "proposal-1", category: "behavioral_tracking", title: "Behavioral tracking reviewed", status: "resolved", resolutionRationale: "No tracking in the final scope." }],
  actionItems: [{ id: "action-1", text: "Update onboarding copy.", ownerParticipantId: "participant-engineer", dueAt: null }],
  owners: [{ participantId: "participant-owner", responsibility: "Ship the release." }],
  deadlines: [{ label: "Launch", dueAt: "2026-09-15T00:00:00.000Z" }],
  requiredApprovalParticipantIds: ["participant-owner"],
  approvals: [{ participantId: "participant-owner", decisionHash: "hash-final-abc123", approvedAt: "2026-08-30T02:00:00.000Z" }],
  decisionHash: "hash-final-abc123",
  finalizedAt: "2026-08-30T02:00:01.000Z",
  provenanceSummary: { totalEvents: 4, byAction: { "room.created": 1, "proposal.submitted": 1, "approval.recorded": 1, "decision.finalized": 1 } },
};

describe("generateMeetingReportPdf", () => {
  it("produces a valid, non-trivial PDF", async () => {
    const bytes = await generateMeetingReportPdf(fixtureReport);
    expect(bytes.length).toBeGreaterThan(1000);
    const header = Buffer.from(bytes.slice(0, 8)).toString("latin1");
    expect(header.startsWith("%PDF-")).toBe(true);
  });

  it("embeds the decision hash in the rendered document", async () => {
    const bytes = await generateMeetingReportPdf(fixtureReport);
    const text = extractDecompressedText(bytes);
    expect(text).toContain(fixtureReport.decisionHash);
  });

  it("embeds the report title and final decision title", async () => {
    const bytes = await generateMeetingReportPdf(fixtureReport);
    const text = extractDecompressedText(bytes);
    expect(text).toContain("Should we ship AI onboarding?");
    expect(text).toContain("Reduced scope onboarding");
  });

  it("handles an empty-everything report without throwing", async () => {
    const empty: MeetingReport = {
      ...fixtureReport,
      keyInputs: [], constraints: [], proposalsConsidered: [], concernsRaised: [], resolvedConcerns: [],
      acceptedTradeoffs: [], alignment: [], dissent: [], unresolvedWarnings: [], expertAdvice: [],
      actionItems: [], owners: [], deadlines: [], approvals: [],
    };
    const bytes = await generateMeetingReportPdf(empty);
    expect(bytes.length).toBeGreaterThan(500);
  });
});
