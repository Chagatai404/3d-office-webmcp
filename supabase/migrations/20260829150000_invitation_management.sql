-- P1 invite management: organizer-only regeneration and revocation for
-- unclaimed seats. Raw tokens are returned only from regeneration and are never
-- stored, audited or exposed through RoomState.

create or replace function public.regenerate_room_invitation(
  p_room_id text,
  p_expected_version bigint,
  p_participant_id text,
  p_origin public.action_origin
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_version bigint;
  current_phase public.room_phase;
  organizer_id uuid;
  organizer_participant_id text;
  seat_role text;
  seat_user_id uuid;
  seat_kind public.participant_kind;
  existing_invitation public.room_invitations%rowtype;
  raw_token text;
  attempt int;
begin
  if caller_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'An authenticated session is required.', 0);
  end if;

  select version, phase, organizer_user_id
  into current_version, current_phase, organizer_id
  from public.rooms where id = p_room_id for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0);
  end if;

  if organizer_id is null or organizer_id <> caller_id then
    return public.action_failure(
      'NOT_AUTHORIZED',
      'Only the room organizer can manage invitations.',
      current_version
    );
  end if;
  if current_version <> p_expected_version then
    return public.action_failure(
      'STALE_ROOM_STATE',
      'The room changed before this action completed.',
      current_version,
      'Review the latest room state and retry if invitation management is still appropriate.'
    );
  end if;
  if current_phase = 'finalized' then
    return public.action_failure(
      'ALREADY_FINALIZED',
      'The finalized decision is immutable.',
      current_version
    );
  end if;
  if current_phase <> 'input' then
    return public.action_failure(
      'WRONG_PHASE',
      'Invitations can only be managed while the room is gathering input.',
      current_version
    );
  end if;

  select role, user_id, kind
  into seat_role, seat_user_id, seat_kind
  from public.participants
  where room_id = p_room_id and id = p_participant_id
  for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'Participant not found in this room.', current_version);
  end if;
  if seat_kind <> 'human' then
    return public.action_failure('NOT_AUTHORIZED', 'Simulation seats do not have invitations.', current_version);
  end if;
  if seat_user_id is not null then
    return public.action_failure(
      'NOT_AUTHORIZED',
      'A claimed seat does not have a reusable invitation.',
      current_version
    );
  end if;

  select * into existing_invitation
  from public.room_invitations
  where room_id = p_room_id and participant_id = p_participant_id
  for update;
  if found and existing_invitation.claimed_at is not null then
    return public.action_failure(
      'NOT_AUTHORIZED',
      'A claimed invitation cannot be regenerated.',
      current_version
    );
  end if;

  for attempt in 1..8 loop
    begin
      raw_token := public.generate_invite_token();
      insert into public.room_invitations (
        room_id,
        participant_id,
        token_hash,
        created_by_user_id,
        expires_at,
        claimed_at,
        revoked_at
      ) values (
        p_room_id,
        p_participant_id,
        public.hash_invite_token(raw_token),
        caller_id,
        now() + interval '7 days',
        null,
        null
      )
      on conflict (room_id, participant_id) do update
      set token_hash = excluded.token_hash,
          created_by_user_id = excluded.created_by_user_id,
          expires_at = excluded.expires_at,
          claimed_at = null,
          revoked_at = null,
          created_at = now();
      exit;
    exception when unique_violation then
      raw_token := null;
    end;
  end loop;
  if raw_token is null then
    return public.action_failure('VALIDATION_ERROR', 'Could not allocate an invitation token; retry.', current_version);
  end if;

  update public.rooms set version = current_version + 1 where id = p_room_id;

  select id into organizer_participant_id
  from public.participants
  where room_id = p_room_id and user_id = caller_id and kind = 'human'
  order by seat_order asc
  limit 1;

  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', organizer_participant_id, p_origin,
    'invitation.regenerated', 'participant', p_participant_id,
    jsonb_build_object('participantId', p_participant_id),
    jsonb_build_object('ok', true),
    current_version, current_version + 1, false
  );

  return public.action_success_data(
    'Invitation regenerated.',
    current_version + 1,
    jsonb_build_object(
      'participantId', p_participant_id,
      'role', seat_role,
      'inviteToken', raw_token
    )
  );
end;
$$;

create or replace function public.revoke_room_invitation(
  p_room_id text,
  p_expected_version bigint,
  p_participant_id text,
  p_origin public.action_origin
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  current_version bigint;
  current_phase public.room_phase;
  organizer_id uuid;
  organizer_participant_id text;
  seat_user_id uuid;
  seat_kind public.participant_kind;
  invitation public.room_invitations%rowtype;
begin
  if caller_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'An authenticated session is required.', 0);
  end if;

  select version, phase, organizer_user_id
  into current_version, current_phase, organizer_id
  from public.rooms where id = p_room_id for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0);
  end if;

  if organizer_id is null or organizer_id <> caller_id then
    return public.action_failure(
      'NOT_AUTHORIZED',
      'Only the room organizer can manage invitations.',
      current_version
    );
  end if;
  if current_version <> p_expected_version then
    return public.action_failure(
      'STALE_ROOM_STATE',
      'The room changed before this action completed.',
      current_version,
      'Review the latest room state and retry if invitation management is still appropriate.'
    );
  end if;
  if current_phase = 'finalized' then
    return public.action_failure(
      'ALREADY_FINALIZED',
      'The finalized decision is immutable.',
      current_version
    );
  end if;
  if current_phase <> 'input' then
    return public.action_failure(
      'WRONG_PHASE',
      'Invitations can only be managed while the room is gathering input.',
      current_version
    );
  end if;

  select user_id, kind
  into seat_user_id, seat_kind
  from public.participants
  where room_id = p_room_id and id = p_participant_id
  for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'Participant not found in this room.', current_version);
  end if;
  if seat_kind <> 'human' then
    return public.action_failure('NOT_AUTHORIZED', 'Simulation seats do not have invitations.', current_version);
  end if;
  if seat_user_id is not null then
    return public.action_failure(
      'NOT_AUTHORIZED',
      'A claimed seat does not have a reusable invitation.',
      current_version
    );
  end if;

  select * into invitation
  from public.room_invitations
  where room_id = p_room_id and participant_id = p_participant_id
  for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'No invitation exists for this participant.', current_version);
  end if;
  if invitation.claimed_at is not null then
    return public.action_failure(
      'NOT_AUTHORIZED',
      'A claimed invitation cannot be revoked.',
      current_version
    );
  end if;
  if invitation.revoked_at is not null then
    return public.action_success('Invitation already revoked.', current_version);
  end if;

  update public.room_invitations set revoked_at = now() where id = invitation.id;
  update public.rooms set version = current_version + 1 where id = p_room_id;

  select id into organizer_participant_id
  from public.participants
  where room_id = p_room_id and user_id = caller_id and kind = 'human'
  order by seat_order asc
  limit 1;

  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    p_room_id, 'participant', organizer_participant_id, p_origin,
    'invitation.revoked', 'participant', p_participant_id,
    jsonb_build_object('participantId', p_participant_id),
    jsonb_build_object('ok', true),
    current_version, current_version + 1, false
  );

  return public.action_success('Invitation revoked.', current_version + 1);
end;
$$;

revoke all on function public.regenerate_room_invitation(text, bigint, text, public.action_origin) from public;
revoke all on function public.revoke_room_invitation(text, bigint, text, public.action_origin) from public;

grant execute on function public.regenerate_room_invitation(text, bigint, text, public.action_origin) to authenticated;
grant execute on function public.revoke_room_invitation(text, bigint, text, public.action_origin) to authenticated;
