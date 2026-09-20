-- ─────────────────────────────────────────────────────────────────────────────
-- Ingest Jobs — Async File Ingestion Tracking (Multi-Phase)
-- ─────────────────────────────────────────────────────────────────────────────
-- Tracks per-file ingestion status with phase-based processing so each
-- serverless function invocation completes well under the 15s Hobby limit.
-- Safe to re-run: uses IF NOT EXISTS.

create table if not exists public.ingest_jobs (
  id              uuid default gen_random_uuid() primary key,
  expert_id       uuid references public.experts(id) on delete cascade not null,
  user_id         uuid references public.profiles(id) on delete cascade not null,
  filename        text not null,
  mime_type       text,
  file_url        text,
  status          text default 'processing' check (status in ('processing','completed','failed')),
  phase           text default 'pending',
  error           text,
  chunks_stored   integer default 0,
  total_chunks    integer default 0,
  retry_count     integer default 0,
  provider        text,
  extracted_text  text,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

alter table public.ingest_jobs enable row level security;

-- Users can view/manage their own ingest jobs
drop policy if exists "Users manage own ingest jobs" on public.ingest_jobs;
create policy "Users manage own ingest jobs"
  on public.ingest_jobs for all
  using (auth.uid() = user_id);

-- Index for fast lookup by expert
create index if not exists ingest_jobs_expert_idx
  on public.ingest_jobs (expert_id, created_at desc);

-- Auto-update updated_at on changes
create or replace function public.handle_ingest_jobs_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_ingest_jobs_updated_at on public.ingest_jobs;
create trigger set_ingest_jobs_updated_at
  before update on public.ingest_jobs
  for each row execute procedure public.handle_ingest_jobs_updated_at();

-- Enable realtime for ingest_jobs so frontend can subscribe
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'ingest_jobs'
  ) then
    alter publication supabase_realtime add table public.ingest_jobs;
  end if;
end;
$$;
