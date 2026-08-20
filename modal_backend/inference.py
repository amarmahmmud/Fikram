"""
Modal.com Inference Backend for Model Factory
===============================================
Deploy this file with: modal deploy modal_backend/inference.py

This creates a persistent web endpoint that:
1. Loads the correct base model (user's chosen model) into GPU VRAM
2. Hot-loads the user's LoRA adapter from Cloudflare R2
3. Generates chat responses with low latency

Universal compatibility:
- Handles missing pad tokens for any model
- Guards against unsupported system roles (Gemma, Phi, etc.)
- Conditionally applies BPE byte-fix only for Llama/GPT-2 family
"""

import modal
import os

app = modal.App("model-factory-inference")

inference_image = (
    modal.Image.from_registry("nvidia/cuda:12.1.1-devel-ubuntu22.04", add_python="3.11")
    .apt_install("git")
    .pip_install(
        "torch==2.3.0",
        "xformers",
        extra_index_url="https://download.pytorch.org/whl/cu121",
    )
    .pip_install(
        "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git",
        "peft",
        "boto3",
        "fastapi",
    )
)

model_cache = modal.Volume.from_name("model-factory-model-cache", create_if_missing=True)

# ────────────────────────────────────────────────────────────────────────────
# UNIVERSAL MODEL LOADING
# No hardcoded model map needed. Unsloth's FastLanguageModel.from_pretrained()
# automatically resolves ANY HuggingFace model ID to its best 4-bit variant.
# This means every model on HuggingFace works out of the box.
# ────────────────────────────────────────────────────────────────────────────

DEFAULT_MODEL = "meta-llama/Llama-3.1-8B-Instruct"


def _fix_bpe_text(text):
    """
    Fix BPE byte-level artifacts in decoded text.
    Llama/GPT-2 tokenizers use a byte-to-unicode mapping where non-printable
    bytes (0-32, 127-160, 173) are shifted to U+0100+. This function detects
    sequences of these shifted characters and decodes them back to proper UTF-8.
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
        self.loaded_base_model_id = None
        self.base_model = None
        self.tokenizer = None
        self.loaded_adapter_prefix = None
        self.active_model = None
        print("[Inference Container] Ready — model will be loaded on first request.")

    def _load_base_model(self, base_model_id: str):
        """Load (or swap) the base model into GPU VRAM.
        Unsloth auto-resolves any HuggingFace model ID to its best 4-bit variant.
        """
        from unsloth import FastLanguageModel

        # Skip reload if same model is already loaded
        if self.loaded_base_model_id == base_model_id and self.base_model is not None:
            return

        print(f"[Inference] Loading base model: {base_model_id} (Unsloth auto-resolves)")
        hf_token = os.environ.get("HF_TOKEN", None)

        # Monkey-patch fix_pad_token to suppress RuntimeError on models like phi-2
        import unsloth_zoo.pad_token as _pad_module
        _original_fix_pad_token = _pad_module.fix_pad_token

        def _safe_fix_pad_token(*args, **kwargs):
            try:
                return _original_fix_pad_token(*args, **kwargs)
            except RuntimeError as e:
                if "Could not find a valid pad token" in str(e):
                    print(f"[Inference] Suppressed Unsloth pad_token error: {e}")
                    tokenizer_arg = args[0] if args else kwargs.get("tokenizer")
                    return tokenizer_arg
                raise

        _pad_module.fix_pad_token = _safe_fix_pad_token

        self.base_model, self.tokenizer = FastLanguageModel.from_pretrained(
            model_name=base_model_id,
            max_seq_length=2048,
            dtype=None,
            load_in_4bit=True,
            cache_dir="/model-cache",
            token=hf_token,
        )

        # Restore original
        _pad_module.fix_pad_token = _original_fix_pad_token

        if self.tokenizer.pad_token_id is not None:
            self.base_model.config.pad_token_id = self.tokenizer.pad_token_id
        print(f"[Inference] Model loaded. pad_token={self.tokenizer.pad_token}, pad_token_id={self.tokenizer.pad_token_id}")

        self.loaded_base_model_id = base_model_id
        self.loaded_adapter_prefix = None  # Force adapter reload
        self.active_model = self.base_model

        # Cache whether this model supports the "system" role
        self._system_role_ok = self._check_system_role_support()

        # Cache whether this tokenizer uses byte-level BPE (Llama/GPT-2 family)
        self._needs_bpe_fix = self._check_byte_level_bpe()

        print(f"[Inference] Base model ready: {base_model_id} (system_role={self._system_role_ok}, bpe_fix={self._needs_bpe_fix})")

    def _check_system_role_support(self):
        """Check if the tokenizer's chat template supports a 'system' role."""
        template = getattr(self.tokenizer, "chat_template", None)
        if not template:
            return False
        if "system" in str(template):
            return True
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
        Qwen, Falcon, etc.) do NOT and would get their output corrupted."""
        tok_class = type(self.tokenizer).__name__.lower()
        byte_level_families = ["llama", "gpt2", "roberta", "bart", "codellama"]
        return any(family in tok_class for family in byte_level_families)

    @modal.fastapi_endpoint(method="POST")
    def generate(self, item: dict):
        """
        Generates chat completion using the correct base model + LoRA adapter.
        """
        import boto3
        import os as _os
        import torch
        from peft import PeftModel
        from unsloth import FastLanguageModel

        try:
            adapter_prefix = item.get("adapter_prefix")
            base_model_id = item.get("base_model", DEFAULT_MODEL)
            messages = item.get("messages", [])
            system_prompt = item.get("system_prompt", "You are a helpful assistant.")

            r2_endpoint = item.get("r2_endpoint")
            r2_access_key = item.get("r2_access_key")
            r2_secret_key = item.get("r2_secret_key")
            r2_bucket = item.get("r2_bucket")

            if not adapter_prefix:
                return {"error": "No adapter_prefix provided", "status": "failed"}

            # ── Load the correct base model ────────────────────────────────────────
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
                FastLanguageModel.for_inference(self.active_model)
                self.loaded_adapter_prefix = adapter_prefix
                print("[Inference] LoRA adapter attached successfully.")

            # ── Format messages into chat template ─────────────────────────────────
            has_template = getattr(self.tokenizer, "chat_template", None) is not None

            if has_template:
                # Build messages — guard system role if model doesn't support it
                if self._system_role_ok:
                    formatted_messages = [{"role": "system", "content": system_prompt}]
                else:
                    # Fold system prompt into first user message
                    formatted_messages = []

                for msg in messages:
                    role = "user" if msg.get("role") in ("user",) else "assistant"
                    content = msg.get("content", "")
                    # If system role not supported, prepend system prompt to first user message
                    if not self._system_role_ok and role == "user" and not formatted_messages:
                        content = f"{system_prompt}\n\n{content}"
                    formatted_messages.append({"role": role, "content": content})

                prompt = self.tokenizer.apply_chat_template(
                    formatted_messages,
                    tokenize=False,
                    add_generation_prompt=True,
                )
            else:
                # No chat template (base models like phi-2) — use plaintext format
                parts = [f"### System:\n{system_prompt}"]
                for msg in messages:
                    role = "User" if msg.get("role") == "user" else "Assistant"
                    parts.append(f"### {role}:\n{msg.get('content', '')}")
                parts.append("### Assistant:")
                prompt = "\n\n".join(parts)

            # ── Generate response ──────────────────────────────────────────────────
            inputs = self.tokenizer(prompt, return_tensors="pt").to(self.active_model.device)
            with torch.no_grad():
                outputs = self.active_model.generate(
                    **inputs,
                    max_new_tokens=512,
                    temperature=0.7,
                    do_sample=True,
                    pad_token_id=self.tokenizer.pad_token_id,
                )

            # Decode only the generated response
            new_tokens = outputs[0][inputs["input_ids"].shape[1]:]
            reply = self.tokenizer.decode(new_tokens, skip_special_tokens=True).strip()

            # ── Clean up output ────────────────────────────────────────────────────
            import re

            # 1. Strip reasoning/thinking blocks (DeepSeek R1 etc.)
            if "</think>" in reply:
                reply = reply.split("</think>")[-1].strip()
            reply = re.sub(r"<think>[\s\S]*?</think>", "", reply).strip()

            # 2. Fix BPE byte-level artifacts ONLY for tokenizers that use byte-level BPE
            #    (Llama, GPT-2 family). Applying this to other tokenizers corrupts output.
            if self._needs_bpe_fix:
                reply = _fix_bpe_text(reply)

            # 3. Final cleanup
            reply = re.sub(r"\n{3,}", "\n\n", reply).strip()

            print(f"[Inference] Generated reply ({len(reply)} chars) using {base_model_id}")
            return {"reply": reply, "status": "succeeded"}

        except Exception as err:
            print(f"[Inference Error] {err}")
            return {"error": str(err), "status": "failed"}
