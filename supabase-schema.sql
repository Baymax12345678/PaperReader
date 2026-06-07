create table if not exists public.papers (
  id text primary key,
  title text not null,
  normalized_title text not null,
  doi text,
  arxiv_id text,
  url text,
  venue text,
  year integer,
  publication_date date,
  abstract text,
  tldr text,
  authors_json jsonb not null default '[]'::jsonb,
  open_access_pdf text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_paper_states (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  paper_id text not null references public.papers(id) on delete cascade,
  is_read boolean not null default false,
  is_saved boolean not null default false,
  is_dismissed boolean not null default false,
  read_at timestamptz,
  saved_at timestamptz,
  dismissed_at timestamptz,
  note text,
  tags text[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique (user_id, paper_id)
);

create index if not exists papers_normalized_title_idx on public.papers (normalized_title);
create index if not exists papers_doi_idx on public.papers (doi);
create index if not exists papers_arxiv_id_idx on public.papers (arxiv_id);
create index if not exists user_paper_states_user_updated_idx on public.user_paper_states (user_id, updated_at desc);
create index if not exists user_paper_states_user_read_idx on public.user_paper_states (user_id, read_at desc) where is_read = true;

alter table public.papers enable row level security;
alter table public.user_paper_states enable row level security;

drop policy if exists "Authenticated users can read papers" on public.papers;
create policy "Authenticated users can read papers"
  on public.papers for select
  to authenticated
  using (true);

drop policy if exists "Authenticated users can upsert papers" on public.papers;
create policy "Authenticated users can upsert papers"
  on public.papers for insert
  to authenticated
  with check (true);

drop policy if exists "Authenticated users can update papers" on public.papers;
create policy "Authenticated users can update papers"
  on public.papers for update
  to authenticated
  using (true)
  with check (true);

drop policy if exists "Users can read own paper states" on public.user_paper_states;
create policy "Users can read own paper states"
  on public.user_paper_states for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own paper states" on public.user_paper_states;
create policy "Users can insert own paper states"
  on public.user_paper_states for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own paper states" on public.user_paper_states;
create policy "Users can update own paper states"
  on public.user_paper_states for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own paper states" on public.user_paper_states;
create policy "Users can delete own paper states"
  on public.user_paper_states for delete
  to authenticated
  using (auth.uid() = user_id);
