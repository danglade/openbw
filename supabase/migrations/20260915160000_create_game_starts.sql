-- Game-start analytics: anonymous, insert-only from the public game page.
create table public.game_starts (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  map text,
  mode text,
  my_race smallint,
  opponent text,
  difficulty text,
  mobile boolean
);

alter table public.game_starts enable row level security;

create policy game_starts_insert_anon on public.game_starts
  for insert to anon
  with check (true);
