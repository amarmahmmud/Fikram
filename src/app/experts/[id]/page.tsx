import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function ExpertPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  // Exact standard UUID match -> redirect to chat directly
  if (uuidRegex.test(id)) {
    redirect(`/experts/${id}/chat`);
  }

  // Handle prefix match (e.g., truncated UUID from copy-paste) or slug match
  try {
    const supabase = await createClient();
    const { data: experts } = await supabase
      .from("experts")
      .select("id, slug")
      .limit(100);

    const matched = experts?.find(
      (e) =>
        e.id.toLowerCase().startsWith(id.toLowerCase()) ||
        (e.slug && e.slug.toLowerCase() === id.toLowerCase())
    );

    if (matched) {
      redirect(`/experts/${matched.id}/chat`);
    }
  } catch {
    // If lookup fails, redirect to chat anyway
  }

  redirect(`/experts/${id}/chat`);
}
