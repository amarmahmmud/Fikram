"""
Modal.com Inference Backend for Model Factory
===============================================
Deploy this file with: modal deploy modal_backend/inference.py

This creates a persistent web endpoint that:
1. Loads the correct base model (user's chosen model) into GPU VRAM
2. Hot-loads the user's LoRA adapter from Cloudflare R2
3. Generates chat responses with low latency

Universal compatibility:
- Detects model family from HF `config.model_type` (same registry used by
  train.py) and uses family-specific stop tokens / BPE handling where known,
  falling back to fully generic behaviour for anything not in the table
- Resolves gated models (Llama, Gemma) to the SAME ungated mirror train.py
  used, so the LoRA adapter is always attached to the exact weights it was
  trained on
- Handles missing pad tokens for any model
- Guards against unsupported system roles (Gemma, Phi, etc.)
- Conditionally applies BPE byte-fix only for byte-level-BPE families
  (Llama/GPT-2/Qwen/Falcon/Mistral style tokenizers)
"""

import modal
import os

app = modal.App("model-factory-inference")

inference_image = (
    modal.Image.from_registry("nvidia/cuda:12.1.1-devel-ubuntu22.04", add_python="3.11")
    .apt_install("git")
    .pip_install(
        "torch==2.5.1",
        extra_index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install(
        "transformers==5.5.0",
        "peft==0.20.0",
        "boto3",
        "requests",
        "fastapi",
    )
)

model_cache = modal.Volume.from_name("model-factory-model-cache", create_if_missing=True)

# ────────────────────────────────────────────────────────────────────────────
# MODEL FAMILY REGISTRY
# ────────────────────────────────────────────────────────────────────────────
# Mirrors the registry in train.py so training and inference make the exact
# same architecture decisions for a given model. Detection is layered:
#   1. HF `config.model_type` — most reliable, always present
#   2. model-id substring matching — fallback for renamed/community repos
#   3. generic per-tokenizer probing — final fallback for unknown families
# Every family-specific field has a working universal default, so a model
# that isn't in this table still works correctly.
# ────────────────────────────────────────────────────────────────────────────

MODEL_FAMILIES = {
    "llama": {
        "model_types": {"llama", "llama4", "llama4_text"},
        "name_hints": ("llama", "codellama"),
        "system_role": True,
        "extra_stop_tokens": ["<|eot_id|>", "<|end_of_text|>"],
        "byte_level_bpe": True,
    },
    "mistral": {
        "model_types": {"mistral", "mixtral"},
        "name_hints": ("mistral", "mixtral"),
        "system_role": True,
        "extra_stop_tokens": ["</s>"],
        "byte_level_bpe": True,
    },
    "qwen": {
        "model_types": {"qwen2", "qwen2_moe", "qwen3", "qwen3_moe", "qwen"},
        "name_hints": ("qwen",),
        "system_role": True,
        "extra_stop_tokens": ["<|im_end|>"],
        "byte_level_bpe": True,
    },
    "gemma": {
        "model_types": {"gemma", "gemma2", "gemma3", "gemma3_text"},
        "name_hints": ("gemma",),
        "system_role": False,
        "extra_stop_tokens": ["<end_of_turn>"],
        "byte_level_bpe": False,
    },
    "phi": {
        "model_types": {"phi", "phi3", "phimoe", "phi4", "phi4mm"},
        "name_hints": ("phi-", "phi_", "phi2", "phi3", "phi4"),
        "system_role": True,
        "extra_stop_tokens": ["<|end|>", "<|im_end|>"],
        "byte_level_bpe": False,
    },
    "falcon": {
        "model_types": {"falcon", "falcon_mamba"},
        "name_hints": ("falcon",),
        "system_role": True,
        "extra_stop_tokens": ["<|endoftext|>"],
        "byte_level_bpe": True,
    },
    "deepseek": {
        "model_types": {"deepseek", "deepseek_v2", "deepseek_v3", "deepseek_vl"},
        "name_hints": ("deepseek",),
        "system_role": True,
        "extra_stop_tokens": ["<|im_end|>", "<end_of_sentence>"],
        "byte_level_bpe": False,
    },
    "chatglm": {
        "model_types": {"chatglm"},
        "name_hints": ("chatglm", "glm-"),
        "system_role": True,
        "extra_stop_tokens": [],
        "byte_level_bpe": False,
    },
    "gpt2": {
        "model_types": {"gpt2", "gpt_neo", "gptj", "gpt_neox"},
        "name_hints": ("gpt2", "gpt-neo", "gptj", "gpt-j", "pythia"),
        "system_role": False,
        "extra_stop_tokens": ["<|endoftext|>"],
        "byte_level_bpe": True,
    },
}

DEFAULT_FAMILY = {
    "system_role": None,     # unknown — probed live via the chat template
    "extra_stop_tokens": [],
    "byte_level_bpe": None,  # unknown — inferred from the tokenizer class name
}


def detect_model_family(model_id: str, model_type: str = ""):
    """Same detection logic as train.py — keep the two in sync."""
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


# Must match train.py's UNGATED_MIRRORS exactly — the LoRA adapter is only
# valid against the exact base weights it was fine-tuned on, so if training
# resolved "google/gemma-2-2b-it" to "unsloth/gemma-2-2b-it", inference has
# to load that same mirror or the adapter will attach to the wrong weights.
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

DEFAULT_MODEL = "meta-llama/Llama-3.1-8B-Instruct"


def _fix_bpe_text(text):
    """
    Fix BPE byte-level artifacts in decoded text.
    Byte-level-BPE tokenizers (Llama/GPT-2/Qwen/Mistral/Falcon family) use a
    byte-to-unicode mapping where non-printable bytes (0-32, 127-160, 173)
    are shifted to U+0100+. This function detects sequences of these shifted
    characters and decodes them back to proper UTF-8.
    """
    # Build the GPT-2 byte decoder (inverse of bytes_to_unicode)
    bs = list(range(33, 127)) + list(range(161, 173)) + list(range(174, 256))
    cs = bs[:]
    n = 0
    for b in range(256):
        if b not in bs:
            bs.append(b)
            cs.append(256 + n)
            n += 1
    byte_decoder = {chr(c): b for b, c in zip(bs, cs)}

    # Process the text: convert BPE byte chars back to real UTF-8
    result = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch in byte_decoder:
            # Collect consecutive BPE byte characters
            byte_seq = []
            j = i
            while j < len(text) and text[j] in byte_decoder:
                byte_seq.append(byte_decoder[text[j]])
                j += 1
            # Try to decode as UTF-8
            try:
                decoded = bytes(byte_seq).decode("utf-8")
                result.append(decoded)
                i = j
                continue
            except (UnicodeDecodeError, ValueError):
                pass
        result.append(ch)
        i += 1
    return "".join(result)

# ── Inference Web Endpoint ─────────────────────────────────────────────────────
@app.cls(
    image=inference_image,
    gpu="L4",                   # L4 with 24GB VRAM prevents OOM and offloading issues
    timeout=300,
    scaledown_window=300,        # Keep warm for 5 mins after last request
    volumes={"/model-cache": model_cache},
)
class ModelInference:

    @modal.enter()
    def init(self):
        """Initialize state — actual model loading happens on first request."""
        self.loaded_base_model_id = None   # resolved id actually loaded into VRAM
        self.base_model = None
        self.tokenizer = None
        self.loaded_adapter_prefix = None
        self.active_model = None
        self.family_name = None
        self.family_spec = DEFAULT_FAMILY
        print("[Inference Container] Ready — model will be loaded on first request.")

    def _load_base_model(self, base_model_id: str):
        """Load (or swap) the base model into GPU VRAM."""
        from transformers import AutoConfig, AutoModelForCausalLM, AutoTokenizer
        import torch

        hf_token = os.environ.get("HF_TOKEN", None)

        # Resolve gated models to the same ungated mirror train.py used —
        # otherwise the adapter would be attached to different weights.
        resolved_id = base_model_id
        if not hf_token and base_model_id in UNGATED_MIRRORS:
            resolved_id = UNGATED_MIRRORS[base_model_id]
            print(f"[Inference] No HF token — resolved gated model to ungated mirror: {resolved_id}")

        # Skip reload if same (resolved) model is already loaded
        if self.loaded_base_model_id == resolved_id and self.base_model is not None:
            return

        print(f"[Inference] Loading base model: {resolved_id} (requested as {base_model_id})")

        # ── Detect model family (same registry/logic as train.py) ──────────
        try:
            cfg = AutoConfig.from_pretrained(resolved_id, token=hf_token, trust_remote_code=True)
            detected_model_type = getattr(cfg, "model_type", "") or ""
        except Exception as cfg_err:
            print(f"[Inference] Could not pre-fetch config ({cfg_err}); family detection will use name matching only")
            detected_model_type = ""

        self.family_name, self.family_spec = detect_model_family(resolved_id, detected_model_type)
        print(f"[Inference] Detected model family: '{self.family_name}' (model_type={detected_model_type or 'unknown'})")

        self.tokenizer = AutoTokenizer.from_pretrained(
            resolved_id,
            cache_dir="/model-cache",
            token=hf_token,
            trust_remote_code=True,
        )

        self.base_model = AutoModelForCausalLM.from_pretrained(
            resolved_id,
            dtype=torch.bfloat16,
            device_map="auto",
            cache_dir="/model-cache",
            token=hf_token,
            trust_remote_code=True,
        )

        if self.tokenizer.pad_token_id is not None:
            self.base_model.config.pad_token_id = self.tokenizer.pad_token_id
        print(f"[Inference] Model loaded. pad_token={self.tokenizer.pad_token}, pad_token_id={self.tokenizer.pad_token_id}")

        self.loaded_base_model_id = resolved_id
        self.loaded_adapter_prefix = None  # Force adapter reload
        self.active_model = self.base_model

        # Cache whether this model supports the "system" role — the live
        # probe is authoritative; the family spec is only a documentation hint.
        self._system_role_ok = self._check_system_role_support()

        # Cache whether this tokenizer needs byte-level BPE fixup. Prefer the
        # family's known value; fall back to tokenizer-class-name sniffing
        # for families not in the registry.
        family_bpe = self.family_spec.get("byte_level_bpe")
        self._needs_bpe_fix = family_bpe if family_bpe is not None else self._check_byte_level_bpe()

        print(f"[Inference] Base model ready: {resolved_id} "
              f"(family={self.family_name}, system_role={self._system_role_ok}, bpe_fix={self._needs_bpe_fix})")

    def _check_system_role_support(self):
        """Check if the tokenizer's chat template supports a 'system' role.
        We actually try applying it — substring checks like 'system in template'
        give false positives (e.g. Gemma's template contains 'System role not
        supported' as an error message string)."""
        template = getattr(self.tokenizer, "chat_template", None)
        if not template:
            return False
        try:
            self.tokenizer.apply_chat_template(
                [{"role": "system", "content": "test"}, {"role": "user", "content": "test"}],
                tokenize=False,
            )
            return True
        except Exception:
            return False

    def _check_byte_level_bpe(self):
        """Detect if tokenizer uses byte-level BPE (Llama, GPT-2 family).
        These tokenizers map non-printable bytes to Unicode chars in U+0100+ range
        and need the _fix_bpe_text post-processing. Other tokenizers (Phi, Gemma,
        etc.) do NOT and would get their output corrupted. Only used as a
        fallback when the detected family doesn't already specify this."""
        tok_class = type(self.tokenizer).__name__.lower()
        byte_level_families = ["llama", "gpt2", "roberta", "bart", "codellama"]
        return any(family in tok_class for family in byte_level_families)

    @modal.fastapi_endpoint(method="POST")
    def generate(self, item: dict):
        """
        Generates chat completion using the correct base model + LoRA adapter.
        Universally handles ALL model architectures without model-specific code,
        using family-specific tuning where the model is a recognized family.
        """
        import boto3
        import os as _os
        import torch
        import re
        from peft import PeftModel

        try:
            adapter_prefix = item.get("adapter_prefix")
            base_model_id = item.get("base_model", DEFAULT_MODEL)
            messages = item.get("messages", [])
            system_prompt = item.get("system_prompt", "You are a helpful assistant.")
            max_new_tokens = item.get("max_new_tokens", 512)
            temperature = item.get("temperature", 0.7)

            r2_endpoint = item.get("r2_endpoint")
            r2_access_key = item.get("r2_access_key")
            r2_secret_key = item.get("r2_secret_key")
            r2_bucket = item.get("r2_bucket")

            if not adapter_prefix:
                return {"error": "No adapter_prefix provided", "status": "failed"}

            # ── Load the correct base model (resolves gated mirrors + detects family) ──
            self._load_base_model(base_model_id)

            adapter_dir = f"/tmp/adapter_{adapter_prefix.replace('/', '_')}"

            # ── Download adapter files from R2 if not yet cached ───────────────────
            if not _os.path.exists(adapter_dir):
                _os.makedirs(adapter_dir, exist_ok=True)
                print(f"[Inference] Downloading adapter from R2: {adapter_prefix}")

                s3 = boto3.client(
                    "s3",
                    endpoint_url=r2_endpoint,
                    aws_access_key_id=r2_access_key,
                    aws_secret_access_key=r2_secret_key,
                    region_name="auto",
                )

                paginator = s3.get_paginator("list_objects_v2")
                for page in paginator.paginate(Bucket=r2_bucket, Prefix=adapter_prefix):
                    for obj in page.get("Contents", []):
                        key = obj["Key"]
                        filename = key.replace(adapter_prefix + "/", "")
                        local_path = _os.path.join(adapter_dir, filename)
                        s3.download_file(r2_bucket, key, local_path)
                        print(f"[Inference] Downloaded: {filename}")

            # ── Hot-load LoRA adapter if different from current ──────────────────
            if self.loaded_adapter_prefix != adapter_prefix:
                print(f"[Inference] Attaching LoRA adapter from {adapter_dir}...")
                self.active_model = PeftModel.from_pretrained(self.base_model, adapter_dir)
                self.active_model.eval()
                self.loaded_adapter_prefix = adapter_prefix
                print("[Inference] LoRA adapter attached successfully.")

            # ── Format messages into chat template ─────────────────────────────────
            # Strategy: try chat template first, fall back to plaintext if anything fails
            prompt = None
            has_template = getattr(self.tokenizer, "chat_template", None) is not None
            formatted_messages = []

            if has_template:
                try:
                    # Guard system role if model doesn't support it
                    if self._system_role_ok:
                        formatted_messages = [{"role": "system", "content": system_prompt}]
                    else:
                        formatted_messages = []

                    system_prepended = False

                    # 1. Normalize roles
                    normalized_msgs = []
                    for msg in messages:
                        role = "user" if msg.get("role") in ("user",) else "assistant"
                        normalized_msgs.append({"role": role, "content": msg.get("content", "")})

                    # 2. Merge consecutive messages of the same role to guarantee alternation
                    merged_msgs = []
                    for msg in normalized_msgs:
                        if not merged_msgs:
                            merged_msgs.append(msg)
                        elif merged_msgs[-1]["role"] == msg["role"]:
                            merged_msgs[-1]["content"] += f"\n\n{msg['content']}"
                        else:
                            merged_msgs.append(msg)

                    # 3. CRITICAL: Models like Gemma require the history to START with a 'user' message.
                    # The frontend playground seeds the chat with a hardcoded greeting (assistant).
                    # We must strip any leading 'assistant' messages to prevent template crashes.
                    while merged_msgs and merged_msgs[0]["role"] == "assistant":
                        merged_msgs.pop(0)

                    # 4. Fold system prompt if needed
                    for msg in merged_msgs:
                        if not self._system_role_ok and msg["role"] == "user" and not system_prepended:
                            msg["content"] = f"{system_prompt}\n\n{msg['content']}"
                            system_prepended = True
                        formatted_messages.append(msg)

                    prompt = self.tokenizer.apply_chat_template(
                        formatted_messages,
                        tokenize=False,
                        add_generation_prompt=True,
                    )
                except Exception as tmpl_err:
                    print(f"[Inference] Chat template failed ({tmpl_err}), using plaintext fallback")
                    print(f"[Inference] Message roles sent: {[m['role'] for m in formatted_messages]}")
                    prompt = None  # Force plaintext fallback

            if prompt is None:
                # Plaintext fallback for base models or broken templates
                parts = [f"### System:\n{system_prompt}"]
                for msg in messages:
                    role = "User" if msg.get("role") == "user" else "Assistant"
                    parts.append(f"### {role}:\n{msg.get('content', '')}")
                parts.append("### Assistant:")
                prompt = "\n\n".join(parts)

            # ── Generate response ──────────────────────────────────────────────────
            inputs = self.tokenizer(prompt, return_tensors="pt").to(self.active_model.device)

            # Ensure we have valid pad and eos token IDs for any model
            pad_id = self.tokenizer.pad_token_id
            if pad_id is None:
                pad_id = self.tokenizer.eos_token_id

            # Collect universal + family-specific terminator tokens (fixes
            # hallucination loops on Gemma/Llama/Qwen/etc.). The base four are
            # a generic safety net; family_spec['extra_stop_tokens'] adds any
            # further tokens known for the detected family.
            stop_token_strs = ["<|eot_id|>", "<end_of_turn>", "<|im_end|>", "<|end|>", "<|endoftext|>", "</s>"]
            stop_token_strs += self.family_spec.get("extra_stop_tokens", [])

            terminators = [self.tokenizer.eos_token_id]
            for tok_str in dict.fromkeys(stop_token_strs):  # de-dupe, keep order
                tok_id = self.tokenizer.convert_tokens_to_ids(tok_str)
                if tok_id is not None:
                    terminators.append(tok_id)
            terminators = [t for t in dict.fromkeys(terminators) if t is not None]

            try:
                with torch.no_grad():
                    outputs = self.active_model.generate(
                        **inputs,
                        max_new_tokens=max_new_tokens,
                        temperature=temperature,
                        do_sample=temperature > 0,
                        pad_token_id=pad_id,
                        eos_token_id=terminators,
                    )
            except Exception as gen_err:
                # Fallback to greedy decoding if sampling fails on some architectures
                print(f"[Inference] Sampling failed ({gen_err}), falling back to greedy")
                with torch.no_grad():
                    outputs = self.active_model.generate(
                        **inputs,
                        max_new_tokens=max_new_tokens,
                        do_sample=False,
                        pad_token_id=pad_id,
                        eos_token_id=terminators,
                    )

            # Decode only the generated response (skip the prompt tokens)
            new_tokens = outputs[0][inputs["input_ids"].shape[1]:]
            reply = self.tokenizer.decode(new_tokens, skip_special_tokens=True).strip()

            # ── Clean up output (universal + family-aware) ──────────────────────────
            # 1. Strip reasoning/thinking blocks (DeepSeek R1 etc.)
            if "</think>" in reply:
                reply = reply.split("</think>")[-1].strip()
            reply = re.sub(r"<think>[\s\S]*?</think>", "", reply).strip()

            # 2. Fix BPE byte-level artifacts ONLY for byte-level-BPE families
            if self._needs_bpe_fix:
                reply = _fix_bpe_text(reply)

            # 3. Strip leftover template artifacts that skip_special_tokens may miss
            common_artifacts = [
                "<end_of_turn>", "<|im_end|>", "<|eot_id|>", "<|end|>",
                "</s>", "<|assistant|>", "<|user|>", "### Assistant:",
                "<|endoftext|>",
            ]
            for artifact in common_artifacts:
                reply = reply.replace(artifact, "")

            # 4. Final cleanup — collapse excess whitespace
            reply = re.sub(r"\n{3,}", "\n\n", reply).strip()

            print(f"[Inference] Generated reply ({len(reply)} chars) using {base_model_id} "
                  f"(family={self.family_name})")
            return {"reply": reply, "status": "succeeded", "detected_family": self.family_name}

        except Exception as err:
            import traceback
            print(f"[Inference Error] {err}")
            traceback.print_exc()
            return {"error": str(err), "status": "failed"}