-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Hybrid Search & Rich Chunk Metadata for RAG
-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Adds page_number, doc_type, media_url, timestamp_range to expert_chunks.
-- 2. Creates GIN index on expert_chunks.content for fast Postgres full-text search.
-- 3. Upgrades match_expert_chunks RPC to perform Reciprocal Rank Fusion (RRF)
--    combining pgvector cosine distance and Postgres FTS tsvector search.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add metadata columns to expert_chunks
alter table public.expert_chunks add column if not exists page_number     integer;
alter table public.expert_chunks add column if not exists doc_type         text;
alter table public.expert_chunks add column if not exists media_url         text;
alter table public.expert_chunks add column if not exists timestamp_range   text;

-- 2. Create GIN index for full-text search using the 'simple' dictionary (multilingual safe)
create index if not exists expert_chunks_fts_idx
  on public.expert_chunks
  using gin (to_tsvector('simple', content));

-- 3. Drop existing match_expert_chunks function signatures to avoid overloading ambiguity
drop function if exists public.match_expert_chunks(vector, uuid, int, float);
drop function if exists public.match_expert_chunks(vector, uuid, int, float, text, int);

-- 4. Create hybrid search RPC with Reciprocal Rank Fusion
create or replace function public.match_expert_chunks(
  query_embedding   vector(768),
  target_expert_id  uuid,
  match_count       int     default 5,
  match_threshold   float   default 0.3,
  query_text        text    default '',
  rrf_k             int     default 60
)
returns table (
  id               uuid,
  content          text,
  source_filename  text,
  chunk_index      int,
  similarity       float,
  section_title    text,
  section_tier     text,
  page_number      int,
  doc_type         text,
  media_url        text,
  timestamp_range  text,
  rrf_score        float
)
language plpgsql security definer set search_path = public
as $$
declare
  has_text boolean := (query_text is not null and trim(query_text) <> '');
begin
  return query
  with vector_matches as (
    select
      ec.id,
      row_number() over (order by ec.embedding <=> query_embedding) as rank_vec,
      (1 - (ec.embedding <=> query_embedding))::float as sim
    from public.expert_chunks ec
    where
      ec.expert_id = target_expert_id
      and ec.embedding is not null
      and 1 - (ec.embedding <=> query_embedding) > match_threshold
    order by ec.embedding <=> query_embedding
    limit match_count * 3
  ),
  fts_matches as (
    select
      ec.id,
      row_number() over (
        order by ts_rank_cd(to_tsvector('simple', ec.content), plainto_tsquery('simple', query_text)) desc
      ) as rank_fts
    from public.expert_chunks ec
    where
      ec.expert_id = target_expert_id
      and has_text
      and to_tsvector('simple', ec.content) @@ plainto_tsquery('simple', query_text)
    limit match_count * 3
  ),
  combined as (
    select
      coalesce(v.id, f.id) as id,
      coalesce(1.0 / (rrf_k + v.rank_vec), 0.0) +
      coalesce(1.0 / (rrf_k + f.rank_fts), 0.0) as score,
      v.sim as sim
    from vector_matches v
    full outer join fts_matches f on v.id = f.id
  )
  select
    ec.id,
    ec.content,
    ec.source_filename,
    ec.chunk_index,
    coalesce(c.sim, (1 - (ec.embedding <=> query_embedding)))::float as similarity,
    ec.section_title,
    ec.section_tier,
    ec.page_number,
    ec.doc_type,
    ec.media_url,
    ec.timestamp_range,
    c.score::float as rrf_score
  from combined c
  join public.expert_chunks ec on ec.id = c.id
  order by c.score desc
  limit match_count;
end;
$$;
