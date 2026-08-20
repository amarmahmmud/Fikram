"""
Modal.com Fine-Tuning Backend for Model Factory
================================================
Deploy this file with: modal deploy modal_backend/train.py

This script runs on Modal's A10G GPUs and:
1. Downloads the user's JSONL dataset from Cloudflare R2
2. Fine-tunes Llama 3 8B Instruct using Unsloth (LoRA)
3. Saves the LoRA adapter weights back to Cloudflare R2
4. Calls your Next.js webhook when complete
"""

import modal
import os

# ── Modal App Definition ──────────────────────────────────────────────────────
app = modal.App("model-factory-trainer")

# Docker image with all training dependencies
training_image = (
    modal.Image.from_registry("nvidia/cuda:12.1.1-devel-ubuntu22.04", add_python="3.11")
    .apt_install("git")
    # Install torch first — must be separate step to avoid conflicts
    .pip_install(
        "torch==2.3.0",
        "xformers",
        extra_index_url="https://download.pytorch.org/whl/cu121",
    )
    # Let unsloth pin its own compatible versions of trl/datasets/transformers
    .pip_install(
        "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git",
        "peft",
        "boto3",
        "requests",
    )
)

# Persistent Modal Volume to cache the base model (saves re-download time)
model_cache = modal.Volume.from_name("model-factory-model-cache", create_if_missing=True)

# Lightweight image for the HTTP endpoint (no CUDA needed just to spawn tasks)
endpoint_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]")

# ── Main Training Function ────────────────────────────────────────────────────
@app.function(
    image=training_image,
    gpu="L4",      # L4 is cheaper (~$0.80/hr) vs A10G (~$1.10/hr), still 24GB VRAM
    timeout=3600,
    volumes={"/model-cache": model_cache},
)
def train_model(
    job_id: str,
    dataset_url: str,
    webhook_url: str,
    base_model: str = "meta-llama/Llama-3.1-8B-Instruct",  # User's chosen model
    num_train_epochs: int = 1,      # Default 1 epoch to save cost
    learning_rate: float = 2e-4,
    max_seq_length: int = 1024,     # Smaller context = faster + less memory
    max_steps: int = 30,            # Hard cap: stops after 30 steps (~5 mins on L4)
    r2_endpoint: str = "",
    r2_access_key: str = "",
    r2_secret_key: str = "",
    r2_bucket: str = "",
):
    """Fine-tune the user's chosen model with their dataset and save LoRA weights to R2."""
    import torch
    import requests
    import boto3
    import json
    import tempfile
    from datasets import load_dataset
    from unsloth import FastLanguageModel
    from trl import SFTTrainer
    from transformers import TrainingArguments

    # ────────────────────────────────────────────────────────────────────────────
    # UNIVERSAL MODEL LOADING
    # Unsloth's FastLanguageModel.from_pretrained() automatically resolves ANY
    # HuggingFace model ID to its best available 4-bit quantized variant.
    # No manual mapping needed — this works with every model on HuggingFace.
    # ────────────────────────────────────────────────────────────────────────────

    print(f"[Model Factory] Starting training for job: {job_id}")
    print(f"[Model Factory] User selected model: {base_model}")
    print(f"[Model Factory] Dataset URL: {dataset_url}")

    # ── Step 1: Download JSONL dataset from R2 ────────────────────────────────
    print("[Model Factory] Downloading dataset...")
    dataset_res = requests.get(dataset_url)
    dataset_res.raise_for_status()

    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
        f.write(dataset_res.text)
        dataset_path = f.name

    dataset = load_dataset("json", data_files=dataset_path, split="train")
    print(f"[Model Factory] Loaded {len(dataset)} training examples")

    # ── Step 2: Load Base Model via Unsloth ───────────────────────────────────
    # Unsloth auto-resolves the HuggingFace model ID to its best 4-bit variant
    print(f"[Model Factory] Loading model: {base_model} (Unsloth will auto-resolve best variant)...")
    try:
        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=base_model,
            max_seq_length=max_seq_length,
            dtype=None,  # auto-detect
            load_in_4bit=True,  # 4-bit quantization for memory efficiency
            cache_dir="/model-cache",
        )

        # ── Step 3: Apply LoRA ────────────────────────────────────────────────────
        model = FastLanguageModel.get_peft_model(
            model,
            r=16,
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                             "gate_proj", "up_proj", "down_proj"],
            lora_alpha=16,
            lora_dropout=0,
            bias="none",
            use_gradient_checkpointing="unsloth",
            random_state=3407,
        )

        # ── Step 4: Format Dataset ────────────────────────────────────────────────
        # Use the tokenizer's own chat template instead of hardcoding Llama format.
        # This ensures DeepSeek, Mistral, Gemma, Phi, Qwen etc. all get the right format.
        def format_example(example):
            prompt = example.get("prompt", "")
            completion = example.get("completion", "")
            conversation = [
                {"role": "user", "content": prompt},
                {"role": "assistant", "content": completion},
            ]
            try:
                text = tokenizer.apply_chat_template(
                    conversation,
                    tokenize=False,
                    add_generation_prompt=False,
                )
            except Exception:
                # Fallback to simple format if chat template fails
                text = f"### User:\n{prompt}\n\n### Assistant:\n{completion}"
            return {"text": text}

        formatted_dataset = dataset.map(format_example)

        # ── Step 5: Train ─────────────────────────────────────────────────────────
        print("[Model Factory] Starting LoRA fine-tuning...")
        trainer = SFTTrainer(
            model=model,
            tokenizer=tokenizer,
            train_dataset=formatted_dataset,
            dataset_text_field="text",
            max_seq_length=max_seq_length,
            args=TrainingArguments(
                per_device_train_batch_size=2,
                gradient_accumulation_steps=4,
                warmup_steps=3,
                num_train_epochs=num_train_epochs,
                max_steps=max_steps,          # Hard cap to control cost
                learning_rate=learning_rate,
                fp16=not torch.cuda.is_bf16_supported(),
                bf16=torch.cuda.is_bf16_supported(),
                logging_steps=5,
                optim="adamw_8bit",
                output_dir="/tmp/training_output",
            ),
        )
        trainer.train()
        print("[Model Factory] Training complete!")

        # ── Step 6: Save & Upload LoRA Weights to R2 ─────────────────────────────
        adapter_dir = f"/tmp/adapter_{job_id}"
        model.save_pretrained(adapter_dir)
        tokenizer.save_pretrained(adapter_dir)

        print("[Model Factory] Uploading LoRA adapter to Cloudflare R2...")
        _r2_endpoint = r2_endpoint or os.environ.get("R2_ENDPOINT", "")
        _r2_access_key = r2_access_key or os.environ.get("AWS_ACCESS_KEY_ID", "")
        _r2_secret_key = r2_secret_key or os.environ.get("AWS_SECRET_ACCESS_KEY", "")
        _r2_bucket = r2_bucket or os.environ.get("R2_BUCKET", "")

        s3 = boto3.client(
            "s3",
            endpoint_url=_r2_endpoint,
            aws_access_key_id=_r2_access_key,
            aws_secret_access_key=_r2_secret_key,
            region_name="auto",
        )

        import os as _os
        for filename in _os.listdir(adapter_dir):
            filepath = _os.path.join(adapter_dir, filename)
            s3_key = f"adapters/{job_id}/{filename}"
            s3.upload_file(filepath, _r2_bucket, s3_key)
            print(f"[Model Factory] Uploaded: {s3_key}")

        adapter_r2_prefix = f"adapters/{job_id}"
        print(f"[Model Factory] Adapter saved at R2 prefix: {adapter_r2_prefix}")

        # ── Step 7: Notify Webhook ────────────────────────────────────────────────
        print(f"[Model Factory] Notifying webhook: {webhook_url}")
        try:
            requests.post(webhook_url, json={
                "job_id": job_id,
                "status": "completed",
                "adapter_prefix": adapter_r2_prefix,
            }, timeout=30)
        except Exception as e:
            print(f"[Model Factory] Webhook notification failed (non-fatal): {e}")

        print("[Model Factory] All done!")
        return {"status": "completed", "adapter_prefix": adapter_r2_prefix}

    except Exception as err:
        print(f"[Model Factory] Training error: {err}")
        try:
            requests.post(webhook_url, json={
                "job_id": job_id,
                "status": "failed",
                "error": str(err),
            }, timeout=30)
        except Exception as e:
            print(f"[Model Factory] Webhook error notification failed: {e}")
        raise err


# ── Web Endpoint to Trigger Training Asynchronously ───────────────────────────
@app.function(image=endpoint_image)
@modal.fastapi_endpoint(method="POST")
def start_training(item: dict):
    """
    HTTP POST endpoint that spawns train_model on an L4 GPU in the background.
    """
    job_id = item.get("job_id")
    dataset_url = item.get("dataset_url")
    webhook_url = item.get("webhook_url")
    num_train_epochs = item.get("num_train_epochs", 1)
    base_model = item.get("base_model", "meta-llama/Llama-3.1-8B-Instruct")
    learning_rate = item.get("learning_rate", 0.0002)
    max_steps = item.get("max_steps", 30)
    r2_endpoint = item.get("r2_endpoint", "")
    r2_access_key = item.get("r2_access_key", "")
    r2_secret_key = item.get("r2_secret_key", "")
    r2_bucket = item.get("r2_bucket", "")

    if not job_id or not dataset_url:
        return {"error": "Missing job_id or dataset_url", "status": "failed"}

    print(f"[Model Factory Endpoint] Spawning train_model for job {job_id} with model {base_model}...")
    call = train_model.spawn(
        job_id=job_id,
        dataset_url=dataset_url,
        webhook_url=webhook_url,
        base_model=base_model,
        num_train_epochs=num_train_epochs,
        learning_rate=learning_rate,
        max_steps=max_steps,
        r2_endpoint=r2_endpoint,
        r2_access_key=r2_access_key,
        r2_secret_key=r2_secret_key,
        r2_bucket=r2_bucket,
    )

    return {"status": "started", "call_id": call.object_id}


# ── Local test entry point ─────────────────────────────────────────────────────
@app.local_entrypoint()
def main():
    print("Modal training backend loaded. Deploy with: modal deploy modal_backend/train.py")

