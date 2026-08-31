import { NextResponse } from "next/server";
import type { MeetingReport } from "@/contracts/room";
import { getFinalMeetingReport } from "@/domain/rooms/operations";
import { generateMeetingReportPdf } from "@/domain/rooms/report-pdf";
import { actionResponse, authenticateRoomRequest } from "@/app/api/_shared/request";

/**
 * A9: `MeetingReport` (A8) rendered to PDF, for any participant of a
 * finalized room. `getFinalDecisionRecord` alone already enforces every
 * access rule this route needs -- authenticated session, legitimate room
 * membership (RLS-backed: an unrelated caller gets the same `VALIDATION_ERROR:
 * Room not found` a nonexistent room would), and `WRONG_PHASE` before
 * finalization -- so this route adds no separate authorization logic of its
 * own. The PDF is generated from the exact same `computeMeetingReport`
 * output `get_final_report` returns; nothing here reconstructs the report
 * independently.
 */

function suggestedFilename(report: MeetingReport): string {
  const slug = report.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "meeting"}-decision-report.pdf`;
}

export async function GET(request: Request, { params }: { params: Promise<{ roomId: string }> }) {
  const auth = await authenticateRoomRequest(request);
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { roomId } = await params;

  const reportResult = await getFinalMeetingReport(auth.repository, auth.userId, roomId);
  if (!reportResult.ok) return actionResponse(reportResult);
  const report = reportResult.data;
  const pdfBytes = await generateMeetingReportPdf(report);

  return new NextResponse(Buffer.from(pdfBytes), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${suggestedFilename(report)}"`,
      "Cache-Control": "no-store",
    },
  });
}
