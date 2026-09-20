-- ============================================================
-- Migration: Add User Type / Role (Admin & User) to Profiles
-- Safe to re-run: uses IF NOT EXISTS / OR REPLACE / IF EXISTS
-- ============================================================

-- 1. Add 'role' column to profiles if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'role'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN role text NOT NULL DEFAULT 'user'
      CHECK (role IN ('user', 'admin'));
  END IF;
END $$;

-- 2. Create index on role for fast lookups
CREATE INDEX IF NOT EXISTS idx_profiles_role ON public.profiles(role);

-- 3. Promote specified platform admin(s)
UPDATE public.profiles
SET role = 'admin'
WHERE lower(trim(email)) = 'amarmahmmud10@gmail.com';

-- 4. Prevent non-admins from self-promoting their role via UPDATE
CREATE OR REPLACE FUNCTION public.protect_profile_role()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  -- If role is changing, ensure only existing admins or service_role can change it
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    IF auth.role() <> 'service_role' THEN
      -- If user is not already an admin, revert role to OLD.role
      IF OLD.role <> 'admin' THEN
        NEW.role := OLD.role;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_role ON public.profiles;
CREATE TRIGGER trg_protect_profile_role
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE PROCEDURE public.protect_profile_role();

-- 5. Ensure public read policy covers public fields for community models
DROP POLICY IF EXISTS "Public can view basic profiles" ON public.profiles;
CREATE POLICY "Public can view basic profiles"
  ON public.profiles FOR SELECT
  USING (true);
