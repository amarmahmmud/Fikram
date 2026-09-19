# Google Cloud Gemini-TTS Setup & Configuration

This guide details how to configure Google Cloud Platform (GCP) for the **Fikram "Listen" (Text-to-Speech)** feature using **Gemini-TTS** and the **Cloud Text-to-Speech API**.

---

## 1. Enable Required Google Cloud APIs

Ensure the following APIs are enabled in your Google Cloud Project:

1. **Cloud Text-to-Speech API** (`texttospeech.googleapis.com`):
   - Direct Console Link: [Enable Cloud Text-to-Speech API](https://console.developers.google.com/apis/api/texttospeech.googleapis.com/overview?project=model-factory-505311)
   - Or via `gcloud` CLI:
     ```bash
     gcloud services enable texttospeech.googleapis.com --project=model-factory-505311
     ```

2. **Vertex AI API** (`aiplatform.googleapis.com`):
   - Direct Console Link: [Enable Vertex AI API](https://console.cloud.google.com/marketplace/product/google/aiplatform.googleapis.com?project=model-factory-505311)
   - Or via `gcloud` CLI:
     ```bash
     gcloud services enable aiplatform.googleapis.com --project=model-factory-505311
     ```

---

## 2. Service Account Permissions

Ensure the service account running Fikram (`fikram@model-factory-505311.iam.gserviceaccount.com` or custom service account) has the following IAM roles assigned:

| IAM Role | Role ID | Purpose |
|---|---|---|
| **Vertex AI User** | `roles/aiplatform.user` | Grants `aiplatform.endpoints.predict` permission for Vertex AI / Gemini models |
| **Cloud Text-to-Speech Service Agent / User** | `roles/serviceusage.serviceUsageConsumer` | Allows calling Cloud Text-to-Speech API quota and endpoints |

To assign via `gcloud`:
```bash
# Assign Vertex AI User role
gcloud projects add-iam-policy-binding model-factory-505311 \
  --member="serviceAccount:fikram@model-factory-505311.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

# Assign Service Usage Consumer
gcloud projects add-iam-policy-binding model-factory-505311 \
  --member="serviceAccount:fikram@model-factory-505311.iam.gserviceaccount.com" \
  --role="roles/serviceusage.serviceUsageConsumer"
```

---

## 3. Environment Variables

In your `.env.local` (local development) or Vercel Environment Variables (production):

```bash
# GCP Project & Region (use "global" unless EU/US data residency is required)
GOOGLE_CLOUD_PROJECT=model-factory-505311
GOOGLE_CLOUD_REGION=global

# Service Account Credentials:
# For local dev: point to local JSON file
GOOGLE_APPLICATION_CREDENTIALS=./gcp-key.json

# For Vercel/serverless deployments: paste the JSON string (or base64 encoded JSON)
GOOGLE_APPLICATION_CREDENTIALS_JSON='{"type":"service_account",...}'

# Model configuration:
# gemini-2.5-flash-tts is the stable default
# gemini-3.1-flash-tts-preview is an optional upgrade path
GOOGLE_TTS_MODEL=gemini-2.5-flash-tts
```

---

## 4. Multi-Language & Preview Status Notes

- **Multi-language**: Responses are automatically analyzed to determine script and language code (e.g., `en-US`, `ar-XA`, `es-ES`, `fr-FR`, `de-DE`, `zh-CN`, `ja-JP`, `am-ET`).
- **Amharic (`am-ET`) Preview Status**:
  - Amharic is registered with `preview: true`.
  - If Google Cloud TTS responds that the requested voice or language is unavailable or in preview testing, the application catches `PREVIEW_UNAVAILABLE` and automatically disables the audio button with a friendly tooltip: *"Audio not available for this language yet"*.
