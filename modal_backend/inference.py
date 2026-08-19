"""
Modal.com Inference Backend for Model Factory
===============================================
Deploy this file with: modal deploy modal_backend/inference.py

This creates a persistent web endpoint that:
1. Loads the correct base model (user's chosen model) into GPU VRAM
2. Hot-loads the user's LoRA adapter from Cloudflare R2
3. Generates chat responses with low latency
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

# Map user-facing model IDs to Unsloth's 4-bit quantized variants
UNSLOTH_MODEL_MAP = {
    "meta-llama/Llama-3.1-8B-Instruct": "unsloth/Meta-Llama-3.1-8B-Instruct-bnb-4bit",
    "meta-llama/Llama-3.2-3B-Instruct": "unsloth/Llama-3.2-3B-Instruct-bnb-4bit",
    "mistralai/Mistral-7B-Instruct-v0.3": "unsloth/mistral-7b-instruct-v0.3-bnb-4bit",
    "microsoft/Phi-3-mini-4k-instruct": "unsloth/Phi-3-mini-4k-instruct-bnb-4bit",
    "microsoft/Phi-3.5-mini-instruct": "unsloth/Phi-3.5-mini-instruct-bnb-4bit",
    "google/gemma-2-9b-it": "unsloth/gemma-2-9b-it-bnb-4bit",
    "google/gemma-2-2b-it": "unsloth/gemma-2-2b-it-bnb-4bit",
    "Qwen/Qwen2.5-7B-Instruct": "unsloth/Qwen2.5-7B-Instruct-bnb-4bit",
    "deepseek-ai/DeepSeek-R1-Distill-Llama-8B": "unsloth/DeepSeek-R1-Distill-Llama-8B-bnb-4bit",
    "meta-llama/CodeLlama-7b-Instruct-hf": "unsloth/codellama-7b-instruct-bnb-4bit",
    "TinyLlama/TinyLlama-1.1B-Chat-v1.0": "unsloth/tinyllama-chat-bnb-4bit",
    "tiiuae/falcon-7b-instruct": "tiiuae/falcon-7b-instruct",
    "microsoft/phi-2": "unsloth/phi-2-bnb-4bit",
}

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
        """Load (or swap) the base model into GPU VRAM."""
        from unsloth import FastLanguageModel

        resolved = UNSLOTH_MODEL_MAP.get(base_model_id, base_model_id)

        # Skip reload if same model is already loaded
        if self.loaded_base_model_id == base_model_id and self.base_model is not None:
            return

        print(f"[Inference] Loading base model: {base_model_id} → {resolved}")
        self.base_model, self.tokenizer = FastLanguageModel.from_pretrained(
            model_name=resolved,
            max_seq_length=2048,
            dtype=None,
            load_in_4bit=True,
            cache_dir="/model-cache",
        )
        self.loaded_base_model_id = base_model_id
        self.loaded_adapter_prefix = None  # Force adapter reload
        self.active_model = self.base_model
        print(f"[Inference] Base model ready: {resolved}")

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
            formatted_messages = [{"role": "system", "content": system_prompt}]
            for msg in messages:
                role = "user" if msg.get("role") in ("user",) else "assistant"
                formatted_messages.append({"role": role, "content": msg.get("content", "")})

            prompt = self.tokenizer.apply_chat_template(
                formatted_messages,
                tokenize=False,
                add_generation_prompt=True,
            )

            # ── Generate response ──────────────────────────────────────────────────
            inputs = self.tokenizer(prompt, return_tensors="pt").to(self.active_model.device)
            with torch.no_grad():
                outputs = self.active_model.generate(
                    **inputs,
                    max_new_tokens=512,
                    temperature=0.7,
                    do_sample=True,
                    pad_token_id=self.tokenizer.eos_token_id,
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

            # 2. Fix BPE byte-level artifacts using the GPT-2 byte decoder.
            #    Llama/GPT-2 tokenizers map non-printable bytes to Unicode chars
            #    in the U+0100+ range. This reverses that mapping.
            reply = _fix_bpe_text(reply)

            # 3. Final cleanup
            reply = re.sub(r"\n{3,}", "\n\n", reply).strip()

            print(f"[Inference] Generated reply ({len(reply)} chars) using {base_model_id}")
            return {"reply": reply, "status": "succeeded"}

        except Exception as err:
            print(f"[Inference Error] {err}")
            return {"error": str(err), "status": "failed"}
