"use client";

import { useId, useMemo, useState, useSyncExternalStore } from "react";
import type { ActionResult, AddPositionInput } from "@/contracts/room";
import { ActionFeedback } from "./action-feedback";
import { AgentPromptExamples } from "./agent-prompt-examples";
import { CoordinationStatus } from "./coordination-status";
import { useRoom } from "./room-provider";

/**
 * What each person wants the meeting to know, and the one mutation this
 * workspace owns.
 *
 * The primary surface is deliberately one question and one box. It used to
 * open on a summary field, a category field, a priority select and two
 * pre-filled constraint rows — which is the shape of the `AddPositionInput`
 * DTO, not the shape of a thought. The structured fields still exist, and
 * still submit exactly the same canonical input; they are behind "Add
 * structured detail" so someone who wants them can reach them and a
 * first-time judge never has to.
 *
 * BACKEND CONTRACT:
 * `addMyPosition` carries no participant identity. The server derives the
 * acting participant from the authenticated session and room membership.
 */

interface ConstraintDraft {
  key: string;
  category: string;
  text: string;
  priority: string;
}

const EMPTY_CONSTRAINT: Omit<ConstraintDraft, "key"> = {
  category: "",
  text: "",
  priority: "",
};

const PRIORITY_OPTIONS = ["high", "medium", "low"];

type WebMcpAvailability = "checking" | "available" | "unavailable";

function getWebMcpAvailability(): WebMcpAvailability {
  if (typeof document === "undefined") return "checking";
  return document.modelContext ? "available" : "unavailable";
}

function subscribeToWebMcpAvailability(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener("focus", callback);
  document.addEventListener("visibilitychange", callback);

  return () => {
    window.removeEventListener("focus", callback);
    document.removeEventListener("visibilitychange", callback);
  };
}

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function PositionsPanel() {
  const { room, self, actions } = useRoom();
  const fieldId = useId();
  const webMcpAvailability = useSyncExternalStore(
    subscribeToWebMcpAvailability,
    getWebMcpAvailability,
    () => "checking",
  );

  const [summary, setSummary] = useState("");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [citedSourceIds, setCitedSourceIds] = useState<string[]>([]);
  const [constraints, setConstraints] = useState<ConstraintDraft[]>([]);
  const [nextKey, setNextKey] = useState(1);
  const [pending, setPending] = useState(false);
  const [readyPending, setReadyPending] = useState(false);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);
  const [readyResult, setReadyResult] = useState<ActionResult<unknown> | null>(
    null,
  );

  const canSubmit = self !== null && room.phase === "input";
  const selfPositionCount = useMemo(() => {
    if (!self) return 0;
    return room.positions.filter((position) => position.participantId === self.id)
      .length;
  }, [room.positions, self]);
  const hasPublishedPosition = selfPositionCount > 0;
  const citableSources = useMemo(
    () => room.sources.filter((source) => source.status === "ready"),
    [room.sources],
  );
  const isReadyForDeliberation = self?.isReady ?? false;
  const canMarkReady =
    self !== null &&
    room.phase === "input" &&
    hasPublishedPosition &&
    !isReadyForDeliberation;
  const readyDisabledReason = self
    ? room.phase !== "input"
      ? "The meeting is past the point where readiness is collected."
      : !hasPublishedPosition
        ? "Share something with the meeting before marking your input ready."
        : isReadyForDeliberation
          ? "The room already shows you as ready."
          : null
    : "Claim a seat before marking your input ready.";

  function updateConstraint(
    key: string,
    field: keyof Omit<ConstraintDraft, "key">,
    value: string,
  ) {
    setConstraints((current) =>
      current.map((constraint) =>
        constraint.key === key ? { ...constraint, [field]: value } : constraint,
      ),
    );
  }

  function addConstraintRow() {
    setConstraints((current) => [
      ...current,
      { key: `draft-${nextKey}`, ...EMPTY_CONSTRAINT },
    ]);
    setNextKey((current) => current + 1);
  }

  function removeConstraintRow(key: string) {
    setConstraints((current) =>
      current.filter((constraint) => constraint.key !== key),
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const citedThatStillExist = citedSourceIds.filter((id) =>
      citableSources.some((source) => source.id === id),
    );
    const input: AddPositionInput = {
      summary: summary.trim(),
      category: toNullable(category),
      priority: toNullable(priority),
      ...(citedThatStillExist.length > 0
        ? { referencedSourceIds: citedThatStillExist }
        : {}),
      constraints: constraints
        .filter((constraint) => constraint.text.trim() !== "")
        .map((constraint) => ({
          category: constraint.category.trim() || "general",
          text: constraint.text.trim(),
          priority: toNullable(constraint.priority),
          ...(citedThatStillExist.length > 0
            ? { referencedSourceIds: citedThatStillExist }
            : {}),
        })),
    };

    setPending(true);
    // The component never mutates room state. It calls the client and waits
    // for the next snapshot to arrive through the subscription.
    const actionResult = await actions.addMyPosition(input);
    setPending(false);
    setResult(actionResult);

    if (actionResult.ok) {
      setSummary("");
      setCategory("");
      setPriority("");
      setCitedSourceIds([]);
      setConstraints([]);
    }
  }

  async function handleReadyClick() {
    if (readyPending || !canMarkReady) return;

    setReadyPending(true);
    const actionResult = await actions.markMyInputReady();
    setReadyPending(false);
    setReadyResult(actionResult);
  }

  return (
    <section className="panel-block" aria-labelledby="positions-heading">
      <h2 className="panel-heading" id="positions-heading">
        What the team has shared
      </h2>

      {room.positions.length === 0 ? (
        <p className="panel-empty">Nobody has shared anything with the meeting yet.</p>
      ) : (
        <ul className="position-list">
          {room.positions.map((position) => {
            const owner = room.participants.find(
              (participant) => participant.id === position.participantId,
            );
            const owned = room.constraints.filter(
              (constraint) => constraint.participantId === position.participantId,
            );

            return (
              <li key={position.id} className="position-item">
                <p className="position-owner">
                  {owner?.name ?? "Unknown participant"}
                  <span className="position-owner-role">
                    {owner?.role ?? "Unassigned"}
                  </span>
                  {position.category ? (
                    <span className="tag">{position.category}</span>
                  ) : null}
                  {position.priority ? (
                    <span className="tag">{position.priority} priority</span>
                  ) : null}
                </p>
                <p className="position-summary">{position.summary}</p>
                {position.referencedSourceIds.length > 0 ? (
                  <p className="position-sources">
                    From:{" "}
                    {position.referencedSourceIds
                      .map(
                        (id) =>
                          room.sources.find((source) => source.id === id)?.title ??
                          "a removed source",
                      )
                      .join(", ")}
                  </p>
                ) : null}
                {owned.length > 0 ? (
                  <ul className="constraint-list">
                    {owned.map((constraint) => (
                      <li
                        key={constraint.id}
                        className="constraint-item"
                        /* Named so pressing this constraint on the wall board
                           opens the workspace at this row. */
                        data-board-item={constraint.id}
                      >
                        <span className="constraint-category">
                          {constraint.category}
                        </span>
                        <span>{constraint.text}</span>
                        {constraint.priority ? (
                          <span className="tag tag-muted">
                            {constraint.priority}
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <form className="position-form" onSubmit={handleSubmit}>
        <h3 className="panel-subheading input-question">
          What should the team know from you?
        </h3>

        <div className="agent-guide" aria-labelledby="agent-guide-heading">
          <div className="agent-guide-status">
            <span className="agent-guide-mark" aria-hidden="true">
              ◆
            </span>
            <div>
              <h4 id="agent-guide-heading">
                {webMcpAvailability === "available"
                  ? "Browser agent tools available for this phase"
                  : webMcpAvailability === "unavailable"
                    ? "WebMCP is unavailable in this browser. You can still participate manually."
                    : "Checking browser agent tools for this phase"}
              </h4>
              <p>
                {self
                  ? `Anything your agent does here is recorded as ${self.name}, and only as ${self.name}.`
                  : "Claim a seat before asking a browser agent to act for you."}
              </p>
            </div>
          </div>
          <AgentPromptExamples compact />
        </div>

        <label className="visually-hidden" htmlFor={`${fieldId}-summary`}>
          What should the team know from you?
        </label>
        <textarea
          id={`${fieldId}-summary`}
          name="summary"
          className="input-primary-field"
          rows={4}
          value={summary}
          required
          placeholder="In your own words — what matters to you about this decision, and what you can and cannot live with."
          onChange={(event) => setSummary(event.target.value)}
        />

        <button className="button" type="submit" disabled={!canSubmit || pending}>
          {pending ? "Sharing…" : "Share with meeting"}
        </button>

        {/* The structured shape the domain actually stores. Kept, because a
            person filling this in by hand deserves the same expressiveness an
            agent has — but never the first thing anyone sees. */}
        <details className="advanced-fields">
          <summary>Add structured detail (optional)</summary>

          <div className="advanced-fields-body">
            <p className="panel-note">
              Only if it helps. Everything below is optional, and the room reads your words above
              either way.
            </p>

            <div className="form-row">
              <div>
                <label htmlFor={`${fieldId}-category`}>Topic</label>
                <input
                  id={`${fieldId}-category`}
                  name="category"
                  value={category}
                  placeholder="capacity, timing, security…"
                  onChange={(event) => setCategory(event.target.value)}
                />
              </div>
              <div>
                <label htmlFor={`${fieldId}-priority`}>How strongly you hold it</label>
                <select
                  id={`${fieldId}-priority`}
                  name="priority"
                  value={priority}
                  onChange={(event) => setPriority(event.target.value)}
                >
                  <option value="">Unset</option>
                  {PRIORITY_OPTIONS.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {citableSources.length > 0 ? (
              <fieldset className="constraint-fieldset">
                <legend>Sources that informed this</legend>
                <p className="panel-note">
                  Link the attached files this came from. Recorded as provenance
                  only — it never gives a file a say in the decision.
                </p>
                {citableSources.map((source) => {
                  const checked = citedSourceIds.includes(source.id);
                  return (
                    <label key={source.id} className="source-cite-option">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) =>
                          setCitedSourceIds((current) =>
                            event.target.checked
                              ? [...current, source.id]
                              : current.filter((id) => id !== source.id),
                          )
                        }
                      />
                      <span>{source.title}</span>
                    </label>
                  );
                })}
              </fieldset>
            ) : null}

            <fieldset className="constraint-fieldset">
              <legend>Hard limits the room must respect</legend>
              {constraints.length === 0 ? (
                <p className="panel-empty">None attached.</p>
              ) : null}
              {constraints.map((constraint, index) => (
                <div className="constraint-draft" key={constraint.key}>
                  <div className="form-row">
                    <div>
                      <label htmlFor={`${fieldId}-${constraint.key}-category`}>
                        Limit {index + 1} topic
                      </label>
                      <input
                        id={`${fieldId}-${constraint.key}-category`}
                        value={constraint.category}
                        onChange={(event) =>
                          updateConstraint(
                            constraint.key,
                            "category",
                            event.target.value,
                          )
                        }
                      />
                    </div>
                    <div>
                      <label htmlFor={`${fieldId}-${constraint.key}-priority`}>
                        How strongly
                      </label>
                      <select
                        id={`${fieldId}-${constraint.key}-priority`}
                        value={constraint.priority}
                        onChange={(event) =>
                          updateConstraint(
                            constraint.key,
                            "priority",
                            event.target.value,
                          )
                        }
                      >
                        <option value="">Unset</option>
                        {PRIORITY_OPTIONS.map((option) => (
                          <option key={option} value={option}>
                            {option}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <label htmlFor={`${fieldId}-${constraint.key}-text`}>
                    Limit {index + 1}
                  </label>
                  <input
                    id={`${fieldId}-${constraint.key}-text`}
                    value={constraint.text}
                    onChange={(event) =>
                      updateConstraint(constraint.key, "text", event.target.value)
                    }
                  />
                  <button
                    className="button-quiet"
                    type="button"
                    onClick={() => removeConstraintRow(constraint.key)}
                  >
                    Remove limit {index + 1}
                  </button>
                </div>
              ))}
              <button className="button-quiet" type="button" onClick={addConstraintRow}>
                Add a hard limit
              </button>
            </fieldset>
          </div>
        </details>

        {!canSubmit ? (
          <p className="panel-note">
            {self
              ? "The meeting is past the point where new input is collected."
              : "Claim a seat to share something with the meeting."}{" "}
            Hidden and disabled controls are a convenience. The server decides
            what is actually permitted.
          </p>
        ) : null}

        <ActionFeedback result={result} />
      </form>

      <div className="ready-box" aria-labelledby="ready-heading">
        <h3 className="panel-subheading" id="ready-heading">
          Where the room is
        </h3>

        <CoordinationStatus />

        {isReadyForDeliberation ? (
          <p className="ready-state" role="status">
            ✓ Ready for deliberation
          </p>
        ) : (
          <>
            <button
              className="button ready-action"
              type="button"
              disabled={!canMarkReady || readyPending}
              onClick={handleReadyClick}
            >
              {readyPending ? "Marking ready…" : "My input is ready"}
            </button>

            {readyDisabledReason ? (
              <p className="panel-note">{readyDisabledReason}</p>
            ) : null}
          </>
        )}

        <ActionFeedback result={readyResult} />
      </div>
    </section>
  );
}
