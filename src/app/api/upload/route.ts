import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIP, ANON_CHAT_LIMIT, AUTH_CHAT_LIMIT } from "@/lib/rate-limiter";

const s3 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
});

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    // Rate limiting: prevent abuse of the upload endpoint
    const rateLimitKey = user ? `upload_user:${user.id}` : `upload_ip:${getClientIP(req)}`;
    const rateLimitConfig = user ? AUTH_CHAT_LIMIT : ANON_CHAT_LIMIT; // Re-use chat limits for simplicity
    const { allowed, resetMs } = checkRateLimit(rateLimitKey, rateLimitConfig);

    if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) } }
      );
    }

    const { filename, contentType } = await req.json();
    if (!filename) return NextResponse.json({ error: "Filename is required" }, { status: 400 });

    const bucket = process.env.R2_BUCKET_NAME!;
    
    // Create a safe, unique file key organized by user (or temp directory for anonymous)
    const safeName = filename.replace(/[^a-zA-Z0-9.\-_]/g, "");
    const fileKey = user 
      ? `datasets/${user.id}/${Date.now()}-${safeName}`
      : `temp/anonymous/${Date.now()}-${safeName}`;

    // 1. Generate PUT url for the browser to upload the file directly to R2 (expires in 1 hour)
    const putCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: fileKey,
      ContentType: contentType || "application/octet-stream",
    });
    const uploadUrl = await getSignedUrl(s3, putCommand, { expiresIn: 3600 });

    // 2. Generate GET url for secure download later (expires in 7 days)
    const getCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: fileKey,
    });
    const downloadUrl = await getSignedUrl(s3, getCommand, { expiresIn: 7 * 24 * 60 * 60 });

    return NextResponse.json({ ok: true, uploadUrl, downloadUrl, fileKey });
  } catch (err: unknown) {
    console.error("Upload API error:", err);
    return NextResponse.json({ error: "Failed to generate upload URL" }, { status: 500 });
  }
}
