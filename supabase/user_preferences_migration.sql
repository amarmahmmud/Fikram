-- ============================================================
-- Migration: User Preferences (voice_enabled)
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE / IF EXISTS
-- Does NOT touch handle_new_user() or the credits system.
-- ============================================================

-- Ensure original handle_new_user() remains untouched (does not touch user_preferences or credits)
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url, credits_balance, credits_held)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url',
    50,
    0
  )
  on conflict (id) do nothing;

  -- Log the signup bonus credit transaction
  insert into public.credit_transactions (user_id, type, label, amount, balance_after)
  values (new.id, 'signup_bonus', 'Signup Bonus — Welcome to Model Factory!', 50, 50)
  on conflict do nothing;

  return new;
end;
$$;

-- Ensure table exists
create table if not exists public.user_preferences (
  user_id       uuid references auth.users(id) on delete cascade primary key,
  voice_enabled boolean not null default true,
  updated_at    timestamptz default now() not null
);

-- 1. Table already exists in your schema — this just ensures RLS + policies
alter table public.user_preferences enable row level security;

drop policy if exists "Users can view own preferences"   on public.user_preferences;
drop policy if exists "Users can insert own preferences" on public.user_preferences;
drop policy if exists "Users can update own preferences" on public.user_preferences;

create policy "Users can view own preferences"
  on public.user_preferences for select
  using (auth.uid() = user_id);

create policy "Users can insert own preferences"
  on public.user_preferences for insert
  with check (auth.uid() = user_id);

create policy "Users can update own preferences"
  on public.user_preferences for update
  using (auth.uid() = user_id);

-- 2. Auto-update updated_at on every change
create or replace function public.handle_user_preferences_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_user_preferences_updated_at on public.user_preferences;
create trigger set_user_preferences_updated_at
  before update on public.user_preferences
  for each row execute procedure public.handle_user_preferences_updated_at();

-- 3. Backfill existing users who don't have a preferences row yet
insert into public.user_preferences (user_id, voice_enabled)
select id, true
from auth.users
on conflict (user_id) do nothing;

-- 4. INDEPENDENT trigger for new signups — does NOT touch handle_new_user()
create or replace function public.handle_new_user_preferences()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  insert into public.user_preferences (user_id, voice_enabled)
  values (new.id, true)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_preferences on auth.users;
create trigger on_auth_user_created_preferences
  after insert on auth.users
  for each row execute procedure public.handle_new_user_preferences();
