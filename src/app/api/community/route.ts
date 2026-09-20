import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export interface CommunityItem {
  id: string;
  type: "fine_tuned" | "smart_assistant";
  title: string;
  description: string;
  category: string;
  author: {
    name: string;
    avatarUrl?: string;
    isVerified?: boolean;
    role?: string;
  };
  baseModel?: string;
  likesCount: number;
  chatsCount: number;
  publishedAt: string;
  chatUrl: string;
  tags: string[];
  isVerified?: boolean;
  ownerId?: string;
  hasLiked?: boolean;
}

export async function GET() {
  try {
    const supabase = await createClient();

    // 1. Fetch published experts (with owner's profile for real author name)
    const { data: dbExperts } = await supabase
      .from("experts")
      .select("*")
      .eq("is_published", true)
      .order("created_at", { ascending: false });

    // 2. Fetch completed fine-tuning jobs that are published
    const { data: dbJobs } = await supabase
      .from("jobs")
      .select("*")
      .eq("status", "completed");

    // 3. Collect all owner IDs to batch-fetch profile names
    const ownerIds = new Set<string>();
    dbExperts?.forEach((e) => ownerIds.add(e.user_id));
    dbJobs?.forEach((j) => ownerIds.add(j.user_id));

    // 4. Check which items the current user has liked
    const { data: { user } } = await supabase.auth.getUser();
    const userLikedIds = new Set<string>();
    if (user) {
      const { data: userLikes } = await supabase
        .from("user_likes")
        .select("target_id")
        .eq("user_id", user.id);
      
      userLikes?.forEach((like) => userLikedIds.add(like.target_id));
    }

    const profileMap = new Map<
      string,
      { full_name: string | null; avatar_url: string | null; role?: string | null; email?: string | null }
    >();

    if (ownerIds.size > 0) {
      // Query profiles with role, with safe fallback if migration column is pending
      let profilesData: any[] | null = null;
      const resWithRole = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, role, email")
        .in("id", Array.from(ownerIds));

      if (resWithRole.error) {
        const resFallback = await supabase
          .from("profiles")
          .select("id, full_name, avatar_url, email")
          .in("id", Array.from(ownerIds));
        profilesData = resFallback.data;
      } else {
        profilesData = resWithRole.data;
      }

      profilesData?.forEach((p: any) => {
        profileMap.set(p.id, {
          full_name: p.full_name,
          avatar_url: p.avatar_url,
          role: p.role ?? null,
          email: p.email ?? null,
        });
      });
    }

    const isVerifiedAdmin = (profile?: { role?: string | null; email?: string | null }) => {
      if (!profile) return false;
      if (profile.role === "admin") return true;
      if (profile.email && profile.email.toLowerCase().trim() === "amarmahmmud10@gmail.com") return true;
      return false;
    };

    const dynamicItems: CommunityItem[] = [];

    if (dbExperts && dbExperts.length > 0) {
      for (const exp of dbExperts) {
        const profile = profileMap.get(exp.user_id);
        const authorName = profile?.full_name || "Community Creator";
        const isVerified = isVerifiedAdmin(profile);

        // Parse category from description if it contains a [Category: ...] tag
        let category = "General";
        let tags: string[] = ["Knowledge Base", "Q&A"];
        const descText = exp.description || "";
        const categoryMatch = descText.match(/\[Category:\s*([^\]]+)\]/i);
        if (categoryMatch) {
          category = categoryMatch[1].trim();
        }
        const tagsMatch = descText.match(/\[Tags:\s*([^\]]+)\]/i);
        if (tagsMatch) {
          tags = tagsMatch[1].split(",").map((t: string) => t.trim()).filter(Boolean);
        }

        // Clean the description by removing metadata tags for display
        const cleanDescription = descText
          .replace(/\[Category:\s*[^\]]+\]/gi, "")
          .replace(/\[Tags:\s*[^\]]+\]/gi, "")
          .trim() || "Grounded RAG AI Expert with verified knowledge base.";

        dynamicItems.push({
          id: exp.id,
          type: "smart_assistant",
          title: exp.name,
          description: cleanDescription,
          category,
          author: {
            name: authorName,
            avatarUrl: profile?.avatar_url || undefined,
            isVerified,
            role: profile?.role || undefined,
          },
          baseModel: "RAG AI Expert",
          likesCount: exp.likes_count || 0,
          chatsCount: exp.chats_count || 0,
          publishedAt: exp.created_at,
          chatUrl: `/experts/${exp.id}/chat`,
          tags,
          isVerified,
          ownerId: exp.user_id,
          hasLiked: userLikedIds.has(exp.id),
        });
      }
    }

    if (dbJobs && dbJobs.length > 0) {
      for (const job of dbJobs) {
        const config = (typeof job.config === "object" && job.config !== null && !Array.isArray(job.config)) 
          ? (job.config as Record<string, unknown>) 
          : {};
        if (config.published) {
          const profile = profileMap.get(job.user_id);
          const authorName = profile?.full_name || "Community Creator";
          const isVerified = isVerifiedAdmin(profile);

          dynamicItems.push({
            id: job.id,
            type: "fine_tuned",
            title: (config.public_title as string) || job.name,
            description: (config.public_description as string) || `Fine-tuned ${job.base_model} model trained with custom dataset.`,
            category: (config.category as string) || "General",
            author: {
              name: authorName,
              avatarUrl: profile?.avatar_url || undefined,
              isVerified,
              role: profile?.role || undefined,
            },
            baseModel: `${job.base_model} (${job.method.toUpperCase()})`,
            likesCount: job.likes_count || 0,
            chatsCount: job.chats_count || 0,
            publishedAt: (config.published_at as string) || job.created_at,
            chatUrl: `/playground/${job.id}`,
            tags: (config.tags as string[]) || ["Fine-Tuned", job.base_model],
            isVerified,
            ownerId: job.user_id,
            hasLiked: userLikedIds.has(job.id),
          });
        }
      }
    }

    return NextResponse.json({ ok: true, models: dynamicItems });
  } catch (err: unknown) {
    console.error("[Community API Error]:", err);
    return NextResponse.json({ ok: true, models: [] });
  }
}

export async function PATCH(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { id, type, title, description } = body;

    if (!id || !type) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    if (type === "smart_assistant") {
      const { error } = await supabase
        .from("experts")
        .update({ name: title, description })
        .eq("id", id)
        .eq("user_id", user.id);
      if (error) throw error;
    } else if (type === "fine_tuned") {
      const { data: jobData, error: jobError } = await supabase
        .from("jobs")
        .select("config")
        .eq("id", id)
        .eq("user_id", user.id)
        .single();
      
      if (jobError || !jobData) throw jobError || new Error("Job not found");
      
      const config = (typeof jobData.config === "object" && jobData.config !== null && !Array.isArray(jobData.config)) 
        ? (jobData.config as Record<string, unknown>) 
        : {};
      
      config.public_title = title;
      config.public_description = description;

      const { error: updateError } = await supabase
        .from("jobs")
        .update({ config: config as import("@/lib/supabase/types").Json })
        .eq("id", id)
        .eq("user_id", user.id);
      if (updateError) throw updateError;
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    console.error("[Community API Patch Error]:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}
