# Hackathon Demo / Submission Notes

This is the concise project-level checklist for the OpenAI WebMCP Challenge.
The canonical product and architecture decisions live in
[`../3d-office-webmcp-shared-context.md`](../3d-office-webmcp-shared-context.md).

## What the demo must prove

The submission should make the WebMCP-specific value visible rather than merely
showing a multi-user room.

A judge should see that:

1. each human participant has a separate browser/session identity;
2. that participant's browser agent discovers phase-appropriate WebMCP tools;
3. agent tool calls produce visible structured room-state changes;
4. one participant cannot act for another participant;
5. objections and trade-offs are first-class state, not buried in chat text;
6. voting is participant-scoped;
7. final approval requires explicit review of the exact decision;
8. the final record preserves provenance and dissent.

## Three-minute story

Suggested sequence:

- **0:00–0:20** — explain the collective-authority problem;
- **0:20–0:40** — show the clean meeting room and separate participant identities;
- **0:40–1:05** — publish constraints through WebMCP;
- **1:05–1:30** — submit a proposal and reveal a blocking issue;
- **1:30–1:55** — move to the Issues workspace and negotiate a trade-off;
- **1:55–2:15** — optionally show one advisory expert concern;
- **2:15–2:35** — vote within participant authority;
- **2:35–2:50** — move to Decision and explicitly approve the exact plan;
- **2:50–3:00** — show the immutable decision record / provenance.

Use camera transitions to make the meeting artifacts easy to follow. Avoid
opening several panels simultaneously during the demo.

## Internal submission checklist

- [ ] public deployment;
- [ ] public repository;
- [ ] license;
- [ ] concise README;
- [ ] architecture / WebMCP explanation;
- [ ] screenshots that show the meeting room and focused workspaces;
- [ ] under-three-minute demo video;
- [ ] deterministic `/room/demo` path;
- [ ] at least one multi-browser proof outside solo-judge simulation;
- [ ] final `npm run check`, build, domain tests, and E2E run.

## Claims to make carefully

Safe claims:

- browser agents call WebMCP tools in the participant's browser context;
- shared server state coordinates collaboration;
- tool availability changes with the room phase;
- server authorization enforces participant boundaries;
- expert actors are advisory;
- final approval is recorded independently per required human.

Avoid claiming:

- WebMCP itself provides direct agent-to-agent networking;
- simulated participants are real independent browser agents;
- expert server actors are browser WebMCP clients;
- voting is equivalent to final human approval.
