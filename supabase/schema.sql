-- ============================================================
-- MODEL FACTORY — Supabase Database Schema (Production-Ready)
-- Run this in your Supabase SQL Editor (supabase.com → SQL Editor)
-- ============================================================

-- ─────────────────────────────────────────────────────────────────────────────
-- 0. Extensions
-- ─────────────────────────────────────────────────────────────────────────────

-- pgvector is required for RAG (vector similarity search).
-- Enable it once per project in the Supabase dashboard:
-- Settings → Extensions → pgvector  OR run:
create extension if not exists vector;


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Profiles (extends auth.users)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.profiles (
  id          uuid references auth.users(id) on delete cascade primary key,
  email       text,
  full_name   text,
  avatar_url  text,
  plan        text default 'free' check (plan in ('free','personal','pro','enterprise')),
  credits_balance integer default 100 not null,
  created_at  timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Users can view own profile"
  on public.profiles for select using (auth.uid() = id);

create policy "Users can update own profile"
  on public.profiles for update using (auth.uid() = id);

-- Auto-create profile on signup and give 100 free credits
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, credits_balance)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    100
  )
  on conflict (id) do nothing;

  -- Log the signup bonus credit transaction
  insert into public.credit_transactions (user_id, type, label, amount, balance_after)
  values (new.id, 'signup_bonus', 'Signup Bonus — Welcome to Model Factory!', 100, 100)
  on conflict do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Datasets
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.datasets (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  name        text not null,
  file_url    text,
  format      text check (format in ('csv','jsonl','txt','json','chat')),
  rows_count  integer default 0,
  size_bytes  bigint default 0,
  created_at  timestamptz default now()
);

alter table public.datasets enable row level security;
create policy "Users manage own datasets"
  on public.datasets for all using (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Fine-Tuning Jobs
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.jobs (
  id              uuid default gen_random_uuid() primary key,
  user_id         uuid references public.profiles(id) on delete cascade not null,
  name            text not null default 'Untitled Job',
  status          text default 'pending' check (status in ('pending','running','completed','failed','cancelled')),
  base_model      text not null,
  method          text default 'lora' check (method in ('lora','qlora','full')),
  config          jsonb default '{}'::jsonb,
  dataset_id      uuid references public.datasets(id),
  dataset_url     text,
  result_url      text,
  logs            text default '',
  credits_used    integer default 0,
  replicate_id    text,
  likes_count     integer default 0 not null,
  chats_count     integer default 0 not null,
  started_at      timestamptz,
  completed_at    timestamptz,
  finished_at     timestamptz,
  created_at      timestamptz default now()
);

alter table public.jobs enable row level security;

-- Owner can do anything with their jobs
create policy "Users manage own jobs"
  on public.jobs for all using (auth.uid() = user_id);

-- Anyone can read a published (community) job
create policy "Public can view published jobs"
  on public.jobs for select
  using ((config->>'published')::boolean is true);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Credit Transactions
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.credit_transactions (
  id            uuid default gen_random_uuid() primary key,
  user_id       uuid references public.profiles(id) on delete cascade not null,
  type          text check (type in ('signup_bonus','purchase','job_consumed','refund')),
  label         text not null,
  amount        integer not null,
  balance_after integer not null,
  reference_id  uuid,
  created_at    timestamptz default now()
);

alter table public.credit_transactions enable row level security;
create policy "Users view own transactions"
  on public.credit_transactions for select using (auth.uid() = user_id);
create policy "Service can insert transactions"
  on public.credit_transactions for insert with check (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Wizard Sessions
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.wizard_sessions (
  id               uuid default gen_random_uuid() primary key,
  user_id          uuid references public.profiles(id) on delete cascade not null,
  messages         jsonb default '[]'::jsonb,
  extracted_config jsonb default '{}'::jsonb,
  linked_job_id    uuid references public.jobs(id),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now()
);

alter table public.wizard_sessions enable row level security;
create policy "Users manage own sessions"
  on public.wizard_sessions for all using (auth.uid() = user_id);


-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Experts (RAG Assistants)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.experts (
  id            uuid default gen_random_uuid() primary key,
  user_id       uuid references public.profiles(id) on delete cascade not null,
  name          text not null,
  slug          text unique,
  description   text,
  system_prompt text,
  avatar_url    text,
  is_published  boolean default false not null,
  likes_count   integer default 0 not null,
  chats_count   integer default 0 not null,
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

alter table public.experts enable row level security;

-- Owner can do anything
create policy "Users manage own experts"
  on public.experts for all using (auth.uid() = user_id);

-- Anyone can read a published expert
create policy "Public can view published experts"
  on public.experts for select using (is_published = true);


-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Expert Chunks (RAG Knowledge Base with pgvector)
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.expert_chunks (
  id               uuid default gen_random_uuid() primary key,
  expert_id        uuid references public.experts(id) on delete cascade not null,
  content          text not null,
  embedding        vector(768),        -- text-embedding-004 produces 768-dim vectors
  source_filename  text,
  chunk_index      integer,
  section_title    text,               -- e.g. "3. Enzyme-Converted Kidney"
  section_tier     text,               -- "primary" | "secondary"
  section_index    integer,            -- order of the section in the document
  created_at       timestamptz default now()
);

alter table public.expert_chunks enable row level security;

-- Owner can manage their expert's chunks
create policy "Users manage own expert chunks"
  on public.expert_chunks for all
  using (
    exists (
      select 1 from public.experts e
      where e.id = expert_id and e.user_id = auth.uid()
    )
  );

-- Anyone can read chunks of a published expert (needed for public chat)
create policy "Public can read published expert chunks"
  on public.expert_chunks for select
  using (
    exists (
      select 1 from public.experts e
      where e.id = expert_id and e.is_published = true
    )
  );

-- Index for fast vector similarity search
create index if not exists expert_chunks_embedding_idx
  on public.expert_chunks
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);


-- ─────────────────────────────────────────────────────────────────────────────
-- 8. User Likes
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.user_likes (
  id          uuid default gen_random_uuid() primary key,
  user_id     uuid references public.profiles(id) on delete cascade not null,
  target_id   uuid not null,
  target_type text check (target_type in ('expert','job')) not null,
  created_at  timestamptz default now(),
  unique (user_id, target_id, target_type)  -- prevent double-liking
);

alter table public.user_likes enable row level security;
create policy "Users manage own likes"
  on public.user_likes for all using (auth.uid() = user_id);
-- Anyone can read likes (needed for like counts on browse page)
create policy "Public can view likes"
  on public.user_likes for select using (true);


-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Atomic Increment Functions (bypass RLS for cross-user counter updates)
-- ─────────────────────────────────────────────────────────────────────────────
-- These SECURITY DEFINER functions allow anyone to increment like/chat
-- counters on published models without needing write access to the underlying
-- row (which belongs to a different user).

create or replace function public.increment_job_likes(job_id uuid)
returns integer language plpgsql security definer set search_path = public
as $$
declare
  new_count integer;
begin
  update public.jobs
  set likes_count = likes_count + 1
  where id = job_id
  returning likes_count into new_count;
  return new_count;
end;
$$;

create or replace function public.increment_expert_likes(expert_id uuid)
returns integer language plpgsql security definer set search_path = public
as $$
declare
  new_count integer;
begin
  update public.experts
  set likes_count = likes_count + 1
  where id = expert_id
  returning likes_count into new_count;
  return new_count;
end;
$$;

create or replace function public.increment_job_chats(job_id uuid)
returns integer language plpgsql security definer set search_path = public
as $$
declare
  new_count integer;
begin
  update public.jobs
  set chats_count = chats_count + 1
  where id = job_id
  returning likes_count into new_count;
  return new_count;
end;
$$;

create or replace function public.increment_expert_chats(expert_id uuid)
returns integer language plpgsql security definer set search_path = public
as $$
declare
  new_count integer;
begin
  update public.experts
  set chats_count = chats_count + 1
  where id = expert_id
  returning chats_count into new_count;
  return new_count;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Vector Similarity Search RPC
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.match_expert_chunks(
  query_embedding   vector(768),
  target_expert_id  uuid,
  match_count       int     default 5,
  match_threshold   float   default 0.3
)
returns table (
  id               uuid,
  content          text,
  source_filename  text,
  chunk_index      int,
  similarity       float,
  section_title    text,
  section_tier     text
)
language plpgsql security definer set search_path = public
as $$
begin
  return query
  select
    ec.id,
    ec.content,
    ec.source_filename,
    ec.chunk_index,
    1 - (ec.embedding <=> query_embedding) as similarity,
    ec.section_title,
    ec.section_tier
  from public.expert_chunks ec
  where
    ec.expert_id = target_expert_id
    and ec.embedding is not null
    and 1 - (ec.embedding <=> query_embedding) > match_threshold
  order by ec.embedding <=> query_embedding
  limit match_count;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 11. Realtime subscriptions
-- ─────────────────────────────────────────────────────────────────────────────

alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.profiles;
