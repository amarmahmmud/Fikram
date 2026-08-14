"""
Modal.com Inference Backend for Model Factory
===============================================
Deploy this file with: modal deploy modal_backend/inference.py

This creates a persistent web endpoint that:
1. Preloads the base Llama 3 8B Instruct model into GPU VRAM on boot
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
    def load_base_model(self):
        """Pre-load the base Llama 3 4-bit model once when the container starts."""
        from unsloth import FastLanguageModel
        print("[Inference Container] Loading base Llama 3 8B 4-bit into GPU VRAM...")
        self.base_model, self.tokenizer = FastLanguageModel.from_pretrained(
            model_name="unsloth/llama-3-8b-Instruct-bnb-4bit",
            max_seq_length=2048,
            dtype=None,
            load_in_4bit=True,
            cache_dir="/model-cache",
        )
        self.loaded_adapter_prefix = None
        self.active_model = self.base_model
        print("[Inference Container] Base model ready.")

    @modal.fastapi_endpoint(method="POST")
    def generate(self, item: dict):
        """
        Generates chat completion using the base model + LoRA adapter.
        """
        import boto3
        import os as _os
        import torch
        from peft import PeftModel
        from unsloth import FastLanguageModel

        try:
            adapter_prefix = item.get("adapter_prefix")
            messages = item.get("messages", [])
            system_prompt = item.get("system_prompt", "You are a helpful assistant.")

            r2_endpoint = item.get("r2_endpoint")
            r2_access_key = item.get("r2_access_key")
            r2_secret_key = item.get("r2_secret_key")
            r2_bucket = item.get("r2_bucket")

            if not adapter_prefix:
                return {"error": "No adapter_prefix provided", "status": "failed"}

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

            # ── Format messages into Llama 3 chat template ─────────────────────────
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

            print(f"[Inference] Generated reply ({len(reply)} chars)")
            return {"reply": reply, "status": "succeeded"}

        except Exception as err:
            print(f"[Inference Error] {err}")
            return {"error": str(err), "status": "failed"}
