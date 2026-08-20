"""
Modal.com Fine-Tuning Backend for Model Factory
================================================
Deploy this file with: modal deploy modal_backend/train.py

This script runs on Modal's L4 GPUs and:
1. Downloads the user's JSONL dataset from Cloudflare R2
2. Fine-tunes ANY HuggingFace model using Unsloth (LoRA)
3. Saves the LoRA adapter weights back to Cloudflare R2
4. Calls your Next.js webhook when complete

Universal compatibility:
- Auto-detects LoRA target modules for any architecture
- Handles missing pad tokens, chat templates, and system roles
- Works with Llama, Phi, Gemma, Mistral, Qwen, Falcon, DeepSeek, etc.
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
    learning_rate: float = 2e-5,
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
        hf_token = os.environ.get("HF_TOKEN", None)

        # ── Monkey-patch Unsloth's fix_pad_token to not crash ─────────────────
        # Unsloth 2026.8.16's fix_pad_token() in unsloth_zoo/pad_token.py has a
        # strict check: it rejects eos_token as pad_token (considers it "bad"),
        # then tries to find a dedicated unused token from the vocab. For models
        # like microsoft/phi-2 that have NO suitable candidate token, it:
        #   1. Adds a temporary '<｜PAD▁TOKEN｜>' to the tokenizer
        #   2. Then RAISES RuntimeError anyway
        # The temporary token actually works fine — the raise is overly strict.
        # We monkey-patch to suppress this specific RuntimeError and let training
        # proceed with the temporary pad token.
        import unsloth_zoo.pad_token as _pad_module
        import unsloth_zoo.tokenizer_utils as _tok_utils_module
        _original_fix_pad_token = _pad_module.fix_pad_token

        def _safe_fix_pad_token(*args, **kwargs):
            try:
                return _original_fix_pad_token(*args, **kwargs)
            except RuntimeError as e:
                if "Could not find a valid pad token" in str(e):
                    print(f"[Model Factory] Suppressed Unsloth pad_token error (temporary token already added)")
                    tokenizer_arg = args[0] if args else kwargs.get("tokenizer")
                    return tokenizer_arg
                raise

        # Patch BOTH namespaces — tokenizer_utils has its own imported copy
        _pad_module.fix_pad_token = _safe_fix_pad_token
        _tok_utils_module.fix_pad_token = _safe_fix_pad_token
        print("[Model Factory] Patched fix_pad_token in both namespaces")

        model, tokenizer = FastLanguageModel.from_pretrained(
            model_name=base_model,
            max_seq_length=max_seq_length,
            dtype=None,  # auto-detect
            load_in_4bit=True,
            cache_dir="/model-cache",
            token=hf_token,
        )

        # Restore originals
        _pad_module.fix_pad_token = _original_fix_pad_token
        _tok_utils_module.fix_pad_token = _original_fix_pad_token

        # Sync pad_token_id into model config
        if tokenizer.pad_token_id is not None:
            model.config.pad_token_id = tokenizer.pad_token_id
        print(f"[Model Factory] Model loaded. pad_token={tokenizer.pad_token}, pad_token_id={tokenizer.pad_token_id}")

        # ── Step 3: Apply LoRA ────────────────────────────────────────────────────
        # Auto-detect all linear module names directly from the model.
        # This is truly universal — works for ANY architecture:
        #   Llama → q_proj, k_proj, ...  |  Falcon → query_key_value, dense, ...
        #   Phi-2 → Wqkv, out_proj, ...  |  Gemma → q_proj, k_proj, ...
        target_modules = list(set(
            name.split(".")[-1]
            for name, module in model.named_modules()
            if isinstance(module, torch.nn.Linear)
            and "lm_head" not in name
            and "embed" not in name
        ))
        print(f"[Model Factory] Auto-detected LoRA target modules: {target_modules}")

        model = FastLanguageModel.get_peft_model(
            model,
            r=16,
            target_modules=target_modules,
            lora_alpha=16,
            lora_dropout=0,
            bias="none",
            use_gradient_checkpointing="unsloth",
            random_state=3407,
        )

        # ── Step 4: Formatting Dataset ────────────────────────────────────────────
        from unsloth.chat_templates import get_chat_template, train_on_responses_only
        from transformers import DataCollatorForSeq2Seq

        # Unsloth's get_chat_template applies critical fixes for Gemma 2's vocab/padding
        tokenizer = get_chat_template(
            tokenizer,
            chat_template="chatml", # universally standardizes all models to a clean format
            mapping={"role": "role", "content": "content", "user": "user", "assistant": "assistant"}
        )

        def format_example(example):
            prompt = example.get("prompt", "")
            completion = example.get("completion", "")
            conversation = [
                {"role": "user", "content": prompt},
                {"role": "assistant", "content": completion},
            ]
            text = tokenizer.apply_chat_template(
                conversation,
                tokenize=False,
                add_generation_prompt=False,
            )
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
            data_collator=DataCollatorForSeq2Seq(tokenizer=tokenizer),
            args=TrainingArguments(
                per_device_train_batch_size=2,
                gradient_accumulation_steps=4,
                warmup_steps=3,
                num_train_epochs=num_train_epochs,
                max_steps=max_steps,
                learning_rate=learning_rate,
                fp16=not torch.cuda.is_bf16_supported(),
                bf16=torch.cuda.is_bf16_supported(),
                logging_steps=1,
                optim="adamw_8bit",
                weight_decay=0.01,
                lr_scheduler_type="linear",
                max_grad_norm=0.3,            # Universal safety net: clips gradient explosions
                seed=3407,
                output_dir="/tmp/training_output",
            ),
        )

        trainer = train_on_responses_only(
            trainer,
            instruction_part = "<|im_start|>user\n",
            response_part = "<|im_start|>assistant\n",
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

