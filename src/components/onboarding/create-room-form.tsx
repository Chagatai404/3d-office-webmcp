"use client";

import { type FormEvent, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ApiRoomOnboardingClient } from "@/clients/api-room-onboarding-client";
import type { RoomOnboardingClient } from "@/clients/room-onboarding-client";
import type {
  CreateRoomInput,
  CreateRoomParticipantInput,
} from "@/contracts/room";
import { stageCreatedRoomForSetup } from "@/components/onboarding/created-room-handoff";
import styles from "@/components/onboarding/onboarding.module.css";

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
    <form className={styles.createForm} onSubmit={handleSubmit} noValidate>
      <fieldset className={styles.formSection} disabled={isBusy}>
        <legend>
          <span>Decision</span>
          What needs to be decided?
        </legend>

        <label className={styles.field}>
          <span>Decision title</span>
          <input
            name="title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Choose our launch approach"
            aria-invalid={Boolean(errors.title)}
            aria-describedby={errors.title ? "title-error" : undefined}
            autoComplete="off"
          />
          {errors.title ? (
            <small id="title-error" className={styles.fieldError}>
              {errors.title}
            </small>
          ) : null}
        </label>

        <label className={styles.field}>
          <span>Brief</span>
          <textarea
            name="brief"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="Give participants the context, constraints, and outcome you need."
            rows={4}
            aria-invalid={Boolean(errors.brief)}
            aria-describedby={errors.brief ? "brief-error" : "brief-help"}
          />
          {errors.brief ? (
            <small id="brief-error" className={styles.fieldError}>
              {errors.brief}
            </small>
          ) : (
            <small id="brief-help">Keep it focused; everyone will see this.</small>
          )}
        </label>
      </fieldset>

      <fieldset className={styles.formSection} disabled={isBusy}>
        <legend>
          <span>Participants</span>
          Who should shape the decision?
        </legend>
        <div className={styles.participantHeading}>
          <p>Start with at least two perspectives.</p>
          <span>{participants.length} seats</span>
        </div>

        {errors.participantCount ? (
          <p className={styles.sectionError} role="alert">
            {errors.participantCount}
          </p>
        ) : null}

        <div className={styles.participantList}>
          {participants.map((participant, index) => {
            const rowError = errors.participantRows?.[index];
            const isOrganizer = index === 0;
            return (
              <div className={styles.participantRow} key={index}>
                <div className={styles.participantRowHeader}>
                  <div>
                    <span className={styles.seatNumber} aria-hidden="true">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <strong>
                      {isOrganizer ? "You / Organizer" : `Participant ${index + 1}`}
                    </strong>
                  </div>
                  <button
                    type="button"
                    className={styles.removeButton}
                    onClick={() => removeParticipant(index)}
                    aria-label={`Remove ${isOrganizer ? "organizer seat" : `participant ${index + 1}`}`}
                  >
                    Remove
                  </button>
                </div>

                {isOrganizer ? (
                  <p className={styles.organizerNote}>
                    Your signed-in session claims this first seat. No identity is
                    sent from this form.
                  </p>
                ) : null}

                <div className={styles.participantFields}>
                  <label className={styles.field}>
                    <span>Name</span>
                    <input
                      name={`participant-${index}-name`}
                      value={participant.name}
                      onChange={(event) =>
                        updateParticipant(index, { name: event.target.value })
                      }
                      placeholder={isOrganizer ? "Your name" : "Participant name"}
                      aria-invalid={Boolean(rowError)}
                      autoComplete="off"
                    />
                  </label>
                  <label className={styles.field}>
                    <span>Role</span>
                    <input
                      name={`participant-${index}-role`}
                      value={participant.role}
                      onChange={(event) =>
                        updateParticipant(index, { role: event.target.value })
                      }
                      placeholder="Role or perspective"
                      aria-invalid={Boolean(rowError)}
                      autoComplete="organization-title"
                    />
                  </label>
                </div>

                <label className={styles.checkboxField}>
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
                  <span>
                    <strong>Required approver</strong>
                    Their approval is needed before the decision can be final.
                  </span>
                </label>
                {rowError ? (
                  <small className={styles.fieldError}>{rowError}</small>
                ) : null}
              </div>
            );
          })}
        </div>

        <button type="button" className={styles.addButton} onClick={addParticipant}>
          <span aria-hidden="true">+</span> Add participant
        </button>
      </fieldset>

      {status === "failure" ? (
        <div className={styles.failureNotice} role="alert">
          <strong>We couldn’t create the room.</strong>
          <span>Check your connection and try again. Your entries are still here.</span>
        </div>
      ) : null}

      {status === "validation-error" && !errors.participantCount ? (
        <p className={styles.validationSummary} role="alert">
          Review the highlighted fields, then try again.
        </p>
      ) : null}

      <div className={styles.formFooter}>
        <p>
          Invitations are generated securely after creation and are not saved in
          browser storage.
        </p>
        <button type="submit" className={styles.submitButton} disabled={isBusy}>
          {status === "submitting"
            ? "Creating room…"
            : status === "navigating"
              ? "Opening setup…"
              : "Create room"}
          {!isBusy ? <span aria-hidden="true">→</span> : null}
        </button>
      </div>
    </form>
  );
}
