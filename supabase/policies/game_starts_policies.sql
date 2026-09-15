-- The public anon key (embedded in the game page) can only ever add a row.
-- No select/update/delete policies exist, so it can never read anything back —
-- the data is viewed in the Supabase dashboard (owner) only.
create policy game_starts_insert_anon on public.game_starts
  for insert to anon
  with check (true);
