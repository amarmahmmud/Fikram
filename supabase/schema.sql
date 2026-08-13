-- ============================================================
-- MODEL FACTORY — Supabase Database Schema
-- Run this in your Supabase SQL Editor (supabase.com → SQL Editor)
-- ============================================================

-- 1. Profiles (extends auth.users)
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
  );

  -- Log the signup bonus credit transaction
  insert into public.credit_transactions (user_id, type, label, amount, balance_after)
  values (new.id, 'signup_bonus', 'Signup Bonus — Welcome to Model Factory!', 100, 100);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();


-- 2. Datasets
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


-- 3. Fine-Tuning Jobs
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
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz default now()
);

alter table public.jobs enable row level security;
create policy "Users manage own jobs"
  on public.jobs for all using (auth.uid() = user_id);


-- 4. Credit Transactions
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


-- 5. Wizard Sessions
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


-- 6. Realtime: enable for jobs table so UI updates live
alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.profiles;
