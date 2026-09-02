-- `required_for_approval` was a separately-maintained flag that several
-- call sites needed to keep in sync with `decision_role`, and two of them
-- never did: `resolve_join_request` (backing `admit_participant`) hardcodes
-- it `false` even when a participant is admitted directly as
-- `decision_maker` (the exact "admit Maya as CTO and give her decision
-- authority" example in the WebMCP docs), and `set_participant_decision_role`
-- never touches it at all when promoting or demoting someone. Only
-- `create_room`, `enable_security_expert`, and `start_demo_scenario`
-- (multi_user mode) ever set it correctly, and only because each sets both
-- columns explicitly, or relies on the reverse derivation below at INSERT
-- time.
--
-- The practical failure mode: `advance_room_phase`'s Input -> Proposals guard
-- requires at least one `kind = 'human' and required_for_approval = true`
-- row to exist ("The room has no participant whose approval is required.")
-- -- the same guard the `supabase/seed.sql` fix addressed for the demo room.
-- A room whose only such row stops qualifying (ownership transferred away,
-- or the sole decision-maker demoted) can get stuck the same way. Separately,
-- a participant admitted or promoted straight to `decision_maker` without
-- ever passing through `create_room` was never added to the final decision's
-- required-approver list at all, silently defeating `equal_authority_
-- consensus`'s promise that every decision-maker must approve.
--
-- This adds a forward derivation -- `required_for_approval` follows the
-- final `decision_role` this same trigger settles on -- so every call site
-- that changes `decision_role` without remembering this column gets it
-- right automatically. The pre-existing reverse branch (a caller setting
-- `required_for_approval` to imply `decision_maker`) stays, because
-- `start_demo_scenario`'s multi_user mode genuinely relies on it: it INSERTs
-- `demo-engineer`/`demo-designer`/`demo-marketing` with `required_for_approval
-- = true` and no explicit `decision_role`, expecting this trigger to derive
-- `decision_maker` from it. But it is now scoped to `INSERT` only. On an
-- `UPDATE` that changes only `decision_role` (`set_participant_decision_role`
-- demoting someone back to `contributor`), `NEW.required_for_approval` would
-- otherwise carry over the *old*, stale `true` from before the demotion, and
-- the two directions would fight -- the demotion would never take effect
-- because the stale `true` kept re-asserting `decision_maker`. Restricting
-- the reverse branch to `INSERT` avoids that fight while still letting the
-- forward derivation run unconditionally, so `UPDATE`s always follow
-- whatever `decision_role` the caller explicitly asked for.
create or replace function public.derive_owner_participant_authority()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1 from public.rooms room
    where room.id = new.room_id and room.owner_participant_id = new.id
  ) then
    new.meeting_role := 'owner';
    new.decision_role := 'decision_maker';
  elsif new.kind = 'simulation' then
    new.decision_role := 'advisor';
  elsif new.kind = 'expert' then
    new.decision_role := 'advisor';
  elsif tg_op = 'INSERT' and new.required_for_approval then
    new.decision_role := 'decision_maker';
  end if;

  new.required_for_approval := (new.kind = 'human' and new.decision_role = 'decision_maker');

  return new;
end;
$$;
