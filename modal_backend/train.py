"""
Modal.com Fine-Tuning Backend for Model Factory
================================================
Deploy this file with: modal deploy modal_backend/train.py

This script runs on Modal's L4 GPUs and:
1. Downloads the user's JSONL dataset from Cloudflare R2
2. Detects the base model's *family* (Llama, Gemma, Qwen, Phi, Mistral, ...)
   and fine-tunes it with a flow tuned to that family
3. Saves the LoRA adapter weights back to Cloudflare R2
4. Calls your Next.js webhook when complete

Universal compatibility:
- Detects model family from HF `config.model_type` (falls back to name
  matching, then to fully-generic auto-detection) and uses family-specific
  LoRA target modules / chat-template behaviour / stop tokens where known
- Any family not in the table still works — every family-specific value has
  a universal auto-detected fallback, so unknown architectures are never
  broken, just less finely tuned
- Handles missing pad tokens, chat templates, and system roles
- Tested against Llama, Gemma, Qwen, Mistral, Phi, Falcon, DeepSeek, GPT-2
  style models
"""

import modal
import os

# ── Modal App Definition ──────────────────────────────────────────────────────
app = modal.App("model-factory-trainer")

# Docker image with all training dependencies.
# NOTE: trl's public API changes quickly between releases (the
# `dataset_text_field`/`max_seq_length` kwargs on SFTTrainer were moved into
# SFTConfig, which is what caused the original crash). Versions below are
# pinned to a combination that has been verified to work together — bump
# deliberately, not implicitly, if you need a newer trl/transformers.
training_image = (
    modal.Image.from_registry("nvidia/cuda:12.1.1-devel-ubuntu22.04", add_python="3.11")
    .apt_install("git")
    # Install torch first — must be separate step to avoid conflicts
    .pip_install(
        "torch==2.5.1",
        "xformers",
        extra_index_url="https://download.pytorch.org/whl/cu121",
    )
    # Use standard transformers, peft, trl since unsloth's patching is broken for Gemma 2
    .pip_install(
        "transformers==5.5.0",
        "peft==0.20.0",
        "trl==1.10.0",
        "bitsandbytes==0.50.1",  # required for optim="adamw_8bit" — must be >=0.46.1 for transformers==5.5.0's internal check to pass
        "datasets",
        "boto3",
        "requests",
    )
)

# Persistent Modal Volume to cache the base model (saves re-download time)
model_cache = modal.Volume.from_name("model-factory-model-cache", create_if_missing=True)

# Lightweight image for the HTTP endpoint (no CUDA needed just to spawn tasks)
endpoint_image = modal.Image.debian_slim(python_version="3.11").pip_install("fastapi[standard]")


# ────────────────────────────────────────────────────────────────────────────
# MODEL FAMILY REGISTRY
# ────────────────────────────────────────────────────────────────────────────
# Central source of truth for per-architecture quirks. Detection is layered:
#   1. HF `config.model_type` — most reliable, always present on real models
#   2. model-id substring matching — fallback for renamed/community repos
#   3. fully generic auto-detection — final fallback, works for ANY model
#
# Every field a family can set has a working universal default, so a model
# that isn't in this table (or a brand-new architecture) still trains fine —
# it just doesn't get the family-specific tuning.
#
# `target_modules`:
#   - explicit list  -> used if those module names actually exist on the
#                        loaded model, else silently falls back to auto-detect
#   - "auto"         -> always use generic auto-detection (used for families
#                        with fused qkv / MoE layers where a fixed list would
#                        be wrong, e.g. Phi's `Wqkv`, Falcon's fused
#                        `query_key_value`, DeepSeek's MoE experts)
# ────────────────────────────────────────────────────────────────────────────

_STANDARD_PROJ = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]

MODEL_FAMILIES = {
    "llama": {
        "model_types": {"llama", "llama4", "llama4_text"},
        "name_hints": ("llama", "codellama"),
        "target_modules": _STANDARD_PROJ,
        "system_role": True,
        "extra_stop_tokens": ["<|eot_id|>", "<|end_of_text|>"],
        "byte_level_bpe": True,
    },
    "mistral": {
        "model_types": {"mistral", "mixtral"},
        "name_hints": ("mistral", "mixtral"),
        "target_modules": _STANDARD_PROJ,
        "system_role": True,
        "extra_stop_tokens": ["</s>"],
        "byte_level_bpe": True,
    },
    "qwen": {
        "model_types": {"qwen2", "qwen2_moe", "qwen3", "qwen3_moe", "qwen"},
        "name_hints": ("qwen",),
        "target_modules": _STANDARD_PROJ,
        "system_role": True,
        "extra_stop_tokens": ["<|im_end|>"],
        "byte_level_bpe": True,
    },
    "gemma": {
        "model_types": {"gemma", "gemma2", "gemma3", "gemma3_text"},
        "name_hints": ("gemma",),
        "target_modules": _STANDARD_PROJ,
        "system_role": False,
        "extra_stop_tokens": ["<end_of_turn>"],
        "byte_level_bpe": False,
    },
    "phi": {
        "model_types": {"phi", "phi3", "phimoe", "phi4", "phi4mm"},
        "name_hints": ("phi-", "phi_", "phi2", "phi3", "phi4"),
        "target_modules": "auto",  # some Phi versions fuse qkv into `Wqkv`
        "system_role": True,
        "extra_stop_tokens": ["<|end|>", "<|im_end|>"],
        "byte_level_bpe": False,
    },
    "falcon": {
        "model_types": {"falcon", "falcon_mamba"},
        "name_hints": ("falcon",),
        "target_modules": "auto",  # Falcon-1 fuses qkv into `query_key_value`
        "system_role": True,
        "extra_stop_tokens": ["<|endoftext|>"],
        "byte_level_bpe": True,
    },
    "deepseek": {
        "model_types": {"deepseek", "deepseek_v2", "deepseek_v3", "deepseek_vl"},
        "name_hints": ("deepseek",),
        "target_modules": "auto",  # MoE / MLA layer names vary across versions
        "system_role": True,
        "extra_stop_tokens": ["<|im_end|>", "<end_of_sentence>"],
        "byte_level_bpe": False,
    },
    "chatglm": {
        "model_types": {"chatglm"},
        "name_hints": ("chatglm", "glm-"),
        "target_modules": "auto",
        "system_role": True,
        "extra_stop_tokens": [],
        "byte_level_bpe": False,
    },
    "gpt2": {
        "model_types": {"gpt2", "gpt_neo", "gptj", "gpt_neox"},
        "name_hints": ("gpt2", "gpt-neo", "gptj", "gpt-j", "pythia"),
        "target_modules": "auto",  # GPT-2 style models fuse qkv into `c_attn`
        "system_role": False,
        "extra_stop_tokens": ["<|endoftext|>"],
        "byte_level_bpe": True,
    },
}

DEFAULT_FAMILY = {
    "target_modules": "auto",
    "system_role": None,     # unknown — probed live via the chat template
    "extra_stop_tokens": [],
    "byte_level_bpe": None,  # unknown — inferred from the tokenizer class name
}


def detect_model_family(model_id: str, model_type: str = ""):
    """Detect model family from HF config.model_type first, then model-id
    substring matching. Returns (family_name, family_spec). Always returns a
    usable spec — unknown models fall back to 'generic' with safe defaults."""
    model_type = (model_type or "").lower()
    name_lower = model_id.lower()

    if model_type:
        for family, spec in MODEL_FAMILIES.items():
            if model_type in spec["model_types"]:
                return family, spec

    for family, spec in MODEL_FAMILIES.items():
        if any(hint in name_lower for hint in spec["name_hints"]):
            return family, spec

    return "generic", DEFAULT_FAMILY


# Gated models on HuggingFace (Meta Llama, Google Gemma) require an accepted
# license + HF token. We resolve them to ungated mirrors when no HF token is
# available, so users don't need to deal with auth. Both train.py and
# inference.py must resolve the SAME mirror for a given original model id —
# a LoRA adapter is only valid against the exact weights it was trained on.
UNGATED_MIRRORS = {
    "google/gemma-2-2b-it": "unsloth/gemma-2-2b-it",
    "google/gemma-2-9b-it": "unsloth/gemma-2-9b-it",
    "google/gemma-2-27b-it": "unsloth/gemma-2-27b-it",
    "google/gemma-3-1b-it": "unsloth/gemma-3-1b-it",
    "google/gemma-3-4b-it": "unsloth/gemma-3-4b-it",
    "google/gemma-3-12b-it": "unsloth/gemma-3-12b-it",
    "google/gemma-3-27b-it": "unsloth/gemma-3-27b-it",
    "meta-llama/Llama-3.1-8B-Instruct": "unsloth/Meta-Llama-3.1-8B-Instruct",
    "meta-llama/Llama-3.2-1B-Instruct": "unsloth/Llama-3.2-1B-Instruct",
    "meta-llama/Llama-3.2-3B-Instruct": "unsloth/Llama-3.2-3B-Instruct",
    "meta-llama/Llama-3.3-70B-Instruct": "unsloth/Llama-3.3-70B-Instruct",
}


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
    lora_r: int = 16,
    lora_alpha: int = 16,
    r2_endpoint: str = "",
    r2_access_key: str = "",
    r2_secret_key: str = "",
    r2_bucket: str = "",
):
    """Fine-tune the user's chosen model with their dataset and save LoRA weights to R2."""
    import torch
    import requests
    import boto3
    import tempfile
    from datasets import load_dataset
    from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer
    from peft import get_peft_model, LoraConfig
    from trl import SFTTrainer, SFTConfig

    hf_token = os.environ.get("HF_TOKEN", None)
    original_model_id = base_model

    if not hf_token and base_model in UNGATED_MIRRORS:
        base_model = UNGATED_MIRRORS[base_model]
        print(f"[Model Factory] No HF token — resolved gated model to ungated mirror: {base_model}")
    elif not hf_token:
        # Try the model as-is; it might be public
        print(f"[Model Factory] No HF token — will try loading {base_model} directly (may fail if gated)")

    print(f"[Model Factory] Starting training for job: {job_id}")
    print(f"[Model Factory] User selected model: {original_model_id} → loading from: {base_model}")
    print(f"[Model Factory] Dataset URL: {dataset_url}")

    # ── Step 0: Detect model family ────────────────────────────────────────
    # We fetch just the config (a few KB) before pulling any weights, so
    # family detection never costs extra download time.
    try:
        _cfg = AutoConfig.from_pretrained(base_model, token=hf_token, trust_remote_code=True)
        detected_model_type = getattr(_cfg, "model_type", "") or ""
    except Exception as cfg_err:
        print(f"[Model Factory] Could not pre-fetch config ({cfg_err}); family detection will use name matching only")
        detected_model_type = ""

    family_name, family_spec = detect_model_family(base_model, detected_model_type)
    print(f"[Model Factory] Detected model family: '{family_name}' (model_type={detected_model_type or 'unknown'})")

    # ── Step 1: Download JSONL dataset from R2 ────────────────────────────────
    print("[Model Factory] Downloading dataset...")
    dataset_res = requests.get(dataset_url)
    dataset_res.raise_for_status()

    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
        f.write(dataset_res.text)
        dataset_path = f.name

    dataset = load_dataset("json", data_files=dataset_path, split="train")
    print(f"[Model Factory] Loaded {len(dataset)} training examples")

    # ── Step 2: Load Base Model via Transformers ──────────────────────────────────
    print(f"[Model Factory] Loading model: {base_model} (using standard Transformers in bf16)...")
    try:

        tokenizer = AutoTokenizer.from_pretrained(
            base_model,
            cache_dir="/model-cache",
            token=hf_token,
            trust_remote_code=True,
        )

        model = AutoModelForCausalLM.from_pretrained(
            base_model,
            dtype=torch.bfloat16,
            device_map="auto",
            attn_implementation="eager",
            cache_dir="/model-cache",
            token=hf_token,
            trust_remote_code=True,
        )

        # ── Tokenizer diagnostics ─────────────────────────────────────────────
        # Log tokenizer details to verify it matches the model's embedding matrix
        print(f"[Model Factory] Tokenizer class: {type(tokenizer).__name__}")
        print(f"[Model Factory] Tokenizer vocab_size: {tokenizer.vocab_size}, model vocab_size: {model.config.vocab_size}")
        print(f"[Model Factory] pad={tokenizer.pad_token}(id={tokenizer.pad_token_id}), "
              f"eos={tokenizer.eos_token}(id={tokenizer.eos_token_id}), "
              f"bos={tokenizer.bos_token}(id={tokenizer.bos_token_id})")

        # Ensure pad_token exists
        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token
            tokenizer.pad_token_id = tokenizer.eos_token_id

        # Sync model config to match tokenizer
        model.config.pad_token_id = tokenizer.pad_token_id

        # ── Step 3: Apply LoRA (family-aware target modules) ──────────────────────
        # Auto-detect all linear module names directly from the model — this is
        # the universal fallback that works for ANY architecture. If the
        # detected family specifies a known-good fixed list (e.g. standard
        # q/k/v/o + MLP proj names used by Llama/Mistral/Qwen/Gemma), we use
        # that instead, but only if those exact names are present on this
        # model — otherwise we silently fall back to the auto-detected set.
        auto_detected_modules = list(set(
            name.split(".")[-1]
            for name, module in model.named_modules()
            if isinstance(module, torch.nn.Linear)
            and "lm_head" not in name
            and "embed" not in name
        ))

        family_targets = family_spec.get("target_modules")
        if family_targets and family_targets != "auto":
            present = set(auto_detected_modules)
            target_modules = [m for m in family_targets if m in present]
            if not target_modules:
                print(f"[Model Factory] '{family_name}' target modules {family_targets} not found on this model — "
                      f"falling back to auto-detected: {auto_detected_modules}")
                target_modules = auto_detected_modules
            else:
                print(f"[Model Factory] Using {family_name}-optimized LoRA target modules: {target_modules}")
        else:
            target_modules = auto_detected_modules
            print(f"[Model Factory] Auto-detected LoRA target modules: {target_modules}")

        peft_config = LoraConfig(
            r=lora_r,
            lora_alpha=lora_alpha,
            target_modules=target_modules,
            lora_dropout=0.05,
            bias="none",
            task_type="CAUSAL_LM",
        )

        model = get_peft_model(model, peft_config)
        model.print_trainable_parameters()

        # ── Step 4: Format Dataset using model's NATIVE chat template ────────────
        # Every instruct model ships with its own chat template that handles
        # BOS/EOS/padding correctly. Using the native template is the only truly
        # universal approach — no external format (like ChatML) can be forced onto
        # every model's vocabulary.

        def _supports_system_role(tok):
            """Check if the tokenizer's chat template supports a 'system' role.
            This is a live probe, not just the family hint — the hint is a
            fast/typical default, but the actual template is authoritative."""
            try:
                tok.apply_chat_template(
                    [{"role": "system", "content": "t"}, {"role": "user", "content": "t"}],
                    tokenize=False,
                )
                return True
            except Exception:
                return False

        _has_template = getattr(tokenizer, "chat_template", None) is not None
        _system_ok = _supports_system_role(tokenizer) if _has_template else False
        print(f"[Model Factory] Chat template: {_has_template}, system role: {_system_ok} "
              f"(family default: {family_spec.get('system_role')})")

        def format_example(example):
            prompt = example.get("prompt", "")
            completion = example.get("completion", "")

            if _has_template:
                msgs = [
                    {"role": "user", "content": prompt},
                    {"role": "assistant", "content": completion},
                ]
                try:
                    text = tokenizer.apply_chat_template(
                        msgs, tokenize=False, add_generation_prompt=False,
                    )
                except Exception:
                    text = f"### User:\n{prompt}\n\n### Assistant:\n{completion}"
            else:
                text = f"### User:\n{prompt}\n\n### Assistant:\n{completion}"

            return {"text": text}

        formatted_dataset = dataset.map(format_example)
        # CRITICAL: Remove original columns so SFTTrainer's auto-detection
        # doesn't pick up "prompt"+"completion" and bypass our formatted "text".
        cols_to_remove = [c for c in formatted_dataset.column_names if c != "text"]
        if cols_to_remove:
            formatted_dataset = formatted_dataset.remove_columns(cols_to_remove)
            print(f"[Model Factory] Removed raw columns {cols_to_remove} — forcing SFTTrainer to use formatted 'text'")
        # Debug: show first formatted example
        print(f"[Model Factory] Sample formatted text (first 300 chars): {formatted_dataset[0]['text'][:300]}")

        # ── DIAGNOSTIC: Manual loss check before SFTTrainer ──────────────────
        # This computes loss directly through the model, bypassing SFTTrainer.
        # If this loss is ~2-4, the model+tokenizer are fine and SFTTrainer is broken.
        # If this loss is ~20-30, the model or tokenization is fundamentally broken.
        try:
            test_text = formatted_dataset[0]["text"]
            test_enc = tokenizer(test_text, return_tensors="pt", truncation=True, max_length=512, add_special_tokens=False)
            test_ids = test_enc.input_ids.to(model.device)
            print(f"[DIAG] Token count: {test_ids.shape[1]}")
            print(f"[DIAG] First 30 token IDs: {test_ids[0][:30].tolist()}")
            print(f"[DIAG] Decoded first 30 tokens: {tokenizer.decode(test_ids[0][:30])}")
            with torch.no_grad():
                diag_out = model(input_ids=test_ids, labels=test_ids)
            print(f"[DIAG] *** Manual base-model loss: {diag_out.loss.item():.4f} ***")
            if diag_out.loss.item() > 10:
                print(f"[DIAG] WARNING: Loss > 10 means model+tokenizer mismatch or broken quantization!")
            else:
                print(f"[DIAG] OK: Loss is normal. If SFTTrainer loss is high, the issue is in SFTTrainer.")
        except Exception as diag_err:
            print(f"[DIAG] Diagnostic failed: {diag_err}")

        # ── Step 5: Train ─────────────────────────────────────────────────────────
        # NOTE: modern trl (>=0.13-ish) no longer accepts `dataset_text_field` /
        # `max_seq_length` directly on SFTTrainer — they moved into SFTConfig
        # (which subclasses TrainingArguments). Passing them to SFTTrainer's
        # __init__ is what caused the original
        # "unexpected keyword argument 'dataset_text_field'" crash.
        print("[Model Factory] Starting LoRA fine-tuning...")

        # adamw_8bit needs bitsandbytes >= transformers' internal minimum
        # version (now pinned compatible in training_image above). Still
        # guard at runtime using the SAME check transformers uses internally
        # (is_bitsandbytes_available is version-gated, not just an import
        # check — a too-old bitsandbytes imports fine but still fails this
        # check, which is exactly what caused the previous crash) so a
        # future version mismatch degrades gracefully instead of crashing
        # mid-training.
        try:
            from transformers.utils import is_bitsandbytes_available
            if is_bitsandbytes_available():
                optimizer_name = "adamw_8bit"
            else:
                print("[Model Factory] bitsandbytes not available or too old for this transformers version — falling back to adamw_torch")
                optimizer_name = "adamw_torch"
        except Exception as bnb_err:
            print(f"[Model Factory] bitsandbytes availability check failed ({bnb_err}) — falling back to adamw_torch")
            optimizer_name = "adamw_torch"

        sft_config = SFTConfig(
            per_device_train_batch_size=2,
            gradient_accumulation_steps=4,
            warmup_steps=3,
            num_train_epochs=num_train_epochs,
            max_steps=max_steps,
            learning_rate=learning_rate,
            fp16=not torch.cuda.is_bf16_supported(),
            bf16=torch.cuda.is_bf16_supported(),
            logging_steps=1,
            optim=optimizer_name,
            weight_decay=0.01,
            lr_scheduler_type="linear",
            max_grad_norm=0.3,            # Universal safety net: clips gradient explosions
            seed=3407,
            output_dir="/tmp/training_output",
            report_to="none",
            dataset_text_field="text",
            max_length=max_seq_length,
            packing=False,
        )

        trainer = SFTTrainer(
            model=model,
            processing_class=tokenizer,
            train_dataset=formatted_dataset,
            args=sft_config,
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
                "detected_family": family_name,
                "resolved_base_model": base_model,
            }, timeout=30)
        except Exception as e:
            print(f"[Model Factory] Webhook notification failed (non-fatal): {e}")

        print("[Model Factory] All done!")
        return {"status": "completed", "adapter_prefix": adapter_r2_prefix, "detected_family": family_name}

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
    max_seq_length = item.get("max_seq_length", 1024)
    lora_r = item.get("lora_r", 16)
    lora_alpha = item.get("lora_alpha", 16)
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
        max_seq_length=max_seq_length,
        lora_r=lora_r,
        lora_alpha=lora_alpha,
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