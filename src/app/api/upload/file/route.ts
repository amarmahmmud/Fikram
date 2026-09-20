import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit, getClientIP, ANON_CHAT_LIMIT, AUTH_CHAT_LIMIT } from "@/lib/rate-limiter";

export const maxDuration = 60;

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    // Rate limiting: prevent abuse of the upload endpoint
    const rateLimitKey = user ? `upload_user:${user.id}` : `upload_ip:${getClientIP(req)}`;
    const rateLimitConfig = user ? AUTH_CHAT_LIMIT : ANON_CHAT_LIMIT;
    const { allowed, resetMs } = await checkRateLimit(rateLimitKey, rateLimitConfig);

    if (!allowed) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again later." },
        { status: 429, headers: { "Retry-After": String(Math.ceil(resetMs / 1000)) } }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    const bucket = process.env.R2_BUCKET_NAME;
    if (!bucket || !process.env.CLOUDFLARE_ACCOUNT_ID || !process.env.R2_ACCESS_KEY_ID || !process.env.R2_SECRET_ACCESS_KEY) {
      throw new Error("Missing Cloudflare R2 environment variables");
    }

    const s3 = new S3Client({
      region: "auto",
      endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
    });

    const ext = file.name.includes(".") ? `.${file.name.split(".").pop()?.toLowerCase()}` : "";
    const baseName = file.name.replace(/\.[^/.]+$/, "");
    let cleanName = baseName.replace(/[^a-zA-Z0-9.\-_]/g, "_").replace(/_+/g, "_").slice(0, 60);
    if (!cleanName || cleanName === "_") {
      cleanName = `doc_${Date.now()}`;
    }
    const safeName = `${cleanName}${ext}`;
    const fileKey = user
      ? `datasets/${user.id}/${Date.now()}-${safeName}`
      : `temp/anonymous/${Date.now()}-${safeName}`;

    const buffer = Buffer.from(await file.arrayBuffer());

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: fileKey,
        Body: buffer,
        ContentType: file.type || "application/octet-stream",
      })
    );

    const getCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: fileKey,
    });
    const downloadUrl = await getSignedUrl(s3, getCommand, { expiresIn: 7 * 24 * 60 * 60 });

    return NextResponse.json({ ok: true, downloadUrl, fileKey });
  } catch (err: any) {
    console.error("Server upload fallback error:", err);
    return NextResponse.json({ error: err.message || "Upload failed" }, { status: 500 });
  }
}
