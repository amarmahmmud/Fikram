import { S3Client, PutBucketCorsCommand } from "@aws-sdk/client-s3";

async function setCors() {
  const s3Client = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });

  const corsRules = {
    CORSRules: [
      {
        AllowedHeaders: ["*"],
        AllowedMethods: ["GET", "PUT", "POST", "DELETE", "HEAD"],
        AllowedOrigins: ["*"], // In production, restrict this to your domain
        ExposeHeaders: ["ETag"],
        MaxAgeSeconds: 3000,
      },
    ],
  };

  try {
    const command = new PutBucketCorsCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      CORSConfiguration: corsRules,
    });
    await s3Client.send(command);
    console.log("✅ Successfully updated CORS policy on Cloudflare R2 bucket!");
  } catch (err) {
    console.error("❌ Failed to set CORS:", err);
  }
}

setCors();
