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
  };
  baseModel?: string;
  likesCount: number;
  chatsCount: number;
  publishedAt: string;
  chatUrl: string;
  tags: string[];
  isVerified?: boolean;
  ownerId?: string;
}

const FEATURED_COMMUNITY_MODELS: CommunityItem[] = [
  {
    id: "featured-1",
    type: "smart_assistant",
    title: "SaaS Financial & Tax Advisor",
    description: "Expert assistant grounded on US & International tax law, SaaS metrics (ARR, CAC, LTV), and startup accounting best practices.",
    category: "Finance",
    author: { name: "Elena Rostova", avatarUrl: "" },
    baseModel: "Grounded RAG (Gemini + PDF Knowledge Base)",
    likesCount: 142,
    chatsCount: 1890,
    publishedAt: "2026-08-15T10:00:00Z",
    chatUrl: "/experts/new",
    tags: ["Finance", "SaaS", "Tax", "Startups"],
    isVerified: true,
  },
  {
    id: "featured-2",
    type: "fine_tuned",
    title: "TypeScript Fullstack Architect",
    description: "Fine-tuned on 100k+ modern Next.js 15, TypeScript 5, Tailwind, and Supabase clean code architecture examples.",
    category: "Coding",
    author: { name: "Antigravity Lab", avatarUrl: "" },
    baseModel: "Llama 3.1 8B (LoRA)",
    likesCount: 384,
    chatsCount: 4210,
    publishedAt: "2026-08-18T14:30:00Z",
    chatUrl: "/new-job",
    tags: ["TypeScript", "Next.js", "Architecture", "LoRA"],
    isVerified: true,
  },
  {
    id: "featured-3",
    type: "smart_assistant",
    title: "Medical Research Navigator",
    description: "Synthesizes recent clinical trials, PubMed abstracts, and pharmacology papers with instant source citations.",
    category: "Healthcare",
    author: { name: "Dr. Marcus Vance", avatarUrl: "" },
    baseModel: "Grounded RAG (Llama 3.1 70B)",
    likesCount: 215,
    chatsCount: 2430,
    publishedAt: "2026-08-20T09:15:00Z",
    chatUrl: "/experts/new",
    tags: ["Medicine", "Research", "Citations"],
    isVerified: true,
  },
  {
    id: "featured-4",
    type: "fine_tuned",
    title: "B2B Copywriting Specialist",
    description: "Trained on high-converting landing pages, cold emails, and VC pitch decks. Writes punchy, crisp marketing copy.",
    category: "Writing",
    author: { name: "Fikram Community", avatarUrl: "" },
    baseModel: "Mistral 7B v0.3 (LoRA)",
    likesCount: 198,
    chatsCount: 3100,
    publishedAt: "2026-08-22T16:45:00Z",
    chatUrl: "/new-job",
    tags: ["Marketing", "Copywriting", "Mistral"],
    isVerified: true,
  },
];

export async function GET() {
  try {
    const supabase = await createClient();

    // 1. Fetch published experts
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

    const dynamicItems: CommunityItem[] = [];

    if (dbExperts && dbExperts.length > 0) {
      for (const exp of dbExperts) {
        dynamicItems.push({
          id: exp.id,
          type: "smart_assistant",
          title: exp.name,
          description: exp.description || "Grounded smart assistant with verified knowledge base.",
          category: "General",
          author: { name: "Creator" },
          baseModel: "Smart Assistant (RAG)",
          likesCount: exp.likes_count || 0,
          chatsCount: exp.chats_count || 0,
          publishedAt: exp.created_at,
          chatUrl: `/experts/${exp.id}/chat`,
          tags: ["Knowledge Base", "Q&A"],
          isVerified: false,
          ownerId: exp.user_id,
        });
      }
    }

    if (dbJobs && dbJobs.length > 0) {
      for (const job of dbJobs) {
        const config = (typeof job.config === "object" && job.config !== null && !Array.isArray(job.config)) 
          ? (job.config as Record<string, unknown>) 
          : {};
        if (config.published) {
          dynamicItems.push({
            id: job.id,
            type: "fine_tuned",
            title: (config.public_title as string) || job.name,
            description: (config.public_description as string) || `Fine-tuned ${job.base_model} model trained with custom dataset.`,
            category: (config.category as string) || "General",
            author: { name: "Creator" },
            baseModel: `${job.base_model} (${job.method.toUpperCase()})`,
            likesCount: job.likes_count || 0,
            chatsCount: job.chats_count || 0,
            publishedAt: (config.published_at as string) || job.created_at,
            chatUrl: `/playground/${job.id}`,
            tags: (config.tags as string[]) || ["Fine-Tuned", job.base_model],
            isVerified: false,
            ownerId: job.user_id,
          });
        }
      }
    }

    // Only return real dynamic creator models
    const allItems = [...dynamicItems];

    return NextResponse.json({ ok: true, models: allItems });
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
