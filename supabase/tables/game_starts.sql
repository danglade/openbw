-- One anonymous row per game started on the web app (see logGameStart in web/openbw.js).
-- Insert-only for the public anon key; rows are read in the Supabase dashboard.
create table public.game_starts (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  map text,          -- map file/url as the lobby knows it ('custom:<name>' for local files)
  mode text,         -- solo | vs-bot | 1v1 | spectate
  my_race smallint,  -- race_t: 0 zerg, 1 terran, 2 protoss
  opponent text,     -- bot (ZZZKBot) | mcrave | human | none
  difficulty text,   -- easy | normal | hard (bot games only)
  mobile boolean     -- coarse-pointer client
);

alter table public.game_starts enable row level security;
