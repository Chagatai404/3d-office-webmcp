import { PDFDocument, type PDFFont, type PDFPage, StandardFonts, rgb } from "pdf-lib";
import type { MeetingReport } from "@/contracts/room";

/**
 * A9: renders `MeetingReport` (A8) to a PDF. This is presentation only --
 * every value drawn here is read straight off the report object passed in;
 * nothing is recomputed or reconstructed independently. See
 * `GET /api/rooms/:roomId/report.pdf` (`src/app/api/rooms/[roomId]/
 * report.pdf/route.ts`) for the endpoint that calls this against the same
 * `computeMeetingReport` output `get_final_report` returns.
 */

const PAGE_WIDTH = 612; // US Letter, points
const PAGE_HEIGHT = 792;
const MARGIN = 54;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const INK = rgb(0.1, 0.1, 0.12);
const MUTED = rgb(0.4, 0.4, 0.45);
const RULE = rgb(0.82, 0.82, 0.85);

function formatTimestamp(isoTimestamp: string): string {
  const parsed = new Date(isoTimestamp);
  if (Number.isNaN(parsed.getTime())) return isoTimestamp;
  return parsed.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
}

function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];
  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter((word) => word.length > 0);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
        lines.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) lines.push(current);
  }
  return lines;
}

class ReportPdfWriter {
  private page!: PDFPage;
  private y = 0;

  private constructor(
    private readonly doc: PDFDocument,
    private readonly regular: PDFFont,
    private readonly bold: PDFFont,
  ) {}

  static async create(): Promise<ReportPdfWriter> {
    const doc = await PDFDocument.create();
    doc.setTitle("Meeting Decision Report");
    doc.setProducer("Quorum");
    const regular = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const writer = new ReportPdfWriter(doc, regular, bold);
    writer.newPage();
    return writer;
  }

  private newPage(): void {
    this.page = this.doc.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    this.y = PAGE_HEIGHT - MARGIN;
  }

  private ensureSpace(height: number): void {
    if (this.y - height < MARGIN) this.newPage();
  }

  private drawLines(lines: string[], font: PDFFont, size: number, color = INK, lineHeight = size * 1.35): void {
    for (const line of lines) {
      this.ensureSpace(lineHeight);
      this.page.drawText(line, { x: MARGIN, y: this.y - size, size, font, color });
      this.y -= lineHeight;
    }
  }

  heading(text: string): void {
    this.ensureSpace(30);
    this.drawLines(wrapLines(text, this.bold, 20, CONTENT_WIDTH), this.bold, 20);
    this.y -= 6;
  }

  subheading(text: string): void {
    this.ensureSpace(26);
    this.y -= 6;
    this.drawLines([text], this.bold, 13);
    this.ensureSpace(4);
    this.page.drawLine({
      start: { x: MARGIN, y: this.y + 4 }, end: { x: PAGE_WIDTH - MARGIN, y: this.y + 4 },
      thickness: 0.5, color: RULE,
    });
    this.y -= 4;
  }

  paragraph(text: string, options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}): void {
    const size = options.size ?? 10;
    const font = options.bold ? this.bold : this.regular;
    this.drawLines(wrapLines(text, font, size, CONTENT_WIDTH), font, size, options.color ?? INK);
  }

  bullet(text: string, options: { size?: number } = {}): void {
    const size = options.size ?? 10;
    const indent = 14;
    const lines = wrapLines(text, this.regular, size, CONTENT_WIDTH - indent);
    lines.forEach((line, index) => {
      this.ensureSpace(size * 1.35);
      const prefix = index === 0 ? "• " : "  ";
      this.page.drawText(prefix + line, { x: MARGIN, y: this.y - size, size, font: this.regular, color: INK });
      this.y -= size * 1.35;
    });
  }

  emptyState(text: string): void {
    this.paragraph(text, { size: 9.5, color: MUTED });
  }

  spacer(height: number): void {
    this.y -= height;
  }

  async save(): Promise<Uint8Array> {
    return this.doc.save();
  }
}

function participantName(report: MeetingReport, participantId: string): string {
  return report.participants.find((participant) => participant.id === participantId)?.name ?? participantId;
}

export async function generateMeetingReportPdf(report: MeetingReport): Promise<Uint8Array> {
  const w = await ReportPdfWriter.create();

  w.heading(report.title);
  w.paragraph(`Finalized ${report.finalizedAt} · Decision hash ${report.decisionHash}`, { size: 8.5, color: MUTED });
  w.spacer(10);

  w.subheading("Executive Summary");
  w.paragraph(report.executiveSummary);
  w.spacer(6);

  w.subheading("Final Decision");
  w.paragraph(report.finalDecision.title, { bold: true, size: 11 });
  w.paragraph(report.finalDecision.summary);
  w.spacer(4);
  w.paragraph(`Rationale: ${report.rationale}`);
  w.spacer(10);

  w.subheading("Meeting");
  w.paragraph(report.brief);
  w.spacer(4);
  w.paragraph(`Decision policy: ${report.decisionPolicy === "owner_decides" ? "Owner decides" : "Equal-authority consensus"}`, { size: 9 });
  w.spacer(10);

  w.subheading("Participants & Authority");
  if (report.participants.length === 0) w.emptyState("No participants recorded.");
  for (const participant of report.participants) {
    const authority = [
      participant.meetingRole === "owner" ? "Owner" : participant.meetingRole === "cohost" ? "Co-host" : null,
      participant.decisionRole === "decision_maker" ? "Decision maker"
        : participant.decisionRole === "advisor" ? "Advisor"
        : "Contributor",
    ].filter(Boolean).join(", ");
    const kindLabel = participant.kind === "human" ? "" : participant.kind === "expert" ? " (advisory)" : " (simulated)";
    w.bullet(`${participant.name} — ${participant.role}${kindLabel} · ${authority}`);
  }
  w.spacer(10);

  w.subheading("Key Inputs");
  if (report.keyInputs.length === 0) w.emptyState("No inputs recorded.");
  for (const input of report.keyInputs) {
    w.bullet(`${participantName(report, input.participantId)}: ${input.summary}`);
  }
  w.spacer(10);

  w.subheading("Constraints");
  if (report.constraints.length === 0) w.emptyState("No constraints recorded.");
  for (const constraint of report.constraints) {
    w.bullet(`[${constraint.category}] ${constraint.text}`);
  }
  w.spacer(10);

  w.subheading("Proposals Considered");
  if (report.proposalsConsidered.length === 0) w.emptyState("No proposals recorded.");
  for (const proposal of report.proposalsConsidered) {
    const marker = proposal.id === report.proposalsConsidered.find((p) => p.title === report.finalDecision.title)?.id
      ? " (final)" : "";
    w.bullet(`${proposal.title}${marker} — ${proposal.summary}`);
  }
  w.spacer(10);

  w.subheading("Concerns");
  const resolvedIds = new Set(report.resolvedConcerns.map((concern) => concern.id));
  if (report.concernsRaised.length === 0) w.emptyState("No concerns were raised.");
  for (const concern of report.concernsRaised) {
    const status = resolvedIds.has(concern.id) ? "Resolved" : concern.status === "open" ? "Open" : "Resolved";
    w.bullet(`[${concern.severity}, ${status}] ${concern.reason}`);
  }
  w.spacer(10);

  w.subheading("Accepted Trade-offs");
  if (report.acceptedTradeoffs.length === 0) w.emptyState("No trade-offs were needed.");
  for (const tradeoff of report.acceptedTradeoffs) {
    w.bullet(`${tradeoff.description} — ${tradeoff.expectedEffect}`);
  }
  w.spacer(10);

  w.subheading("Alignment");
  if (report.alignment.length === 0) w.emptyState("No alignment was recorded.");
  for (const alignment of report.alignment) {
    const choiceLabel = alignment.choice.replace(/_/g, " ");
    w.bullet(`${participantName(report, alignment.participantId)}: ${choiceLabel}${alignment.comment ? ` — ${alignment.comment}` : ""}`);
  }
  w.spacer(10);

  if (report.dissent.length > 0 || report.unresolvedWarnings.length > 0) {
    w.subheading("Dissent & Warnings");
    for (const note of report.dissent) w.bullet(note);
    for (const warning of report.unresolvedWarnings) w.bullet(`[warning] ${warning.reason}`);
    w.spacer(10);
  }

  if (report.expertAdvice.length > 0) {
    w.subheading("Security Expert Advice");
    for (const advice of report.expertAdvice) {
      w.bullet(`${advice.title} [${advice.status}]${advice.resolutionRationale ? ` — ${advice.resolutionRationale}` : ""}`);
    }
    w.spacer(10);
  }

  if (report.actionItems.length > 0 || report.owners.length > 0 || report.deadlines.length > 0) {
    w.subheading("Action Items, Owners & Deadlines");
    for (const item of report.actionItems) {
      const owner = item.ownerParticipantId ? ` (owner: ${participantName(report, item.ownerParticipantId)})` : "";
      const due = item.dueAt ? `, due ${item.dueAt}` : "";
      w.bullet(`${item.text}${owner}${due}`);
    }
    for (const owner of report.owners) {
      w.bullet(`${participantName(report, owner.participantId)}: ${owner.responsibility}`);
    }
    for (const deadline of report.deadlines) {
      w.bullet(`${deadline.label}: ${deadline.dueAt}`);
    }
    w.spacer(10);
  }

  w.subheading("Approvals");
  w.paragraph(`Required: ${report.requiredApprovalParticipantIds.map((id) => participantName(report, id)).join(", ") || "none"}`, { size: 9.5 });
  for (const approval of report.approvals) {
    w.bullet(`${participantName(report, approval.participantId)} approved at ${approval.approvedAt}`);
  }
  w.spacer(10);

  w.subheading("Full Activity Log");
  w.paragraph(`${report.provenanceSummary.totalEvents} recorded event${report.provenanceSummary.totalEvents === 1 ? "" : "s"}, in order.`, { size: 9.5, color: MUTED });
  w.spacer(4);
  if (report.activityLog.length === 0) w.emptyState("No activity was recorded.");
  for (const entry of report.activityLog) {
    w.bullet(`[v${entry.roomVersion}] ${formatTimestamp(entry.createdAt)} — ${entry.summary}`);
  }
  w.spacer(14);
  w.paragraph(`Decision hash: ${report.decisionHash}`, { size: 8.5, color: MUTED });

  return w.save();
}
