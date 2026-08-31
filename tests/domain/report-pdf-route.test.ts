import { inflateSync } from "node:zlib";
import { createClient } from "@supabase/supabase-js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  addParticipantPosition,
  admitJoinRequest,
  advanceRoomPhase,
  approveParticipantFinalDecision,
  createRoom,
  expressMyAlignment,
  getMeetingContext,
  markMyInputReady,
  requestJoinByInvite,
  submitParticipantProposal,
} from "@/domain/rooms/operations";
import { GET as getReportPdf } from "@/app/api/rooms/[roomId]/report.pdf/route";
import type { CreateRoomInput } from "@/contracts/room";
import type { MutationContext } from "@/domain/rooms/repository";
import { SupabaseRoomRepository } from "@/lib/supabase/room-repository";

/**
 * A9: `GET /api/rooms/:roomId/report.pdf` against real Postgres/auth,
 * invoking the exported route handler directly (no dev server needed --
 * it is a plain async function). Covers the full authorization matrix and
 * proves the served PDF's embedded decision hash matches the same
 * `MeetingReport` `get_final_report` would return.
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://127.0.0.1:54321";
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";

async function actor() {
  const authClient = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await authClient.auth.signInAnonymously();
  if (error || !data.user || !data.session) throw error ?? new Error("Anonymous auth failed.");
  const client = createClient(url, key, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { userId: data.user.id, accessToken: data.session.access_token, repository: new SupabaseRoomRepository(client) };
}

type Actor = Awaited<ReturnType<typeof actor>>;
const actorOf = (session: Actor) => ({ authUserId: session.userId, origin: "manual_ui" as const });
const ctx = (session: Actor, expectedRoomVersion: number): MutationContext => ({
  actor: actorOf(session), expectedRoomVersion,
});

function inviteTokenOf(inviteUrl: string): string {
  const token = new URL(inviteUrl).searchParams.get("invite");
  if (!token) throw new Error(`No invite token in ${inviteUrl}.`);
  return token;
}

function pdfRequest(roomId: string, accessToken?: string): Request {
  return new Request(`http://localhost/api/rooms/${roomId}/report.pdf`, {
    headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
  });
}

function callRoute(roomId: string, accessToken?: string) {
  return getReportPdf(pdfRequest(roomId, accessToken), { params: Promise.resolve({ roomId }) });
}

function extractDecompressedText(bytes: ArrayBuffer): string {
  const raw = Buffer.from(bytes);
  const streamRe = /(?<!end)stream\r?\n/g;
  let match: RegExpExecArray | null;
  const chunks: string[] = [];
  while ((match = streamRe.exec(raw.toString("latin1"))) !== null) {
    const start = match.index + match[0].length;
    const end = raw.indexOf("endstream", start);
    if (end === -1) continue;
    try {
      chunks.push(inflateSync(raw.subarray(start, end)).toString("latin1"));
    } catch {
      // Not a Flate stream -- skip.
    }
  }
  const decompressed = chunks.join("\n");
  const decodedHexRuns = [...decompressed.matchAll(/<([0-9A-Fa-f]+)>/g)]
    .map(([, hex]) => Buffer.from(hex ?? "", "hex").toString("latin1"));
  return [decompressed, ...decodedHexRuns].join("\n");
}

const roomInput: CreateRoomInput = {
  title: "PDF export end-to-end",
  brief: "Prove GET /api/rooms/:roomId/report.pdf's authorization matrix and content.",
  creatorName: "Ata",
  creatorRole: "Founder",
};

describe.sequential("A9: GET /api/rooms/:roomId/report.pdf", () => {
  let owner: Actor;
  let maya: Actor;
  let outsider: Actor;
  let roomId = "";
  let decisionHash = "";

  beforeAll(async () => {
    [owner, maya, outsider] = await Promise.all([actor(), actor(), actor()]);

    const created = await createRoom(owner.repository, roomInput, { actor: actorOf(owner) });
    if (!created.ok) throw new Error(created.error.message);
    roomId = created.data.roomId;

    const request = await requestJoinByInvite(
      maya.repository,
      { inviteToken: inviteTokenOf(created.data.inviteUrl), displayName: "Maya", role: "Engineer" },
      actorOf(maya),
    );
    if (!request.ok) throw new Error(request.error.message);
    const admitted = await admitJoinRequest(
      owner.repository, roomId, { joinRequestId: request.data.joinRequest.id, role: null, decisionRole: null }, ctx(owner, 0),
    );
    if (!admitted.ok) throw new Error(admitted.error.message);

    const position = await addParticipantPosition(
      owner.repository, roomId,
      { summary: "Ship a reduced onboarding scope.", category: "outcome", priority: "high", constraints: [] },
      ctx(owner, admitted.roomVersion),
    );
    if (!position.ok) throw new Error(position.error.message);
    const ready = await markMyInputReady(owner.repository, roomId, ctx(owner, position.roomVersion));
    if (!ready.ok) throw new Error(ready.error.message);
    const toProposals = await advanceRoomPhase(owner.repository, roomId, "proposals", ctx(owner, ready.roomVersion));
    if (!toProposals.ok) throw new Error(toProposals.error.message);
  });

  it("refuses an unauthenticated request", async () => {
    const response = await callRoute(roomId, undefined);
    expect(response.status).toBe(401);
  });

  it("refuses a caller with no legitimate access to the room", async () => {
    const response = await callRoute(roomId, outsider.accessToken);
    expect(response.status).not.toBe(200);
    const body = await response.json();
    expect(body.error?.code).toBe("VALIDATION_ERROR");
  });

  it("refuses a member of a room that is not yet finalized", async () => {
    const response = await callRoute(roomId, owner.accessToken);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error?.code).toBe("WRONG_PHASE");
  });

  it("serves a valid PDF containing the matching decision hash once finalized", async () => {
    const beforeProposal = await getMeetingContext(owner.repository, owner.userId, roomId);
    const proposal = await submitParticipantProposal(
      owner.repository, roomId,
      {
        title: "Reduced scope onboarding", summary: "Ship the smallest complete onboarding scope.",
        rationale: "Fits the deadline without an authentication rewrite.",
        expectedOutcomes: ["Launch on time"], referencedConstraintIds: [], parentProposalId: null,
      },
      ctx(owner, beforeProposal!.version),
    );
    if (!proposal.ok) throw new Error(proposal.error.message);
    const room = await getMeetingContext(owner.repository, owner.userId, roomId);
    const proposalId = room!.activeProposalId!;
    const toDeliberation = await advanceRoomPhase(owner.repository, roomId, "deliberation", ctx(owner, proposal.roomVersion));
    if (!toDeliberation.ok) throw new Error(toDeliberation.error.message);
    const toVoting = await advanceRoomPhase(owner.repository, roomId, "voting", ctx(owner, toDeliberation.roomVersion));
    if (!toVoting.ok) throw new Error(toVoting.error.message);
    const ownerAlignment = await expressMyAlignment(
      owner.repository, roomId, { proposalId, choice: "support", comment: null }, ctx(owner, toVoting.roomVersion),
    );
    if (!ownerAlignment.ok) throw new Error(ownerAlignment.error.message);
    const toApproval = await advanceRoomPhase(owner.repository, roomId, "approval", ctx(owner, ownerAlignment.roomVersion));
    if (!toApproval.ok) throw new Error(toApproval.error.message);
    const preview = await getMeetingContext(owner.repository, owner.userId, roomId);
    decisionHash = preview!.finalDecisionPreview!.decisionHash;
    const approval = await approveParticipantFinalDecision(
      owner.repository, roomId, { decisionHash }, { ...ctx(owner, toApproval.roomVersion), humanConfirmed: true },
    );
    if (!approval.ok) throw new Error(approval.error.message);

    const response = await callRoute(roomId, owner.accessToken);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toMatch(/attachment; filename="pdf-export-end-to-end-decision-report\.pdf"/);

    const bytes = await response.arrayBuffer();
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(Buffer.from(bytes.slice(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(extractDecompressedText(bytes)).toContain(decisionHash);
  });

  it("serves the same finalized report to the other participant, with the same decision hash", async () => {
    const response = await callRoute(roomId, maya.accessToken);
    expect(response.status).toBe(200);
    const bytes = await response.arrayBuffer();
    expect(extractDecompressedText(bytes)).toContain(decisionHash);
  });

  it("still refuses an outsider even after finalization", async () => {
    const response = await callRoute(roomId, outsider.accessToken);
    expect(response.status).not.toBe(200);
  });
});
