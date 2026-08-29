-- Slice A2: invitation preview and claim.
--
-- An invitation is a capability for one predetermined seat. The table, the raw
-- token generator and the canonical hashing helper shipped with the A1
-- migration because `create_room` cannot return invite URLs without them; this
-- migration adds the two operations that consume a raw token.
--
-- Both functions take the raw token and hash it with `public.hash_invite_token`
-- so creation, preview and claim compare tokens through one implementation. The
-- raw token is never written to a row, an audit event or a returned DTO.
--
-- `public.can_read_room` is deliberately untouched: an invitation never grants a
-- full-room read. Membership does, and membership only exists after a claim.

-- Narrow, pre-membership projection of a room. SECURITY DEFINER because the
-- caller is not yet a member and therefore cannot pass any read policy; the
-- returned object is limited to the safe preview DTO.
--
-- A claimed invitation only shows room details to the session that claimed it.
-- Anyone else -- including whoever else holds a copy of a spent link -- gets the
-- invalid branch, which carries no room or participant fields at all.
create or replace function public.preview_room_invitation(p_raw_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  invitation public.room_invitations%rowtype;
  seat public.participants%rowtype;
  room public.rooms%rowtype;
  claimed boolean;
begin
  if caller_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'An authenticated session is required.', 0);
  end if;

  select * into invitation
  from public.room_invitations
  where token_hash = public.hash_invite_token(p_raw_token);
  if not found then
    return public.action_success_data(
      'Invitation preview loaded.',
      0,
      jsonb_build_object('inviteValid', false, 'alreadyClaimed', false)
    );
  end if;

  claimed := invitation.claimed_at is not null;

  select * into seat from public.participants where id = invitation.participant_id;

  if not found
    or invitation.revoked_at is not null
    or invitation.expires_at <= now()
    or (claimed and seat.user_id is distinct from caller_id)
  then
    return public.action_success_data(
      'Invitation preview loaded.',
      0,
      jsonb_build_object('inviteValid', false, 'alreadyClaimed', claimed)
    );
  end if;

  select * into room from public.rooms where id = invitation.room_id;

  return public.action_success_data('Invitation preview loaded.', 0, jsonb_build_object(
    'inviteValid', true,
    'alreadyClaimed', claimed,
    'roomId', room.id,
    'title', room.title,
    'brief', room.brief,
    'participant', jsonb_build_object('id', seat.id, 'name', seat.name, 'role', seat.role)
  ));
end;
$$;

-- Binds the calling session to the one seat the capability names. Atomic: the
-- room row is locked first, so concurrent claims on one room -- and therefore on
-- one token -- serialize, and the second claim observes `claimed_at`.
--
-- Locks are taken rooms -> invitation -> participant, matching the order every
-- other room mutation uses.
create or replace function public.claim_room_invitation(
  p_raw_token text,
  p_origin public.action_origin
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller_id uuid := (select auth.uid());
  token_hash_value text;
  invitation_room_id text;
  invitation public.room_invitations%rowtype;
  current_version bigint;
  current_phase public.room_phase;
  seat_user_id uuid;
  seat_kind public.participant_kind;
  existing_seat_id text;
  claim_result jsonb;
begin
  if caller_id is null then
    return public.action_failure('NOT_AUTHORIZED', 'An authenticated session is required.', 0);
  end if;
  if p_raw_token is null or length(p_raw_token) = 0 then
    return public.action_failure('VALIDATION_ERROR', 'An invitation token is required.', 0);
  end if;

  token_hash_value := public.hash_invite_token(p_raw_token);

  -- Unlocked lookup, only to learn which room to lock.
  select room_id into invitation_room_id
  from public.room_invitations where token_hash = token_hash_value;
  if not found then
    return public.action_failure(
      'NOT_AUTHORIZED',
      'This invitation is not valid.',
      0,
      'Ask the organizer for your invitation link.'
    );
  end if;

  select version, phase into current_version, current_phase
  from public.rooms where id = invitation_room_id for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0);
  end if;

  -- Re-read under the room lock: everything below decides on settled state.
  select * into invitation
  from public.room_invitations where token_hash = token_hash_value for update;
  if not found then
    return public.action_failure('NOT_AUTHORIZED', 'This invitation is not valid.', current_version);
  end if;

  if invitation.revoked_at is not null then
    return public.action_failure(
      'NOT_AUTHORIZED',
      'This invitation has been revoked.',
      current_version,
      'Ask the organizer for a new invitation link.'
    );
  end if;
  if invitation.expires_at <= now() then
    return public.action_failure(
      'NOT_AUTHORIZED',
      'This invitation has expired.',
      current_version,
      'Ask the organizer for a new invitation link.'
    );
  end if;

  select user_id, kind into seat_user_id, seat_kind
  from public.participants
  where id = invitation.participant_id and room_id = invitation.room_id
  for update;
  if not found or seat_kind <> 'human' then
    return public.action_failure('NOT_AUTHORIZED', 'The invited seat is unavailable.', current_version);
  end if;

  claim_result := jsonb_build_object(
    'roomId', invitation.room_id,
    'participantId', invitation.participant_id
  );

  -- Replaying one's own claim is a no-op, not an error: the link stays usable
  -- as a bookmark. Any other session is refused, so a spent token cannot be
  -- redeemed twice.
  if invitation.claimed_at is not null then
    if seat_user_id = caller_id then
      return public.action_success_data(
        'Seat already claimed by this session.',
        current_version,
        claim_result
      );
    end if;
    return public.action_failure(
      'NOT_AUTHORIZED',
      'This invitation has already been used.',
      current_version,
      'Ask the organizer for a new invitation link.'
    );
  end if;

  if current_phase = 'finalized' then
    return public.action_failure(
      'ALREADY_FINALIZED',
      'The finalized decision is immutable.',
      current_version
    );
  end if;
  if seat_user_id is not null then
    return public.action_failure('NOT_AUTHORIZED', 'The invited seat is already taken.', current_version);
  end if;

  select id into existing_seat_id
  from public.participants
  where room_id = invitation.room_id and user_id = caller_id;
  if existing_seat_id is not null then
    return public.action_failure(
      'NOT_AUTHORIZED',
      'This session already holds another seat in this room.',
      current_version
    );
  end if;

  update public.participants
  set user_id = caller_id
  where id = invitation.participant_id and room_id = invitation.room_id and user_id is null;

  update public.room_invitations set claimed_at = now() where id = invitation.id;
  update public.rooms set version = current_version + 1 where id = invitation.room_id;

  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version,
    confirmation_required
  ) values (
    invitation.room_id, 'participant', invitation.participant_id, p_origin,
    'participant.seat_claimed', 'participant', invitation.participant_id,
    -- Sanitized: the capability itself must never be readable from the ledger.
    jsonb_build_object('via', 'invitation'),
    jsonb_build_object('ok', true), current_version, current_version + 1, false
  );

  return public.action_success_data('Seat claimed.', current_version + 1, claim_result);
end;
$$;

revoke all on function public.preview_room_invitation(text) from public;
revoke all on function public.claim_room_invitation(text, public.action_origin) from public;

grant execute on function public.preview_room_invitation(text) to authenticated;
grant execute on function public.claim_room_invitation(text, public.action_origin) to authenticated;
