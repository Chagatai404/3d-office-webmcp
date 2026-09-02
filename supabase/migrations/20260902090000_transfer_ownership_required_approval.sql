-- `transfer_ownership` moved `meeting_role`/`decision_role` to the new owner
-- but never touched `required_for_approval`. `create_room` sets it `true`
-- for the room's creator specifically so `advance_room_phase` always has at
-- least one required human approver to check against (see its Input ->
-- Proposals guard: "The room has no participant whose approval is
-- required."). After a transfer the new owner could be left with
-- `required_for_approval = false` -- if no other participant independently
-- held that flag, the room became permanently unable to leave Input, the
-- exact failure mode the demo-seed fix (`supabase/seed.sql`) addressed for
-- the seeded scenario. The new owner now always inherits it, matching
-- `create_room`'s own invariant that the current owner is a required
-- approver.
create or replace function public.transfer_ownership(
  p_room_id text,
  p_participant_id text,
  p_expected_version bigint,
  p_origin public.action_origin
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  room_row public.rooms;
  old_owner_row public.participants;
  new_owner_row public.participants;
  next_version bigint;
  new_candidate jsonb;
  new_hash text;
begin
  select * into room_row from public.rooms where id = p_room_id for update;
  if not found then return public.action_failure('VALIDATION_ERROR', 'Room not found.', 0); end if;
  if room_row.version <> p_expected_version then
    return public.action_failure('STALE_ROOM_STATE', 'The room changed before this action completed.', room_row.version,
      'Review the latest room state and retry if the action is still appropriate.');
  end if;
  if room_row.phase = 'finalized' then
    return public.action_failure('ALREADY_FINALIZED', 'The finalized room is immutable.', room_row.version);
  end if;

  select * into old_owner_row from public.participants
    where id = room_row.owner_participant_id and room_id = p_room_id
      and meeting_role = 'owner' and status = 'active' and user_id = (select auth.uid())
    for update;
  if not found then
    return public.action_failure('NOT_AUTHORIZED', 'Only the current room owner can transfer ownership.', room_row.version);
  end if;

  select * into new_owner_row from public.participants
    where id = p_participant_id and room_id = p_room_id for update;
  if not found then
    return public.action_failure('VALIDATION_ERROR', 'That participant does not belong to this room.', room_row.version);
  end if;
  if new_owner_row.id = old_owner_row.id then
    return public.action_failure('VALIDATION_ERROR', 'The target is already the meeting owner.', room_row.version);
  end if;
  if new_owner_row.kind <> 'human' or new_owner_row.status <> 'active' then
    return public.action_failure('VALIDATION_ERROR',
      'Ownership can be transferred only to an active human participant.', room_row.version);
  end if;

  next_version := room_row.version + 1;
  update public.rooms set owner_participant_id = new_owner_row.id, version = next_version where id = p_room_id;

  update public.participants set meeting_role = 'participant' where id = old_owner_row.id;
  update public.participants
    set meeting_role = 'owner', decision_role = 'decision_maker', required_for_approval = true
    where id = new_owner_row.id;

  if room_row.decision_hash is not null then
    new_candidate := public.build_final_decision_candidate(p_room_id);
    if new_candidate is not null then
      new_hash := public.hash_decision_candidate(new_candidate);
      delete from public.approvals where room_id = p_room_id;
      update public.rooms set decision_candidate = new_candidate, decision_hash = new_hash where id = p_room_id;
    end if;
  end if;

  insert into public.audit_events (
    room_id, actor_type, actor_id, origin, action, entity_type, entity_id,
    sanitized_input, result, previous_room_version, resulting_room_version, confirmation_required
  ) values (
    p_room_id, 'participant', old_owner_row.id, p_origin, 'ownership.transferred',
    'participant', new_owner_row.id,
    jsonb_build_object('fromParticipantId', old_owner_row.id, 'toParticipantId', new_owner_row.id),
    jsonb_build_object('ok', true), room_row.version, next_version, false
  );
  return public.action_success('Ownership transferred.', next_version);
end;
$$;
