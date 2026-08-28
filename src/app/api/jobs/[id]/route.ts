import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const R2_BUCKET = process.env.R2_BUCKET_NAME || "";

/**
 * Recursively delete all objects with a given prefix from Cloudflare R2.
 */
async function deleteR2Prefix(prefix: string) {
  if (!R2_BUCKET || !prefix) return;

  try {
    let continuationToken: string | undefined = undefined;
    do {
      const listCommand = new ListObjectsV2Command({
        Bucket: R2_BUCKET,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });

      const listRes: any = await s3.send(listCommand);
      const contents: Array<{ Key?: string }> = listRes?.Contents || [];
      const objects = contents
        .map((obj) => ({ Key: obj.Key }))
        .filter((obj): obj is { Key: string } => Boolean(obj.Key));

      if (objects.length > 0) {
        const deleteCommand = new DeleteObjectsCommand({
          Bucket: R2_BUCKET,
          Delete: { Objects: objects },
        });
        await s3.send(deleteCommand);
        console.log(`[Jobs API] Deleted ${objects.length} files under R2 prefix "${prefix}"`);
      }

      continuationToken = listRes?.NextContinuationToken;
    } while (continuationToken);
  } catch (err) {
    console.error(`[Jobs API] Error deleting R2 prefix "${prefix}":`, err);
  }
}

/**
 * Delete a single object key from Cloudflare R2.
 */
async function deleteR2Key(key: string) {
  if (!R2_BUCKET || !key) return;

  try {
    const deleteCommand = new DeleteObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
    });
    await s3.send(deleteCommand);
    console.log(`[Jobs API] Deleted single R2 object "${key}"`);
  } catch (err) {
    console.error(`[Jobs API] Error deleting R2 key "${key}":`, err);
  }
}

/**
 * Extract R2 object key from a full URL or relative path.
 */
function extractR2Key(urlOrKey: string | null | undefined): string | null {
  if (!urlOrKey) return null;
  if (urlOrKey.startsWith("datasets/") || urlOrKey.startsWith("adapters/")) {
    return urlOrKey.split("?")[0];
  }
  const match = urlOrKey.match(/(datasets\/[^\?]+|adapters\/[^\?]+)/);
  if (match) {
    return decodeURIComponent(match[1]);
  }
  return null;
}

// DELETE /api/jobs/[id] — delete a job, its Cloudflare R2 model weights & datasets, and Supabase data
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch the job with storage details and verify ownership
  const { data: job, error: fetchErr } = await supabase
    .from("jobs")
    .select("id, user_id, status, result_url, dataset_url, dataset_id, config, chats_count, likes_count")
    .eq("id", id)
    .single();

  if (fetchErr || !job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.user_id !== user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Block deletion of actively running jobs unless manually stopped/failed
  if (job.status === "running" || job.status === "pending") {
    return NextResponse.json(
      { error: "Cannot remove a job that is currently running or pending. Please wait for it to finish or mark it as failed first." },
      { status: 409 }
    );
  }

  // Check if model is published and used by >= 30% of active platform users (MAU)
  const jobConfig = (typeof job.config === "object" && job.config !== null && !Array.isArray(job.config))
    ? (job.config as Record<string, any>)
    : {};
  const isPublished = Boolean(jobConfig.published);

  if (isPublished) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // 1. Calculate active platform users (users active in the last 30 days)
    const [
      { data: recentProfiles },
      { data: recentJobs },
      { data: recentLikes },
      { data: recentTransactions },
    ] = await Promise.all([
      supabase.from("profiles").select("id").gte("created_at", thirtyDaysAgo),
      supabase.from("jobs").select("user_id").gte("created_at", thirtyDaysAgo),
      supabase.from("user_likes").select("user_id").gte("created_at", thirtyDaysAgo),
      supabase.from("credit_transactions").select("user_id").gte("created_at", thirtyDaysAgo),
    ]);

    const activeUserSet = new Set<string>();
    recentProfiles?.forEach((p: any) => p.id && activeUserSet.add(p.id));
    recentJobs?.forEach((j: any) => j.user_id && activeUserSet.add(j.user_id));
    recentLikes?.forEach((l: any) => l.user_id && activeUserSet.add(l.user_id));
    recentTransactions?.forEach((t: any) => t.user_id && activeUserSet.add(t.user_id));

    // If platform is new or active set is small, fallback to total profiles count
    let activeUsersCount = activeUserSet.size;
    if (activeUsersCount === 0) {
      const { count: totalCount } = await supabase.from("profiles").select("id", { count: "exact", head: true });
      activeUsersCount = Math.max(totalCount || 1, 1);
    }

    // 2. Count distinct active users who interacted with or liked this model
    const { data: modelLikers } = await supabase
      .from("user_likes")
      .select("user_id")
      .eq("target_id", id)
      .eq("target_type", "job");

    const modelUserSet = new Set<string>();
    modelLikers?.forEach((l: any) => l.user_id && modelUserSet.add(l.user_id));

    const chatsCount = job.chats_count || 0;
    const modelActiveUsers = Math.max(modelUserSet.size, Math.min(chatsCount, activeUsersCount));
    const activeUsagePercentage = (modelActiveUsers / activeUsersCount) * 100;

    // Check threshold: 30% and over (>= 30%) of active platform users
    if (activeUsagePercentage >= 30 || (activeUsersCount >= 2 && chatsCount >= activeUsersCount * 0.3)) {
      const updatedConfig = {
        ...jobConfig,
        deletion_review: {
          status: "under_review",
          requested_at: new Date().toISOString(),
          active_usage_percentage: Math.round(activeUsagePercentage),
          active_users_count: activeUsersCount,
        },
      };

      await supabase
        .from("jobs")
        .update({ config: updatedConfig })
        .eq("id", id);

      return NextResponse.json(
        {
          underReview: true,
          activeUsagePercentage: Math.round(activeUsagePercentage),
          error: "Deletion application under review: This published model is actively used by 30% or more of active platform users. To maintain service continuity for active users, your deletion request is under administrative review and will be processed once verified.",
        },
        { status: 423 }
      );
    }
  }

  // 1. Delete LoRA adapter model weights from Cloudflare R2
  // Modal uploads adapters to `adapters/${job.id}/`
  const defaultAdapterPrefix = `adapters/${job.id}`;
  await deleteR2Prefix(defaultAdapterPrefix);

  if (job.result_url && job.result_url !== defaultAdapterPrefix) {
    const customResultPrefix = extractR2Key(job.result_url);
    if (customResultPrefix) {
      await deleteR2Prefix(customResultPrefix);
    }
  }

  // 2. Delete training dataset from Cloudflare R2 if not used by any other job
  if (job.dataset_url) {
    const datasetKey = extractR2Key(job.dataset_url);
    if (datasetKey) {
      const { data: sharedJobs } = await supabase
        .from("jobs")
        .select("id")
        .eq("dataset_url", job.dataset_url)
        .neq("id", id)
        .limit(1);

      if (!sharedJobs || sharedJobs.length === 0) {
        await deleteR2Key(datasetKey);
      }
    }
  }

  // 3. Clean up dataset record in Supabase if orphaned
  if (job.dataset_id) {
    const { data: datasetReferenced } = await supabase
      .from("jobs")
      .select("id")
      .eq("dataset_id", job.dataset_id)
      .neq("id", id)
      .limit(1);

    if (!datasetReferenced || datasetReferenced.length === 0) {
      await supabase.from("datasets").delete().eq("id", job.dataset_id).eq("user_id", user.id);
    }
  }

  // 4. Clean up relational references in Supabase
  await supabase.from("wizard_sessions").update({ linked_job_id: null }).eq("linked_job_id", id);
  await supabase.from("user_likes").delete().eq("target_id", id).eq("target_type", "job");

  // 5. Delete the job record from Supabase
  const { error: deleteErr } = await supabase
    .from("jobs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (deleteErr) {
    console.error("[Jobs API] Delete error:", deleteErr);
    return NextResponse.json({ error: deleteErr.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
