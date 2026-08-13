import { NextResponse } from "next/server";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createClient } from "@/lib/supabase/server";

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
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { filename, contentType } = await req.json();
    if (!filename) return NextResponse.json({ error: "Filename is required" }, { status: 400 });

    const bucket = process.env.R2_BUCKET_NAME!;
    
    // Create a safe, unique file key organized by user
    const fileKey = `datasets/${user.id}/${Date.now()}-${filename.replace(/[^a-zA-Z0-9.\-_]/g, "")}`;

    // 1. Generate PUT url for the browser to upload the file directly to R2 (expires in 1 hour)
    const putCommand = new PutObjectCommand({
      Bucket: bucket,
      Key: fileKey,
      ContentType: contentType || "application/octet-stream",
    });
    const uploadUrl = await getSignedUrl(s3, putCommand, { expiresIn: 3600 });

    // 2. Generate GET url for Replicate to securely download the file later (expires in 7 days)
    const getCommand = new GetObjectCommand({
      Bucket: bucket,
      Key: fileKey,
    });
    const downloadUrl = await getSignedUrl(s3, getCommand, { expiresIn: 7 * 24 * 60 * 60 });

    return NextResponse.json({ ok: true, uploadUrl, downloadUrl });
  } catch (err: unknown) {
    console.error("Upload API error:", err);
    return NextResponse.json({ error: "Failed to generate upload URL" }, { status: 500 });
  }
}
