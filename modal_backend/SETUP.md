# Modal Backend Setup Guide

## Step 1 — Sign Up for Modal

1. Go to **https://modal.com** and create a free account
2. You get **$30/month free credit** (≈ 100 fine-tuning jobs)

## Step 2 — Install Modal CLI

Run this in your terminal (Python required):
```bash
pip install modal
```

## Step 3 — Set Your Modal Token

Go to https://modal.com → **Settings → API Tokens** → Create Token

Then run:
```bash
modal token set --token-id YOUR_TOKEN_ID --token-secret YOUR_TOKEN_SECRET
```

Also paste them into your `.env.local`:
```
MODAL_TOKEN_ID="your-token-id"
MODAL_TOKEN_SECRET="your-token-secret"
```

## Step 4 — Set Modal Secrets (R2 credentials)

Your Modal training script needs your R2 credentials to download datasets. Run:
```bash
modal secret create model-factory-r2 \
  AWS_ACCESS_KEY_ID=0110c69591d0958a63da826e61db7786 \
  AWS_SECRET_ACCESS_KEY=6f04c58e19da6dbd3fc4c7257912ceaea1f050ce9caa5beb4a3a9785dc329b22 \
  R2_ENDPOINT=https://ff2a21f0d19f9614496c82086cac9b62.r2.cloudflarestorage.com \
  R2_BUCKET=model-factory-datasets
```

## Step 5 — Deploy the Training Backend

From your project root:
```bash
cd C:\Users\asus\Desktop\software\model-factory
modal deploy modal_backend/train.py
```

This will output something like:
```
✓ Created function model-factory-trainer/train_model
```

## Step 6 — Deploy the Inference Endpoint

```bash
modal deploy modal_backend/inference.py
```

This will output a URL like:
```
https://your-workspace--model-factory-inference-modelinference-generate.modal.run
```

**Copy that URL and paste it into `.env.local` as `MODAL_INFERENCE_URL`**

## Step 7 — Test!

1. Launch a new job with any text file
2. Check https://modal.com/apps — you should see "model-factory-trainer" running
3. After ~15 mins, your Supabase job will update to "completed"
4. Open the Playground and chat!
