"use client";

import { type FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ApiRoomOnboardingClient } from "@/clients/api-room-onboarding-client";
import type { RoomOnboardingClient } from "@/clients/room-onboarding-client";
import type {
  CreateRoomInput,
  CreateRoomParticipantInput,
} from "@/contracts/room";
import { stageCreatedRoomForSetup } from "@/components/onboarding/created-room-handoff";

const DEFAULT_ROLES = [
  "Product Manager",
  "Engineer",
  "Designer",
  "Marketing Lead",
] as const;

type FormStatus =
  | "idle"
  | "validation-error"
  | "submitting"
  | "failure"
  | "navigating";

type FormErrors = {
  title?: string;
  brief?: string;
  participantCount?: string;
  participantRows?: Record<number, string>;
};

type CreateRoomFormProps = {
  client?: RoomOnboardingClient;
};

function createDefaultParticipants(): CreateRoomParticipantInput[] {
  return DEFAULT_ROLES.map((role) => ({
    name: "",
    role,
    requiredForApproval: false,
  }));
}

function initials(name: string, fallback: string): string {
  const trimmed = name.trim();
  return (trimmed ? trimmed.slice(0, 2) : fallback).toUpperCase();
}

function validate(
  title: string,
  brief: string,
  participants: CreateRoomParticipantInput[],
): FormErrors {
  const errors: FormErrors = {};
  const participantRows: Record<number, string> = {};

  if (!title.trim()) errors.title = "Enter a decision title.";
  if (!brief.trim()) errors.brief = "Add a short brief for participants.";
  if (participants.length < 2) {
    errors.participantCount = "Add at least two participants, including you.";
  }

  participants.forEach((participant, index) => {
    if (!participant.name.trim() || !participant.role.trim()) {
      participantRows[index] = "Enter both a name and role.";
    }
  });

  if (Object.keys(participantRows).length > 0) {
    errors.participantRows = participantRows;
  }

  return errors;
}

function hasErrors(errors: FormErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function CreateRoomForm({ client: suppliedClient }: CreateRoomFormProps) {
  const router = useRouter();
  const [client] = useState<RoomOnboardingClient>(
    () => suppliedClient ?? new ApiRoomOnboardingClient(),
  );
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [participants, setParticipants] = useState(createDefaultParticipants);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<FormStatus>("idle");
  const submissionInFlight = useRef(false);

  const isBusy = status === "submitting" || status === "navigating";

  function updateParticipant(
    index: number,
    patch: Partial<CreateRoomParticipantInput>,
  ) {
    setParticipants((current) =>
      current.map((participant, participantIndex) =>
        participantIndex === index ? { ...participant, ...patch } : participant,
      ),
    );
  }

  function removeParticipant(index: number) {
    setParticipants((current) =>
      current.filter((_, participantIndex) => participantIndex !== index),
    );
  }

  function addParticipant() {
    setParticipants((current) => [
      ...current,
      {
        name: "",
        role: DEFAULT_ROLES[current.length % DEFAULT_ROLES.length] ?? "Participant",
        requiredForApproval: false,
      },
    ]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy || submissionInFlight.current) return;

    const nextErrors = validate(title, brief, participants);
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) {
      setStatus("validation-error");
      return;
    }

    const input: CreateRoomInput = {
      title: title.trim(),
      brief: brief.trim(),
      participants: participants.map((participant) => ({
        name: participant.name.trim(),
        role: participant.role.trim(),
        requiredForApproval: participant.requiredForApproval,
      })),
    };

    submissionInFlight.current = true;
    setStatus("submitting");
    try {
      const createdRoom = await client.createRoom(input);
      stageCreatedRoomForSetup(createdRoom, input);
      setStatus("navigating");
      router.push(`/room/${encodeURIComponent(createdRoom.roomId)}/setup`);
    } catch {
      submissionInFlight.current = false;
      setStatus("failure");
    }
  }

  return (
    <form className="flow-card" onSubmit={handleSubmit} noValidate>
      <h1 className="flow-card-title">Set the question this room decides.</h1>
      <p className="flow-card-lede">
        You take the first seat as organizer. Every other seat is claimed by
        whoever opens its private link.
      </p>

      <fieldset className="flow-fieldset" disabled={isBusy}>
        <legend className="visually-hidden">The question</legend>

        <label className="flow-field">
          <span>Decision title</span>
          <input
            className="flow-input flow-input-title"
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Choose our launch approach"
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? "title-error" : undefined}
            autoComplete="off"
          />
          {errors.title ? (
            <small id="title-error" className="flow-field-error">
              {errors.title}
            </small>
          ) : (
            <span className="flow-field-hint">
              One question per room. If it splits in two, open a second room.
            </span>
          )}
        </label>

        <label className="flow-field">
          <span>Short brief</span>
          <textarea
            className="flow-textarea"
            name="brief"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="Give participants the context, constraints, and outcome you need."
            rows={3}
            aria-invalid={Boolean(errors.brief)}
            aria-describedby={errors.brief ? "brief-error" : "brief-help"}
          />
          {errors.brief ? (
            <small id="brief-error" className="flow-field-error">
              {errors.brief}
            </small>
          ) : (
            <span id="brief-help" className="flow-field-hint">
              Keep it focused; everyone will see this.
            </span>
          )}
        </label>
      </fieldset>

      <fieldset className="flow-fieldset" disabled={isBusy}>
        <legend>
          <span>Seats at the table</span>
          <span>{participants.length} seats</span>
        </legend>

        {errors.participantCount ? (
          <p className="flow-field-error" role="alert">
            {errors.participantCount}
          </p>
        ) : null}

        <div className="flow-seat-list">
          {participants.map((participant, index) => {
            const rowError = errors.participantRows?.[index];
            const isOrganizer = index === 0;
            const seatName = isOrganizer
              ? "your seat"
              : `participant ${index + 1}`;

            return (
              <div
                className={
                  isOrganizer
                    ? "flow-seat-row flow-seat-row-self"
                    : "flow-seat-row"
                }
                key={index}
              >
                <span
                  aria-hidden="true"
                  className={
                    isOrganizer
                      ? "flow-seat-avatar flow-seat-avatar-self"
                      : "flow-seat-avatar"
                  }
                >
                  {initials(participant.name, isOrganizer ? "YOU" : `S${index + 1}`)}
                </span>

                <div className="flow-seat-fields">
                  <input
                    className="flow-input"
                    name={`participant-${index}-name`}
                    value={participant.name}
                    onChange={(event) =>
                      updateParticipant(index, { name: event.target.value })
                    }
                    placeholder={isOrganizer ? "Your name" : "Participant name"}
                    aria-label={
                      isOrganizer ? "Your name" : `Participant ${index + 1} name`
                    }
                    aria-invalid={Boolean(rowError)}
                    autoComplete="off"
                  />
                  <select
                    className="flow-select"
                    name={`participant-${index}-role`}
                    value={participant.role}
                    onChange={(event) =>
                      updateParticipant(index, { role: event.target.value })
                    }
                    aria-label={`Role for ${seatName}`}
                  >
                    {DEFAULT_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                    {DEFAULT_ROLES.includes(
                      participant.role as (typeof DEFAULT_ROLES)[number],
                    ) ? null : (
                      <option value={participant.role}>{participant.role}</option>
                    )}
                  </select>
                </div>

                <div className="flow-seat-meta">
                  <span
                    className={
                      isOrganizer
                        ? "flow-seat-sub flow-seat-self-sub"
                        : "flow-seat-sub"
                    }
                  >
                    {isOrganizer
                      ? "You · Organizer"
                      : "Open seat · claimed from the link"}
                  </span>
                  <label className="flow-seat-check">
                    <input
                      type="checkbox"
                      name={`participant-${index}-required`}
                      checked={participant.requiredForApproval}
                      onChange={(event) =>
                        updateParticipant(index, {
                          requiredForApproval: event.target.checked,
                        })
                      }
                    />
                    <span>Required approver</span>
                  </label>
                  <button
                    type="button"
                    className="flow-seat-remove"
                    onClick={() => removeParticipant(index)}
                    aria-label={`Remove ${
                      isOrganizer ? "organizer seat" : `participant ${index + 1}`
                    }`}
                  >
                    Remove
                  </button>
                </div>

                {rowError ? (
                  <small className="flow-seat-error flow-field-error">{rowError}</small>
                ) : null}
              </div>
            );
          })}
        </div>

        {participants[0] ? (
          <p className="flow-note">
            Your authenticated session claims the first seat. No identity is sent
            from this form.
          </p>
        ) : null}

        <button type="button" className="flow-add-seat" onClick={addParticipant}>
          <span aria-hidden="true">+</span> Add a seat
        </button>
      </fieldset>

      {status === "failure" ? (
        <div className="flow-alert" role="alert">
          <strong>We couldn’t create the room.</strong>
          <span>Check your connection and try again. Your entries are still here.</span>
        </div>
      ) : null}

      {status === "validation-error" && !errors.participantCount ? (
        <p className="flow-alert" role="alert">
          Review the highlighted fields, then try again.
        </p>
      ) : null}

      <div className="flow-form-actions">
        <button type="submit" className="flow-btn flow-btn-primary" disabled={isBusy}>
          {status === "submitting"
            ? "Creating meeting…"
            : status === "navigating"
              ? "Opening the lobby…"
              : "Create meeting"}
        </button>
        <Link className="flow-btn flow-btn-ghost" href="/">
          Cancel
        </Link>
      </div>

      <div className="flow-form-footer">
        <p>
          Invitations are generated securely after creation and are not saved in
          browser storage.
        </p>
      </div>
    </form>
  );
}
