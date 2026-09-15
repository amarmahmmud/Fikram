-- ─────────────────────────────────────────────
-- grant_credits RPC function
-- ─────────────────────────────────────────────
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query).
-- This function atomically increments credits_balance and inserts a
-- credit_transactions row in a single Postgres transaction.
-- This prevents read-then-write race conditions when two webhook events
-- for the same user land close together.

-- ── Step 1: Add UNIQUE constraint on reference_id ────────────────────────────
-- This is the database-level second layer of defense beyond the Redis
-- idempotency check. If two identical webhook deliveries somehow both
-- get past the Redis SET NX (e.g. Redis is down), the UNIQUE constraint
-- will cause the second INSERT to fail, preventing double-crediting.
-- Only non-null reference_ids are constrained (NULLs are always unique in Postgres).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'credit_transactions_reference_id_unique'
  ) THEN
    ALTER TABLE credit_transactions
      ADD CONSTRAINT credit_transactions_reference_id_unique
      UNIQUE (reference_id);
  END IF;
END $$;

-- ── Step 2: The RPC function ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION grant_credits(
  p_user_id UUID,
  p_amount INT,
  p_type TEXT,
  p_label TEXT,
  p_reference_id UUID DEFAULT NULL
) RETURNS void AS $$
DECLARE
  new_balance INT;
BEGIN
  -- Atomically update balance
  UPDATE profiles
    SET credits_balance = credits_balance + p_amount
    WHERE id = p_user_id
    RETURNING credits_balance INTO new_balance;

  -- Guard: user not found
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User % not found', p_user_id;
  END IF;

  -- Insert transaction record with the new balance.
  -- If reference_id is non-null and a row with the same reference_id
  -- already exists, this INSERT will fail with a unique violation,
  -- and the entire transaction (including the UPDATE above) will roll back.
  INSERT INTO credit_transactions (user_id, type, label, amount, balance_after, reference_id)
    VALUES (p_user_id, p_type, p_label, p_amount, new_balance, p_reference_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
