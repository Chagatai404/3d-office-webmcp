"use client";

import { type FormEvent, useRef, useState } from "react";
import Link from "next/link";
import { ApiRoomOnboardingClient } from "@/clients/api-room-onboarding-client";
import type { RoomOnboardingClient } from "@/clients/room-onboarding-client";
import type { CreateRoomInput, CreatedRoom } from "@/contracts/room";

const CREATOR_ROLES = [
  "Founder",
  "Product Manager",
  "Engineer",
  "Designer",
  "Marketing",
] as const;

type FormStatus =
  | "idle"
  | "validation-error"
  | "submitting"
  | "failure"
  | "navigating";

type FormErrors = Partial<
  Record<"title" | "brief" | "creatorName" | "creatorRole", string>
>;

type CreateRoomFormProps = { client?: RoomOnboardingClient };

function validate(
  title: string,
  brief: string,
  creatorName: string,
  creatorRole: string,
): FormErrors {
  const errors: FormErrors = {};
  if (!title.trim()) errors.title = "Enter a decision title.";
  if (!brief.trim()) errors.brief = "Add a short meeting brief.";
  if (!creatorName.trim()) errors.creatorName = "Enter your display name.";
  if (!creatorRole.trim()) errors.creatorRole = "Enter your job or team role.";
  return errors;
}

export function CreateRoomForm({ client: suppliedClient }: CreateRoomFormProps) {
  const [client] = useState<RoomOnboardingClient>(
    () => suppliedClient ?? new ApiRoomOnboardingClient(),
  );
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [creatorName, setCreatorName] = useState("");
  const [creatorRole, setCreatorRole] = useState<string>(CREATOR_ROLES[0]);
  const [errors, setErrors] = useState<FormErrors>({});
  const [status, setStatus] = useState<FormStatus>("idle");
  const [createdRoom, setCreatedRoom] = useState<CreatedRoom | null>(null);
  const submissionInFlight = useRef(false);
  const isBusy = status === "submitting" || status === "navigating";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBusy || submissionInFlight.current) return;

    const nextErrors = validate(title, brief, creatorName, creatorRole);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      setStatus("validation-error");
      return;
    }

    const input: CreateRoomInput = {
      title: title.trim(),
      brief: brief.trim(),
      creatorName: creatorName.trim(),
      creatorRole: creatorRole.trim(),
    };

    submissionInFlight.current = true;
    setStatus("submitting");
    try {
      const createdRoom = await client.createRoom(input);
      setCreatedRoom(createdRoom);
      setStatus("navigating");
    } catch {
      submissionInFlight.current = false;
      setStatus("failure");
    }
  }

  if (createdRoom) {
    return (
      <section className="flow-card" aria-labelledby="access-title">
        <p className="flow-eyebrow">Meeting created</p>
        <h1 className="flow-card-title" id="access-title">Share access, then enter.</h1>
        <p className="flow-card-lede">The passcode is shown only now. Save it before leaving this page.</p>
        <dl>
          <div><dt>Room ID</dt><dd><code>{createdRoom.roomId}</code></dd></div>
          <div><dt>Passcode</dt><dd><code>{createdRoom.passcode}</code></dd></div>
          <div><dt>Generic invite link</dt><dd><input aria-label="Generic invite link" readOnly value={createdRoom.inviteUrl} /></dd></div>
        </dl>
        <div className="flow-form-actions">
          <button type="button" className="flow-btn flow-btn-ghost" onClick={() => void navigator.clipboard.writeText(`${createdRoom.inviteUrl}\nRoom ID: ${createdRoom.roomId}\nPasscode: ${createdRoom.passcode}`)}>Copy invite</button>
          <Link className="flow-btn flow-btn-primary" href={`/room/${encodeURIComponent(createdRoom.roomId)}`}>Enter meeting</Link>
        </div>
      </section>
    );
  }

  return (
    <form className="flow-card" onSubmit={handleSubmit} noValidate>
      <h1 className="flow-card-title">Set the question this room decides.</h1>
      <p className="flow-card-lede">
        Create the meeting as its owner. You’ll receive a reusable invite and
        one-time passcode display next.
      </p>

      <fieldset className="flow-fieldset" disabled={isBusy}>
        <legend className="visually-hidden">Meeting details</legend>
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
            <small id="title-error" className="flow-field-error">{errors.title}</small>
          ) : (
            <span className="flow-field-hint">One focused decision per room.</span>
          )}
        </label>

        <label className="flow-field">
          <span>Short brief</span>
          <textarea
            className="flow-textarea"
            name="brief"
            value={brief}
            onChange={(event) => setBrief(event.target.value)}
            placeholder="Add the context, constraints, and outcome you need."
            rows={3}
            aria-invalid={Boolean(errors.brief)}
            aria-describedby={errors.brief ? "brief-error" : "brief-help"}
          />
          {errors.brief ? (
            <small id="brief-error" className="flow-field-error">{errors.brief}</small>
          ) : (
            <span id="brief-help" className="flow-field-hint">Keep it focused and concrete.</span>
          )}
        </label>
      </fieldset>

      <fieldset className="flow-fieldset" disabled={isBusy}>
        <legend>
          <span>Meeting owner</span>
          <span>Decision maker</span>
        </legend>
        <label className="flow-field">
          <span>Your name</span>
          <input
            className="flow-input"
            name="creatorName"
            value={creatorName}
            onChange={(event) => setCreatorName(event.target.value)}
            placeholder="Your display name"
            aria-invalid={Boolean(errors.creatorName)}
            aria-describedby={errors.creatorName ? "creator-name-error" : undefined}
            autoComplete="name"
          />
          {errors.creatorName ? (
            <small id="creator-name-error" className="flow-field-error">{errors.creatorName}</small>
          ) : null}
        </label>

        <label className="flow-field">
          <span>Your role</span>
          <select
            className="flow-select"
            name="creatorRole"
            value={creatorRole}
            onChange={(event) => setCreatorRole(event.target.value)}
            aria-invalid={Boolean(errors.creatorRole)}
          >
            {CREATOR_ROLES.map((role) => <option key={role}>{role}</option>)}
          </select>
          {errors.creatorRole ? (
            <small className="flow-field-error">{errors.creatorRole}</small>
          ) : (
            <span className="flow-field-hint">
              This label describes your work; owner authority is assigned on the server.
            </span>
          )}
        </label>
      </fieldset>

      {status === "failure" ? (
        <div className="flow-alert" role="alert">
          <strong>We couldn’t create the room.</strong>
          <span>Check your connection and try again. Your entries are still here.</span>
        </div>
      ) : null}
      {status === "validation-error" ? (
        <p className="flow-alert" role="alert">Review the highlighted fields, then try again.</p>
      ) : null}

      <div className="flow-form-actions">
        <button type="submit" className="flow-btn flow-btn-primary" disabled={isBusy}>
          {status === "submitting"
            ? "Creating meeting…"
            : status === "navigating"
              ? "Opening meeting…"
              : "Create meeting"}
        </button>
        <Link className="flow-btn flow-btn-ghost" href="/">Cancel</Link>
      </div>

      <div className="flow-form-footer">
        <p>The authenticated creator enters immediately as the room’s sole owner.</p>
      </div>
    </form>
  );
}
