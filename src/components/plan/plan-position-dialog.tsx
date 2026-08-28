"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ActionFeedback } from "@/components/room/action-feedback";
import { useRoom } from "@/components/room/room-provider";
import type { ActionResult, AddPositionInput } from "@/contracts/room";
import { IconClose } from "./plan-icons";
import { usePlanSelection } from "./plan-selection";

/**
 * Publishing a position, from the plan.
 *
 * BACKEND CONTRACT:
 * `addMyPosition` carries no participant identity. The server derives the
 * acting participant from the authenticated session and room membership.
 *
 * This component owns draft text and nothing else. It never touches room
 * state: it calls the client and waits for the next snapshot to arrive
 * through the subscription, exactly as the 3D shell's form does.
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

const PRIORITY_OPTIONS = ["high", "medium", "low"];

function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

export function PlanPositionDialog() {
  const { room, self, actions } = useRoom();
  const { positionDialogOpen, closePositionDialog } = usePlanSelection();
  const fieldId = useId();
  const firstField = useRef<HTMLTextAreaElement | null>(null);

  const [summary, setSummary] = useState(INITIAL_DRAFT.summary);
  const [category, setCategory] = useState(INITIAL_DRAFT.category);
  const [priority, setPriority] = useState(INITIAL_DRAFT.priority);
  const [constraints, setConstraints] = useState<ConstraintDraft[]>(
    INITIAL_DRAFT.constraints,
  );
  const [nextKey, setNextKey] = useState(3);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult<unknown> | null>(null);

  useEffect(() => {
    if (!positionDialogOpen) return;
    firstField.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closePositionDialog();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [positionDialogOpen, closePositionDialog]);

  if (!positionDialogOpen) return null;

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
    <div className="plan-modal-layer">
      <button
        type="button"
        className="plan-scrim"
        aria-label="Close"
        onClick={closePositionDialog}
      />
      <div
        className="plan-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${fieldId}-title`}
      >
        <header className="modal-head">
          <div>
            <h2 id={`${fieldId}-title`}>Publish your position</h2>
            <p className="modal-meta">
              {self ? `As ${self.name} · ${self.role}` : "No seat claimed"} · room version{" "}
              {room.version}
            </p>
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={closePositionDialog}
            aria-label="Close dialog"
          >
            <IconClose />
          </button>
        </header>

        <form className="modal-body" onSubmit={handleSubmit}>
          <label htmlFor={`${fieldId}-summary`}>Position summary</label>
          <textarea
            id={`${fieldId}-summary`}
            ref={firstField}
            name="summary"
            rows={3}
            value={summary}
            required
            onChange={(event) => setSummary(event.target.value)}
          />

          <div className="field-row">
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

          <fieldset className="plan-constraint-fieldset">
            <legend>Constraints published with this position</legend>
            {constraints.length === 0 ? (
              <p className="rail-empty">No constraints attached.</p>
            ) : null}

            {constraints.map((constraint, index) => (
              <div className="plan-constraint-draft" key={constraint.key}>
                <div className="field-row">
                  <div>
                    <label htmlFor={`${fieldId}-${constraint.key}-category`}>
                      Constraint {index + 1} category
                    </label>
                    <input
                      id={`${fieldId}-${constraint.key}-category`}
                      value={constraint.category}
                      onChange={(event) =>
                        updateConstraint(constraint.key, "category", event.target.value)
                      }
                    />
                  </div>
                  <div>
                    <label htmlFor={`${fieldId}-${constraint.key}-priority`}>Priority</label>
                    <select
                      id={`${fieldId}-${constraint.key}-priority`}
                      value={constraint.priority}
                      onChange={(event) =>
                        updateConstraint(constraint.key, "priority", event.target.value)
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
                  type="button"
                  className="plan-button-quiet"
                  onClick={() =>
                    setConstraints((current) =>
                      current.filter((item) => item.key !== constraint.key),
                    )
                  }
                >
                  Remove constraint {index + 1}
                </button>
              </div>
            ))}

            <button
              type="button"
              className="plan-button-quiet"
              onClick={() => {
                setConstraints((current) => [
                  ...current,
                  { key: `draft-${nextKey}`, category: "", text: "", priority: "" },
                ]);
                setNextKey((current) => current + 1);
              }}
            >
              Add another constraint
            </button>
          </fieldset>

          <ActionFeedback result={result} />

          <footer className="modal-foot">
            <button type="button" className="plan-button-quiet" onClick={closePositionDialog}>
              Close
            </button>
            <button type="submit" className="button-primary" disabled={!canSubmit || pending}>
              {pending ? "Publishing…" : "Publish position to the room"}
            </button>
          </footer>

          {!canSubmit ? (
            <p className="rail-note">
              {self
                ? "Positions are only accepted during the input phase."
                : "Claim a seat to publish a position."}{" "}
              Hidden and disabled controls are a convenience. The server decides what is
              actually permitted.
            </p>
          ) : null}
        </form>
      </div>
    </div>
  );
}
