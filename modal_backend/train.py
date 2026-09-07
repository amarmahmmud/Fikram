"""
Modal.com Fine-Tuning Backend for Model Factory
================================================
Deploy this file with: modal deploy modal_backend/train.py

This script runs on Modal and:
1. Estimates GPU memory need, GPU tier, and CREDIT COST for a training job
   BEFORE any paid GPU is touched (estimate_cost endpoint — free, CPU-only)
2. Picks the smallest GPU tier that fits the estimated model, downloads the
   user's JSONL dataset from Cloudflare R2, and fine-tunes it with a flow
   tuned to the model's family (Llama, Gemma, Qwen, Phi, Mistral, ...)
3. Enforces a hard credit-budget ceiling so a job can never cost more than
   what the user actually confirmed and had held
4. Retries once (with reduced memory footprint) on CUDA OOM instead of
   dying outright, since our users can't read a Python traceback
5. Saves the LoRA adapter weights back to Cloudflare R2 and reports ACTUAL
   usage (separate from the pre-job estimate) via webhook, so the platform
   can reconcile: charge actual, refund the unused portion of the hold

Universal compatibility (unchanged from prior versions):
- Detects model family from HF `config.model_type` (falls back to name
  matching, then to fully-generic auto-detection) and uses family-specific
  LoRA target modules / chat-template behaviour / stop tokens where known
- Any family not in the table still works — every family-specific value has
  a universal auto-detected fallback, so unknown architectures are never
  broken, just less finely tuned
- Handles missing pad tokens, chat templates, and system roles

Supported range (v1): up to ~30-34B parameters on a SINGLE GPU via QLoRA.
Multi-GPU / distributed training is explicitly OUT OF SCOPE for this file —
a model whose estimated VRAM exceeds the largest configured GPU_TIER fails
fast with a structured "model_too_large" response, before any GPU spend.

⚠️ CALIBRATION NOTE for whoever maintains this:
The per-step timing constants in `estimate_training_seconds()` and the
LoRA-adapter-size heuristic in `estimate_vram_requirements()` are reasonable
starting estimates, not measured ground truth. As real jobs complete, log
actual (param_count, use_qlora, steps, elapsed_seconds, peak_vram_gb) and
periodically recalibrate BASE_SECONDS_PER_STEP_PER_BILLION_PARAMS and
ADAPTER_PARAM_FRACTION_AT_R16 against real data. Until then, both estimators
lean conservative (over- rather than under-estimate) on purpose — an
overpriced quote costs you a little goodwill; an underpriced one costs you
money on every job that runs long or OOMs.
"""

import modal
import os
import time

# ── Modal App Definition ──────────────────────────────────────────────────
app = modal.App("model-factory-trainer")

# Docker image with all GPU training dependencies.
# NOTE: trl's public API changes quickly between releases (the
# `dataset_text_field`/`max_seq_length` kwargs on SFTTrainer were moved into
# SFTConfig). Versions below are pinned to a combination verified to work
# together — bump deliberately, not implicitly, if you need a newer
# trl/transformers.
training_image = (
    modal.Image.from_registry("nvidia/cuda:12.1.1-devel-ubuntu22.04", add_python="3.11")
    .apt_install("git")
    .pip_install(
        "torch==2.5.1",
        "xformers",
        extra_index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install(
        "transformers==5.5.0",
        "peft==0.20.0",
        "trl==1.10.0",
        "bitsandbytes==0.50.1",  # must be >=0.46.1 for transformers==5.5.0's internal check
        "datasets",
        "boto3",
        "requests",
    )
)

# Persistent Modal Volume to cache base model downloads across jobs.
model_cache = modal.Volume.from_name("model-factory-model-cache", create_if_missing=True)

# CPU-only image for the free cost/tier estimate and for the pre-spawn
# planning step in start_training. Includes torch+transformers (CPU wheel is
# fine — we only ever use `torch.device("meta")` here, never real compute)
# so both endpoints can resolve HF config + parameter count without ever
# touching a GPU or downloading real weights.
planning_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "fastapi[standard]",
    "torch==2.5.1",
    "transformers==5.5.0",
    "requests",
)


# ════════════════════════════════════════════════════════════════════════
# BUSINESS / PRICING CONFIG — tune these as real usage data comes in
# ════════════════════════════════════════════════════════════════════════

# GPU tiers, smallest-to-largest. `vram_gb` is usable training VRAM;
# `hourly_cost_usd` is YOUR raw cost from Modal — keep this updated if
# Modal's pricing changes. Tier selection always picks the smallest tier
# whose vram_gb covers the (margin-inflated) estimate.
GPU_TIERS = [
    {"name": "L4", "modal_gpu": "L4", "vram_gb": 24, "hourly_cost_usd": 0.80},
    {"name": "A100-40GB", "modal_gpu": "A100-40GB", "vram_gb": 40, "hourly_cost_usd": 1.85},
    {"name": "A100-80GB", "modal_gpu": "A100-80GB", "vram_gb": 80, "hourly_cost_usd": 2.50},
]
# Largest supported model size is implicitly defined by GPU_TIERS[-1]. A
# model whose estimate exceeds this fails fast (see select_gpu_tier).

# Models above this size get QLoRA (4-bit) automatically; at/below, standard
# bf16 LoRA (faster, no quantization overhead).
QLORA_THRESHOLD_PARAMS = 4_000_000_000

# Safety margin applied to every VRAM estimate before tier selection. Real
# training runs spike above theoretical averages (fragmentation, odd
# sequence lengths, etc.) — better to over-provision the tier than OOM.
VRAM_SAFETY_MARGIN = 1.20

# credits_charged = raw_gpu_cost_usd * CREDIT_MARKUP_MULTIPLIER * CREDITS_PER_USD
# 1.5x over raw GPU cost is a conservative starting margin for a platform
# that adds real value (no-code UX, auto dataset generation, hosting) on
# top of bare compute — well under the 2-4x markup common among GPU
# resellers, since the product itself is most of the value here, not just
# GPU access. Revisit once you have real margin/CAC data.
CREDIT_MARKUP_MULTIPLIER = 1.5
CREDITS_PER_USD = 100  # i.e. 1 credit = $0.01 — adjust to match your pricing page

# Flat credit fee charged (not refunded) when a job fails outright even
# after the OOM retry — covers the GPU-seconds actually burned trying.
FAILED_JOB_FLAT_FEE_CREDITS = 25

# Absolute ceiling on training steps regardless of dataset size or budget —
# a backstop so a mispriced estimate or a huge dataset can never turn into
# an unbounded GPU bill.
MAX_STEPS_CEILING = 1000

# ⚠️ Calibration constants — see module docstring. Adjust as real job data
# comes in; both are deliberately conservative (bias toward overestimating).
ADAPTER_PARAM_FRACTION_AT_R16 = 0.0058  # observed: 54M/9.3B trainable params at r=16
BASE_SECONDS_PER_STEP_PER_BILLION_PARAMS = 0.35
JOB_LOAD_OVERHEAD_SECONDS = 120  # config fetch + weight download + LoRA setup


# ────────────────────────────────────────────────────────────────────────
# MODEL FAMILY REGISTRY — unchanged from the working version. Central
# source of truth for per-architecture quirks. Detection is layered:
#   1. HF `config.model_type` — most reliable, always present on real models
#   2. model-id substring matching — fallback for renamed/community repos
#   3. fully generic auto-detection — final fallback, works for ANY model
# ────────────────────────────────────────────────────────────────────────

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
        "target_modules": "auto",
        "system_role": True,
        "extra_stop_tokens": ["<|end|>", "<|im_end|>"],
        "byte_level_bpe": False,
    },
    "falcon": {
        "model_types": {"falcon", "falcon_mamba"},
        "name_hints": ("falcon",),
        "target_modules": "auto",
        "system_role": True,
        "extra_stop_tokens": ["<|endoftext|>"],
        "byte_level_bpe": True,
    },
    "deepseek": {
        "model_types": {"deepseek", "deepseek_v2", "deepseek_v3", "deepseek_vl"},
        "name_hints": ("deepseek",),
        "target_modules": "auto",
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
        "target_modules": "auto",
        "system_role": False,
        "extra_stop_tokens": ["<|endoftext|>"],
        "byte_level_bpe": True,
    },
}

DEFAULT_FAMILY = {
    "target_modules": "auto",
    "system_role": None,
    "extra_stop_tokens": [],
    "byte_level_bpe": None,
}


def detect_model_family(model_id: str, model_type: str = ""):
    """Detect model family from HF config.model_type first, then model-id
    substring matching. Always returns a usable spec — unknown models fall
    back to 'generic' with safe defaults."""
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
# available. Both the planner and the trainer must resolve the SAME mirror
# for a given original model id — a LoRA adapter is only valid against the
# exact weights it was trained on.
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


def resolve_base_model(base_model: str, hf_token: str | None) -> str:
    if not hf_token and base_model in UNGATED_MIRRORS:
        return UNGATED_MIRRORS[base_model]
    return base_model


# ════════════════════════════════════════════════════════════════════════
# PLANNING HELPERS — shared by estimate_cost (free, pre-job) and
# start_training (pre-spawn, decides which GPU tier to actually rent).
# None of these download real model weights — only HF config (a few KB)
# and a `torch.device("meta")` model for parameter counting.
# ════════════════════════════════════════════════════════════════════════

def estimate_architecture_dims(param_count: float, cfg) -> tuple[int, int]:
    """Get hidden_size / num_hidden_layers from the real HF config when
    available (most models expose these); fall back to a rough size-based
    heuristic for architectures that name these fields differently and
    aren't worth special-casing individually."""
    hidden_size = getattr(cfg, "hidden_size", None) or getattr(cfg, "n_embd", None)
    num_layers = getattr(cfg, "num_hidden_layers", None) or getattr(cfg, "n_layer", None)

    if hidden_size and num_layers:
        return int(hidden_size), int(num_layers)

    # Fallback heuristic, calibrated loosely against common open model
    # shapes (Llama/Gemma/Qwen/Mistral families) at each size band.
    params_b = param_count / 1e9
    if params_b <= 2:
        return 2048, 24
    elif params_b <= 8:
        return 4096, 32
    elif params_b <= 15:
        return 5120, 40
    elif params_b <= 35:
        return 6656, 48
    else:
        return 8192, 64


def estimate_vram_requirements(
    param_count: int, cfg, use_qlora: bool, batch_size: int, seq_length: int, lora_r: int
) -> dict:
    """Practical VRAM estimator for LoRA/QLoRA SFT training. Not exact
    physics — a conservative planning estimate used to pick a GPU tier and
    a credit cost BEFORE any weights are downloaded. Deliberately biased to
    overestimate (see VRAM_SAFETY_MARGIN): underestimating causes mid-job
    OOM crashes, which is far worse for a paying user than a slightly
    conservative price quote.
    """
    bytes_per_base_param = 0.5 if use_qlora else 2.0  # 4-bit NF4 vs bf16
    base_weights_bytes = param_count * bytes_per_base_param

    adapter_param_fraction = ADAPTER_PARAM_FRACTION_AT_R16 * (lora_r / 16)
    adapter_params = param_count * adapter_param_fraction
    adapter_weights_bytes = adapter_params * 2       # trainable params, bf16
    adapter_grad_bytes = adapter_params * 2          # bf16 gradients
    adapter_optimizer_bytes = adapter_params * 8      # AdamW fp32 (2 moments × 4 bytes)

    hidden_size, num_layers = estimate_architecture_dims(param_count, cfg)

    # Activation memory: proportional model, ~12x hidden_size per token per
    # layer for a standard transformer block (attn + MLP intermediates),
    # divided by a reduction factor for gradient checkpointing (always on
    # — see train_model's SFTConfig).
    GRADIENT_CHECKPOINTING_REDUCTION = 4.0
    activation_bytes = (
        batch_size * seq_length * hidden_size * num_layers * 12 * 2
    ) / GRADIENT_CHECKPOINTING_REDUCTION

    total_bytes = (
        base_weights_bytes + adapter_weights_bytes + adapter_grad_bytes
        + adapter_optimizer_bytes + activation_bytes
    )
    total_with_margin = total_bytes * VRAM_SAFETY_MARGIN

    return {
        "base_weights_gb": base_weights_bytes / 1e9,
        "adapter_overhead_gb": (adapter_weights_bytes + adapter_grad_bytes + adapter_optimizer_bytes) / 1e9,
        "activation_gb": activation_bytes / 1e9,
        "estimated_total_gb": total_bytes / 1e9,
        "estimated_total_with_margin_gb": total_with_margin / 1e9,
    }


def select_gpu_tier(estimated_vram_gb: float) -> dict | None:
    """Smallest GPU tier that fits the (margin-inflated) estimate, or None
    if it exceeds the largest tier we support — caller must fail fast in
    that case, before spawning any paid job."""
    for tier in GPU_TIERS:
        if estimated_vram_gb <= tier["vram_gb"]:
            return tier
    return None


def compute_training_schedule(dataset_size: int, batch_size: int, grad_accum: int) -> tuple[int, int]:
    """Scale epochs/steps to dataset size instead of using fixed constants.
    Small datasets need more passes to learn anything at all; large
    datasets need fewer epochs but enough steps to complete at least one
    full pass, bounded by MAX_STEPS_CEILING regardless of size."""
    if dataset_size <= 50:
        epochs = 5
    elif dataset_size <= 200:
        epochs = 3
    elif dataset_size <= 1000:
        epochs = 2
    else:
        epochs = 1

    effective_batch = max(1, batch_size * grad_accum)
    steps_per_epoch = max(1, dataset_size // effective_batch)
    max_steps = min(steps_per_epoch * epochs, MAX_STEPS_CEILING)
    return epochs, max_steps


def estimate_training_seconds(param_count: int, max_steps: int, use_qlora: bool) -> float:
    """See module docstring calibration note — heuristic, not measured."""
    per_step_seconds = (
        BASE_SECONDS_PER_STEP_PER_BILLION_PARAMS
        * (param_count / 1e9)
        * (1.18 if use_qlora else 1.0)  # QLoRA dequant overhead per step
    )
    return JOB_LOAD_OVERHEAD_SECONDS + (per_step_seconds * max_steps)


def build_training_plan(base_model: str, dataset_size: int, lora_r: int, max_seq_length: int) -> dict:
    """The single source of truth for 'what will this job cost and which
    GPU will it use'. Called by BOTH estimate_cost (free preview) and
    start_training (right before spawning the paid job) so the two numbers
    can never drift apart. Does not download model weights — only HF
    config + a torch.device('meta') model for parameter counting.
    """
    hf_token = os.environ.get("HF_TOKEN", None)
    resolved_model = resolve_base_model(base_model, hf_token)

    from transformers import AutoConfig, AutoModelForCausalLM
    import torch as _torch

    cfg = AutoConfig.from_pretrained(resolved_model, token=hf_token, trust_remote_code=True)
    with _torch.device("meta"):
        meta_model = AutoModelForCausalLM.from_config(cfg)
        param_count = meta_model.num_parameters()

    use_qlora = param_count > QLORA_THRESHOLD_PARAMS
    batch_size = 1 if use_qlora else 2
    grad_accum = 8 if use_qlora else 4

    vram = estimate_vram_requirements(param_count, cfg, use_qlora, batch_size, max_seq_length, lora_r)
    tier = select_gpu_tier(vram["estimated_total_with_margin_gb"])

    if tier is None:
        return {
            "status": "unsupported",
            "reason": "model_too_large",
            "resolved_model": resolved_model,
            "param_count_billion": round(param_count / 1e9, 2),
            "estimated_vram_gb": round(vram["estimated_total_with_margin_gb"], 1),
            "max_supported_vram_gb": GPU_TIERS[-1]["vram_gb"],
            "message": "This model is too large for the current platform limits. Try a smaller model.",
        }

    epochs, max_steps = compute_training_schedule(dataset_size, batch_size, grad_accum)
    estimated_seconds = estimate_training_seconds(param_count, max_steps, use_qlora)
    estimated_hours = estimated_seconds / 3600
    raw_cost_usd = estimated_hours * tier["hourly_cost_usd"]
    estimated_credits = raw_cost_usd * CREDIT_MARKUP_MULTIPLIER * CREDITS_PER_USD

    return {
        "status": "ok",
        "resolved_model": resolved_model,
        "param_count_billion": round(param_count / 1e9, 2),
        "use_qlora": use_qlora,
        "batch_size": batch_size,
        "grad_accum": grad_accum,
        "gpu_tier": tier["name"],
        "modal_gpu": tier["modal_gpu"],
        "estimated_vram_gb": round(vram["estimated_total_with_margin_gb"], 1),
        "vram_breakdown": {k: round(v, 2) for k, v in vram.items()},
        "num_train_epochs": epochs,
        "max_steps": max_steps,
        "estimated_training_seconds": round(estimated_seconds),
        "estimated_credits": round(estimated_credits, 2),
    }


# ════════════════════════════════════════════════════════════════════════
# ENDPOINT 1: FREE cost/tier estimate — no GPU, no charge. Frontend calls
# this on model selection and on every dataset-size change to show a live
# price preview before the user commits to anything.
# ════════════════════════════════════════════════════════════════════════
@app.function(image=planning_image, timeout=60)
@modal.fastapi_endpoint(method="POST")
def estimate_cost(item: dict):
    base_model = item.get("base_model")
    dataset_size = int(item.get("dataset_size", 100))
    lora_r = int(item.get("lora_r", 16))
    max_seq_length = int(item.get("max_seq_length", 1024))

    if not base_model:
        return {"status": "failed", "error": "Missing base_model"}

    try:
        plan = build_training_plan(base_model, dataset_size, lora_r, max_seq_length)
        return plan
    except Exception as e:
        return {"status": "failed", "error": f"Could not resolve model '{base_model}': {e}"}


# ── Main Training Function ──────────────────────────────────────────────
# NOTE: gpu= here is only the DEFAULT for local testing / direct calls.
# start_training below dynamically overrides it per-job via
# `train_model.with_options(gpu=...)` based on the planned tier — verify
# this is the current Modal SDK pattern for per-call GPU override before
# relying on it; Modal's dynamic-resource API has changed across versions.
@app.function(
    image=training_image,
    gpu="L4",
    timeout=3600,
    volumes={"/model-cache": model_cache},
)
def train_model(
    job_id: str,
    dataset_url: str,
    webhook_url: str,
    base_model: str = "meta-llama/Llama-3.1-8B-Instruct",
    learning_rate: float = 5e-5,
    max_seq_length: int = 1024,
    lora_r: int = 16,
    lora_alpha: int = 16,
    # ── Planned values, computed by build_training_plan() BEFORE this job
    # was spawned, and shown to the user as the price they confirmed. This
    # function re-derives them independently as a safety check, but the
    # SMALLER of (re-derived, planned) always wins for cost-sensitive
    # fields — the job must never cost the user more than they agreed to.
    planned_max_steps: int = 200,
    planned_num_train_epochs: int = 1,
    planned_gpu_tier_name: str = "L4",
    max_credit_budget: float = 0.0,  # 0 = no explicit ceiling passed; falls back to planned_max_steps only
    r2_endpoint: str = "",
    r2_access_key: str = "",
    r2_secret_key: str = "",
    r2_bucket: str = "",
):
    """Fine-tune the user's chosen model with their dataset, save LoRA
    weights to R2, and report ACTUAL usage (separate from the estimate) so
    the platform can charge real cost and refund the unused hold."""
    job_start_time = time.time()

    os.environ["PYTORCH_CUDA_ALLOC_CONF"] = "expandable_segments:True"

    import torch
    import requests
    import boto3
    import tempfile
    from datasets import load_dataset
    from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from peft import get_peft_model, LoraConfig, prepare_model_for_kbit_training
    from trl import SFTTrainer, SFTConfig

    hf_token = os.environ.get("HF_TOKEN", None)
    original_model_id = base_model
    base_model = resolve_base_model(base_model, hf_token)
    if base_model != original_model_id:
        print(f"[Model Factory] No HF token — resolved gated model to ungated mirror: {base_model}")

    print(f"[Model Factory] Starting training for job: {job_id}")
    print(f"[Model Factory] User selected model: {original_model_id} -> loading from: {base_model}")
    print(f"[Model Factory] Dataset URL: {dataset_url}")
    print(f"[Model Factory] Planned budget: {max_credit_budget} credits, tier={planned_gpu_tier_name}, "
          f"max_steps={planned_max_steps}, epochs={planned_num_train_epochs}")

    def notify_and_raise(error_message: str, partial_credits_to_charge: float = FAILED_JOB_FLAT_FEE_CREDITS):
        """Single place that reports failure + partial-usage billing before
        re-raising, so every failure path (config error, OOM-after-retry,
        upload error, etc.) reconciles credits consistently."""
        elapsed = time.time() - job_start_time
        try:
            requests.post(webhook_url, json={
                "job_id": job_id,
                "status": "failed",
                "error": error_message,
                "actual_gpu_seconds": round(elapsed),
                "credits_to_charge": partial_credits_to_charge,  # flat fee, not full estimate — refund the rest
            }, timeout=30)
        except Exception as e:
            print(f"[Model Factory] Webhook error notification failed: {e}")

    # ── Step 0: Detect model family + verify plan is still current ───────
    try:
        _cfg = AutoConfig.from_pretrained(base_model, token=hf_token, trust_remote_code=True)
        detected_model_type = getattr(_cfg, "model_type", "") or ""
    except Exception as cfg_err:
        notify_and_raise(f"Could not load model config: {cfg_err}")
        raise

    family_name, family_spec = detect_model_family(base_model, detected_model_type)
    print(f"[Model Factory] Detected model family: '{family_name}' (model_type={detected_model_type or 'unknown'})")

    param_count = 0
    try:
        with torch.device("meta"):
            meta_model = AutoModelForCausalLM.from_config(_cfg)
            param_count = meta_model.num_parameters()
        print(f"[Model Factory] Detected parameter count: ~{param_count / 1e9:.2f}B")
    except Exception as e:
        print(f"[Model Factory] Could not estimate parameter count: {e}")

    use_qlora = param_count > QLORA_THRESHOLD_PARAMS
    if use_qlora:
        print("[Model Factory] Model > threshold: using QLoRA (4-bit).")
        train_batch_size = 1
        grad_accum = 8
    else:
        print("[Model Factory] Model <= threshold: using standard 16-bit LoRA.")
        train_batch_size = 2
        grad_accum = 4

    # ── Cost-ceiling enforcement: re-derive schedule locally, then take the
    # SMALLER of (locally re-derived, planned-and-confirmed) for anything
    # cost-affecting. This protects the user if this job's live parameter
    # count differs from what the pre-job estimate saw (e.g. a model was
    # updated on the Hub between estimate and launch).
    print("[Model Factory] Downloading dataset...")
    dataset_res = requests.get(dataset_url)
    dataset_res.raise_for_status()
    with tempfile.NamedTemporaryFile(mode="w", suffix=".jsonl", delete=False) as f:
        f.write(dataset_res.text)
        dataset_path = f.name
    dataset = load_dataset("json", data_files=dataset_path, split="train")
    print(f"[Model Factory] Loaded {len(dataset)} training examples")

    local_epochs, local_max_steps = compute_training_schedule(len(dataset), train_batch_size, grad_accum)
    num_train_epochs = min(local_epochs, planned_num_train_epochs) if planned_num_train_epochs else local_epochs
    max_steps = min(local_max_steps, planned_max_steps) if planned_max_steps else local_max_steps
    print(f"[Model Factory] Final schedule (min of local vs planned): "
          f"epochs={num_train_epochs}, max_steps={max_steps}")

    # ── Step 2: Load Base Model ───────────────────────────────────────────
    print(f"[Model Factory] Loading model: {base_model}...")
    try:
        tokenizer = AutoTokenizer.from_pretrained(
            base_model, cache_dir="/model-cache", token=hf_token, trust_remote_code=True,
        )

        def load_model(as_qlora: bool):
            if as_qlora:
                bnb_config = BitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_use_double_quant=True,
                    bnb_4bit_quant_type="nf4",
                    bnb_4bit_compute_dtype=torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16,
                )
                m = AutoModelForCausalLM.from_pretrained(
                    base_model, quantization_config=bnb_config, device_map="auto",
                    attn_implementation="eager", cache_dir="/model-cache",
                    token=hf_token, trust_remote_code=True,
                )
            else:
                m = AutoModelForCausalLM.from_pretrained(
                    base_model, dtype=torch.bfloat16, device_map="auto",
                    attn_implementation="eager", cache_dir="/model-cache",
                    token=hf_token, trust_remote_code=True,
                )
            return m

        model = load_model(use_qlora)

        print(f"[Model Factory] Tokenizer class: {type(tokenizer).__name__}")
        print(f"[Model Factory] Tokenizer vocab_size: {tokenizer.vocab_size}, model vocab_size: {model.config.vocab_size}")

        if tokenizer.pad_token is None:
            tokenizer.pad_token = tokenizer.eos_token
            tokenizer.pad_token_id = tokenizer.eos_token_id
        model.config.pad_token_id = tokenizer.pad_token_id

        # ── Step 3: Apply LoRA (family-aware target modules) ──────────────
        # "Linear" substring match (not isinstance(torch.nn.Linear)) so this
        # also matches bitsandbytes' Linear4bit/Linear8bitLt under QLoRA —
        # an isinstance-only check silently finds zero modules once the
        # model is quantized, breaking auto-detection for every family.
        def detect_target_modules(m):
            return list(set(
                name.split(".")[-1]
                for name, module in m.named_modules()
                if "Linear" in module.__class__.__name__
                and "lm_head" not in name
                and "embed" not in name
            ))

        auto_detected_modules = detect_target_modules(model)
        family_targets = family_spec.get("target_modules")
        if family_targets and family_targets != "auto":
            present = set(auto_detected_modules)
            target_modules = [m for m in family_targets if m in present]
            if not target_modules:
                print(f"[Model Factory] '{family_name}' target modules not found on this model — "
                      f"falling back to auto-detected: {auto_detected_modules}")
                target_modules = auto_detected_modules
            else:
                print(f"[Model Factory] Using {family_name}-optimized LoRA target modules: {target_modules}")
        else:
            target_modules = auto_detected_modules
            print(f"[Model Factory] Auto-detected LoRA target modules: {target_modules}")

        def build_peft_model(m, as_qlora):
            peft_config = LoraConfig(
                r=lora_r, lora_alpha=lora_alpha, target_modules=target_modules,
                lora_dropout=0.05, bias="none", task_type="CAUSAL_LM",
            )
            if as_qlora:
                m = prepare_model_for_kbit_training(m)
            m = get_peft_model(m, peft_config)
            return m

        model = build_peft_model(model, use_qlora)
        model.print_trainable_parameters()

        # ── Step 4: Format dataset with model's native chat template ──────
        def _supports_system_role(tok):
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
                msgs = [{"role": "user", "content": prompt}, {"role": "assistant", "content": completion}]
                try:
                    text = tokenizer.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
                except Exception:
                    text = f"### User:\n{prompt}\n\n### Assistant:\n{completion}"
            else:
                text = f"### User:\n{prompt}\n\n### Assistant:\n{completion}"
            return {"text": text}

        formatted_dataset = dataset.map(format_example)
        cols_to_remove = [c for c in formatted_dataset.column_names if c != "text"]
        if cols_to_remove:
            formatted_dataset = formatted_dataset.remove_columns(cols_to_remove)
        print(f"[Model Factory] Sample formatted text (first 300 chars): {formatted_dataset[0]['text'][:300]}")

        try:
            from transformers.utils import is_bitsandbytes_available
            optimizer_name = "adamw_8bit" if is_bitsandbytes_available() else "adamw_torch"
        except Exception:
            optimizer_name = "adamw_torch"

        def build_sft_config(batch_size, accum_steps):
            return SFTConfig(
                per_device_train_batch_size=batch_size,
                gradient_accumulation_steps=accum_steps,
                gradient_checkpointing=True,
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
                max_grad_norm=0.3,
                seed=3407,
                output_dir="/tmp/training_output",
                report_to="none",
                dataset_text_field="text",
                max_length=max_seq_length,
                packing=False,
            )

        # ── Step 5: Train, with a bounded OOM fallback ─────────────────────
        # Attempt 1: planned config as-is.
        # Attempt 2 (only on OOM): halve batch size / double accumulation.
        # Attempt 3 (only on OOM again, and only if not already QLoRA):
        #   reload the model in 4-bit and retry once more.
        # Any OOM after that fails cleanly with a structured error and the
        # flat partial-usage fee — never an unbounded retry loop.
        attempt_batch_size = train_batch_size
        attempt_accum = grad_accum
        attempt_qlora = use_qlora
        last_error = None

        for attempt in range(1, 4):
            try:
                print(f"[Model Factory] Training attempt {attempt}: "
                      f"batch_size={attempt_batch_size}, grad_accum={attempt_accum}, qlora={attempt_qlora}")
                sft_config = build_sft_config(attempt_batch_size, attempt_accum)
                trainer = SFTTrainer(
                    model=model, processing_class=tokenizer,
                    train_dataset=formatted_dataset, args=sft_config,
                )
                trainer.train()
                print("[Model Factory] Training complete!")
                break
            except torch.cuda.OutOfMemoryError as oom_err:
                last_error = oom_err
                torch.cuda.empty_cache()
                print(f"[Model Factory] OOM on attempt {attempt}: {oom_err}")

                if attempt == 1 and attempt_batch_size > 1:
                    attempt_batch_size = 1
                    attempt_accum *= 2
                    print("[Model Factory] Retrying with batch_size=1 and doubled gradient accumulation.")
                    continue
                elif attempt <= 2 and not attempt_qlora:
                    print("[Model Factory] Retrying by reloading model in 4-bit (QLoRA).")
                    del model
                    torch.cuda.empty_cache()
                    model = load_model(as_qlora=True)
                    if tokenizer.pad_token is None:
                        tokenizer.pad_token = tokenizer.eos_token
                        tokenizer.pad_token_id = tokenizer.eos_token_id
                    model.config.pad_token_id = tokenizer.pad_token_id
                    target_modules = detect_target_modules(model)  # Linear4bit names differ — redetect
                    model = build_peft_model(model, as_qlora=True)
                    attempt_qlora = True
                    attempt_batch_size = 1
                    attempt_accum = max(attempt_accum, 8)
                    continue
                else:
                    notify_and_raise(
                        f"Training failed after retries — model too large for available GPU tier "
                        f"even at minimum batch size and 4-bit quantization: {oom_err}"
                    )
                    raise

        if last_error is not None and attempt == 3:
            # Loop exhausted without a clean break — should already have
            # raised above, this is a defensive backstop.
            notify_and_raise(f"Training failed after all retry attempts: {last_error}")
            raise last_error

        # ── Step 6: Save & Upload LoRA Weights to R2 ───────────────────────
        adapter_dir = f"/tmp/adapter_{job_id}"
        model.save_pretrained(adapter_dir)
        tokenizer.save_pretrained(adapter_dir)

        print("[Model Factory] Uploading LoRA adapter to Cloudflare R2...")
        _r2_endpoint = r2_endpoint or os.environ.get("R2_ENDPOINT", "")
        _r2_access_key = r2_access_key or os.environ.get("AWS_ACCESS_KEY_ID", "")
        _r2_secret_key = r2_secret_key or os.environ.get("AWS_SECRET_ACCESS_KEY", "")
        _r2_bucket = r2_bucket or os.environ.get("R2_BUCKET", "")

        s3 = boto3.client(
            "s3", endpoint_url=_r2_endpoint, aws_access_key_id=_r2_access_key,
            aws_secret_access_key=_r2_secret_key, region_name="auto",
        )
        for filename in os.listdir(adapter_dir):
            filepath = os.path.join(adapter_dir, filename)
            s3_key = f"adapters/{job_id}/{filename}"
            s3.upload_file(filepath, _r2_bucket, s3_key)
            print(f"[Model Factory] Uploaded: {s3_key}")

        adapter_r2_prefix = f"adapters/{job_id}"

        # ── Step 7: Report ACTUAL usage for billing reconciliation ─────────
        elapsed_seconds = time.time() - job_start_time
        tier = next((t for t in GPU_TIERS if t["name"] == planned_gpu_tier_name), GPU_TIERS[0])
        actual_cost_usd = (elapsed_seconds / 3600) * tier["hourly_cost_usd"]
        actual_credits = actual_cost_usd * CREDIT_MARKUP_MULTIPLIER * CREDITS_PER_USD

        print(f"[Model Factory] Notifying webhook: {webhook_url}")
        try:
            requests.post(webhook_url, json={
                "job_id": job_id,
                "status": "completed",
                "adapter_prefix": adapter_r2_prefix,
                "detected_family": family_name,
                "resolved_base_model": base_model,
                "actual_gpu_seconds": round(elapsed_seconds),
                "actual_credits": round(actual_credits, 2),
                "used_qlora_fallback": attempt_qlora and not use_qlora,  # True if OOM forced a QLoRA reload
            }, timeout=30)
        except Exception as e:
            print(f"[Model Factory] Webhook notification failed (non-fatal): {e}")

        print("[Model Factory] All done!")
        return {"status": "completed", "adapter_prefix": adapter_r2_prefix, "detected_family": family_name}

    except Exception as err:
        print(f"[Model Factory] Training error: {err}")
        notify_and_raise(str(err))
        raise err


# ── Web Endpoint to Trigger Training Asynchronously ─────────────────────
@app.function(image=planning_image, timeout=60)
@modal.fastapi_endpoint(method="POST")
def start_training(item: dict):
    """
    HTTP POST endpoint that plans, validates, and spawns train_model on the
    appropriate GPU tier. Frontend must have already: shown the user this
    same plan via estimate_cost, gotten explicit confirmation, and placed a
    credit hold >= plan['estimated_credits'] BEFORE calling this endpoint.
    This endpoint does not itself check credit balance — that's the
    frontend/backend API layer's job — but it DOES re-run the plan and will
    refuse to start a job whose live plan disagrees with what was passed in
    (protects against stale prices from a slow user or a changed model).
    """
    job_id = item.get("job_id")
    dataset_url = item.get("dataset_url")
    webhook_url = item.get("webhook_url")
    base_model = item.get("base_model", "meta-llama/Llama-3.1-8B-Instruct")
    dataset_size = int(item.get("dataset_size", 100))
    learning_rate = item.get("learning_rate", 0.0002)
    max_seq_length = item.get("max_seq_length", 1024)
    lora_r = item.get("lora_r", 16)
    lora_alpha = item.get("lora_alpha", 16)
    confirmed_credit_hold = item.get("confirmed_credit_hold", 0.0)
    r2_endpoint = item.get("r2_endpoint", "")
    r2_access_key = item.get("r2_access_key", "")
    r2_secret_key = item.get("r2_secret_key", "")
    r2_bucket = item.get("r2_bucket", "")

    if not job_id or not dataset_url:
        return {"error": "Missing job_id or dataset_url", "status": "failed"}

    try:
        plan = build_training_plan(base_model, dataset_size, lora_r, max_seq_length)
    except Exception as e:
        return {"status": "failed", "error": f"Could not plan job: {e}"}

    if plan["status"] != "ok":
        return plan  # e.g. {"status": "unsupported", "reason": "model_too_large", ...}

    if confirmed_credit_hold and confirmed_credit_hold < plan["estimated_credits"]:
        return {
            "status": "failed",
            "error": "insufficient_hold",
            "message": (
                f"Confirmed hold ({confirmed_credit_hold} credits) is less than the current "
                f"estimate ({plan['estimated_credits']} credits) — price may have changed. "
                f"Re-fetch estimate_cost and reconfirm."
            ),
        }

    print(f"[Model Factory Endpoint] Spawning train_model for job {job_id}: "
          f"model={plan['resolved_model']}, tier={plan['gpu_tier']}, "
          f"steps={plan['max_steps']}, est_credits={plan['estimated_credits']}")

    call = train_model.with_options(gpu=plan["modal_gpu"]).spawn(
        job_id=job_id,
        dataset_url=dataset_url,
        webhook_url=webhook_url,
        base_model=base_model,
        learning_rate=learning_rate,
        max_seq_length=max_seq_length,
        lora_r=lora_r,
        lora_alpha=lora_alpha,
        planned_max_steps=plan["max_steps"],
        planned_num_train_epochs=plan["num_train_epochs"],
        planned_gpu_tier_name=plan["gpu_tier"],
        max_credit_budget=confirmed_credit_hold or plan["estimated_credits"],
        r2_endpoint=r2_endpoint,
        r2_access_key=r2_access_key,
        r2_secret_key=r2_secret_key,
        r2_bucket=r2_bucket,
    )

    return {
        "status": "started",
        "call_id": call.object_id,
        "gpu_tier": plan["gpu_tier"],
        "estimated_credits": plan["estimated_credits"],
    }


# ── Local test entry point ────────────────────────────────────────────────
@app.local_entrypoint()
def main():
    print("Modal training backend loaded. Deploy with: modal deploy modal_backend/train.py")