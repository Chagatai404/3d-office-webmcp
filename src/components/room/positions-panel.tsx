"use client";

import { useId, useState } from "react";
import type { ActionResult, AddPositionInput } from "@/contracts/room";
import { ActionFeedback } from "./action-feedback";
import { useRoom } from "./room-provider";

/**
 * Positions and their constraints, plus the one mutation this milestone owns.
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

/** Pre-filled with the Engineer's seeded scenario so the demo is one click. */
const INITIAL_DRAFT = {
  summary:
    "Delivery capacity for the next two weeks is limited, so the scope has to fit what one engineer can ship safely.",
  category: "capacity",
  priority: "high",
  constraints: [
    {
      key: "draft-1",
      category: "capacity",
      text: "Implementation capacity is roughly one engineer for two weeks.",
      priority: "high",
    },
    {
      key: "draft-2",
      category: "architecture",
      text: "No authentication rewrite as part of this change.",
      priority: "high",
    },
  ] satisfies ConstraintDraft[],
};

const EMPTY_CONSTRAINT: Omit<ConstraintDraft, "key"> = {
  category: "",
  text: "",
  priority: "",
};

const PRIORITY_OPTIONS = ["high", "medium", "low"];

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function PositionsPanel() {
  const { room, self, actions } = useRoom();
  const fieldId = useId();

  const [summary, setSummary] = useState(INITIAL_DRAFT.summary);
  const [category, setCategory] = useState(INITIAL_DRAFT.category);
  const [priority, setPriority] = useState(INITIAL_DRAFT.priority);
  const [constraints, setConstraints] = useState<ConstraintDraft[]>(
    INITIAL_DRAFT.constraints,
  );
  const [nextKey, setNextKey] = useState(3);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);

  const canSubmit = self !== null && room.phase === "input";

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

    const input: AddPositionInput = {
      summary: summary.trim(),
      category: toNullable(category),
      priority: toNullable(priority),
      constraints: constraints
        .filter((constraint) => constraint.text.trim() !== "")
        .map((constraint) => ({
          category: constraint.category.trim() || "general",
          text: constraint.text.trim(),
          priority: toNullable(constraint.priority),
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
      setConstraints([]);
    }
  }

  return (
    <section className="panel-block" aria-labelledby="positions-heading">
      <h2 className="panel-heading" id="positions-heading">
        Positions &amp; constraints
      </h2>

      {room.positions.length === 0 ? (
        <p className="panel-empty">No positions have been published yet.</p>
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
                {owned.length > 0 ? (
                  <ul className="constraint-list">
                    {owned.map((constraint) => (
                      <li key={constraint.id} className="constraint-item">
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
        <h3 className="panel-subheading">
          {self ? `Publish your position as ${self.role}` : "Publish a position"}
        </h3>

        <label htmlFor={`${fieldId}-summary`}>Position summary</label>
        <textarea
          id={`${fieldId}-summary`}
          name="summary"
          rows={3}
          value={summary}
          required
          onChange={(event) => setSummary(event.target.value)}
        />

        <div className="form-row">
          <div>
            <label htmlFor={`${fieldId}-category`}>Category</label>
            <input
              id={`${fieldId}-category`}
              name="category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
            />
          </div>
          <div>
            <label htmlFor={`${fieldId}-priority`}>Priority</label>
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

        <fieldset className="constraint-fieldset">
          <legend>Constraints published with this position</legend>
          {constraints.length === 0 ? (
            <p className="panel-empty">No constraints attached.</p>
          ) : null}
          {constraints.map((constraint, index) => (
            <div className="constraint-draft" key={constraint.key}>
              <div className="form-row">
                <div>
                  <label htmlFor={`${fieldId}-${constraint.key}-category`}>
                    Constraint {index + 1} category
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
                    Priority
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
                Constraint {index + 1} description
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
                Remove constraint {index + 1}
              </button>
            </div>
          ))}
          <button className="button-quiet" type="button" onClick={addConstraintRow}>
            Add another constraint
          </button>
        </fieldset>

        <button className="button" type="submit" disabled={!canSubmit || pending}>
          {pending ? "Publishing…" : "Publish position to the room"}
        </button>

        {!canSubmit ? (
          <p className="panel-note">
            {self
              ? "Positions are only accepted during the input phase."
              : "Claim a seat to publish a position."}{" "}
            Hidden and disabled controls are a convenience. The server decides
            what is actually permitted.
          </p>
        ) : null}

        <ActionFeedback result={result} />
      </form>
    </section>
  );
}
