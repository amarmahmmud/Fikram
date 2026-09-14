-- ─────────────────────────────────────────────
-- grant_credits RPC function
-- ─────────────────────────────────────────────
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query).
-- This function atomically increments credits_balance and inserts a
-- credit_transactions row in a single Postgres transaction.
-- This prevents read-then-write race conditions when two webhook events
-- for the same user land close together.

CREATE OR REPLACE FUNCTION grant_credits(
  p_user_id UUID,
  p_amount INT,
  p_type TEXT,
  p_label TEXT,
  p_reference_id TEXT DEFAULT NULL
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

  -- Insert transaction record with the new balance
  INSERT INTO credit_transactions (user_id, type, label, amount, balance_after, reference_id)
    VALUES (p_user_id, p_type, p_label, p_amount, new_balance, p_reference_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
