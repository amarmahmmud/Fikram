"""
Modal.com CTC Fine-Tuning Backend for Model Factory
===================================================
Deploy with: modal deploy modal_backend/train.py

This script runs on Modal and:
1. Estimates GPU need and credit cost for a CTC fine-tuning job (estimate_cost endpoint — CPU-only).
2. Downloads audio clips and phoneme sequences from Cloudflare R2 / dataset_url.
3. Dynamically builds the phoneme vocabulary (<pad>:0, <unk>:1, phonemes...).
4. Fine-tunes Wav2Vec2ForCTC using the validated training recipe:
   - Frozen 7-layer convolutional feature encoder
   - Zero dropout during fine-tuning
   - Neutral lm_head.bias initialization
   - Differentiated AdamW learning rates (backbone=1e-4, lm_head=5e-4)
   - OneCycleLR cosine schedule
5. Evaluates a held-out split of the dataset on GPU using greedy CTC decode:
   - Computes PER (Phoneme Error Rate), count match, exact match, CER, and confusion matrix
6. Uploads trained model weights + vocab.json to Cloudflare R2 under adapters/{job_id}/
7. Reports actual usage + full eval_result to Next.js webhook for billing & UI rendering.
"""

import os
import time
import json
import subprocess
import urllib.request
from datetime import datetime
import modal

# ── Modal App Definition ──────────────────────────────────────────────────
app = modal.App("model-factory-trainer")

training_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "git")
    .pip_install(
        "torch>=2.1",
        "torchaudio>=2.1",
        "transformers>=4.40",
        "soundfile",
        "jiwer",
        "numpy",
        "boto3",
        "requests",
    )
)

planning_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "fastapi[standard]",
        "transformers>=4.40",
        "torch>=2.1",
        "requests",
    )
)

model_cache = modal.Volume.from_name("model-factory-model-cache", create_if_missing=True)


# ════════════════════════════════════════════════════════════════════════
# PRICING & HARDWARE CONFIG
# ════════════════════════════════════════════════════════════════════════
GPU_TIERS = [
    {"name": "L4", "modal_gpu": "L4", "vram_gb": 24, "hourly_cost_usd": 0.80},
    {"name": "A10G", "modal_gpu": "A10G", "vram_gb": 24, "hourly_cost_usd": 1.10},
    {"name": "A100-40GB", "modal_gpu": "A100-40GB", "vram_gb": 40, "hourly_cost_usd": 1.85},
]

CREDIT_MARKUP_MULTIPLIER = 1.5
CREDITS_PER_USD = 100  # 1 credit = $0.01
FAILED_JOB_FLAT_FEE_CREDITS = 25
SAMPLE_RATE = 16000


def get_s3_client(r2_endpoint: str, r2_access_key: str, r2_secret_key: str):
    import boto3
    endpoint = r2_endpoint or os.environ.get("R2_ENDPOINT", "")
    access_key = r2_access_key or os.environ.get("AWS_ACCESS_KEY_ID", "")
    secret_key = r2_secret_key or os.environ.get("AWS_SECRET_ACCESS_KEY", "")
    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )


# ════════════════════════════════════════════════════════════════════════
# CORE GPU TRAINING FUNCTION
# ════════════════════════════════════════════════════════════════════════
@app.function(
    image=training_image,
    gpu="A10G",
    timeout=1800,
    volumes={"/root/.cache/huggingface": model_cache},
)
def train_model(
    job_id: str,
    dataset_url: str,
    webhook_url: str,
    base_model: str = "facebook/wav2vec2-base",
    learning_rate: float = 1e-4,
    epochs: int = 150,
    batch_size: int = 4,
    confirmed_credit_hold: float = 0.0,
    r2_endpoint: str = "",
    r2_access_key: str = "",
    r2_secret_key: str = "",
    r2_bucket: str = "",
    supabase_url: str = "",
    supabase_key: str = "",
):
    import torch
    import numpy as np
    import soundfile as sf
    import jiwer
    import requests
    from transformers import Wav2Vec2ForCTC, Wav2Vec2FeatureExtractor

    job_start_time = time.time()
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"[Model Factory] Starting CTC training for job {job_id} on {DEVICE}")

    def notify_failure(error_msg: str):
        elapsed = time.time() - job_start_time
        print(f"[Model Factory] Notifying failure to webhook: {error_msg}")
        if webhook_url:
            for attempt in range(1, 4):
                try:
                    res = requests.post(
                        webhook_url,
                        headers={"Bypass-Tunnel-Reminder": "true", "User-Agent": "Modal-Trainer/1.0"},
                        json={
                            "job_id": job_id,
                            "status": "failed",
                            "error": str(error_msg),
                            "actual_gpu_seconds": round(elapsed),
                            "credits_to_charge": FAILED_JOB_FLAT_FEE_CREDITS,
                        },
                        timeout=30,
                    )
                    if res.status_code == 200:
                        print(f"[Model Factory] Failure webhook delivered on attempt {attempt}")
                        break
                    else:
                        print(f"[Model Factory] Failure webhook attempt {attempt} returned HTTP {res.status_code}")
                except Exception as e:
                    print(f"[Model Factory] Failure webhook attempt {attempt} failed: {e}")
                time.sleep(2)

    try:
        # ── Step 1: Download and parse dataset ──
        print(f"[Model Factory] Downloading dataset from {dataset_url}...")
        local_dataset_path = f"/tmp/dataset_{job_id}.jsonl"

        if dataset_url.startswith("http://") or dataset_url.startswith("https://"):
            urllib.request.urlretrieve(dataset_url, local_dataset_path)
        else:
            # Assume R2 storage key
            s3 = get_s3_client(r2_endpoint, r2_access_key, r2_secret_key)
            bucket = r2_bucket or os.environ.get("R2_BUCKET", "")
            s3.download_file(bucket, dataset_url, local_dataset_path)

        raw_items = []
        with open(local_dataset_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    raw_items.append(json.loads(line))

        if not raw_items:
            raise ValueError("Dataset JSONL is empty")

        print(f"[Model Factory] Parsed {len(raw_items)} dataset items")

        # ── Step 2: Download & preprocess audio clips ──
        s3 = None
        bucket = r2_bucket or os.environ.get("R2_BUCKET", "")
        processed_clips = []

        for idx, item in enumerate(raw_items):
            clip_id = item.get("audioClipId") or item.get("id") or f"clip_{idx}"
            audio_url = item.get("audioUrl") or item.get("audio_url")
            r2_key = item.get("audioR2Key") or item.get("r2Key")

            # Extract phoneme sequence
            phonemes = []
            if "phonemes" in item and isinstance(item["phonemes"], list):
                phonemes = [str(p) for p in item["phonemes"]]
            elif "qpsSequence" in item and isinstance(item["qpsSequence"], str):
                phonemes = item["qpsSequence"].split()
            elif "phonemeLabels" in item and isinstance(item["phonemeLabels"], list):
                phonemes = [str(l["phoneme"]) for l in item["phonemeLabels"] if "phoneme" in l]

            if not phonemes:
                print(f"[Model Factory] Skipping clip {clip_id}: no phoneme labels found")
                continue

            # Fetch audio file
            raw_audio_path = f"/tmp/{job_id}_{idx}_raw"
            wav_16k_path = f"/tmp/{job_id}_{idx}_16k.wav"

            downloaded = False
            if audio_url and (audio_url.startswith("http://") or audio_url.startswith("https://")):
                try:
                    urllib.request.urlretrieve(audio_url, raw_audio_path)
                    downloaded = True
                except Exception as dl_err:
                    print(f"[Model Factory] Failed to download audio URL {audio_url}: {dl_err}")

            if not downloaded and r2_key:
                if s3 is None:
                    s3 = get_s3_client(r2_endpoint, r2_access_key, r2_secret_key)
                try:
                    s3.download_file(bucket, r2_key, raw_audio_path)
                    downloaded = True
                except Exception as s3_err:
                    print(f"[Model Factory] Failed to download from R2 {r2_key}: {s3_err}")

            if not downloaded:
                print(f"[Model Factory] Could not retrieve audio for clip {clip_id}")
                continue

            # Normalize to 16kHz mono WAV via ffmpeg
            res = subprocess.run(
                [
                    "ffmpeg", "-y", "-i", raw_audio_path,
                    "-ar", str(SAMPLE_RATE), "-ac", "1",
                    wav_16k_path,
                ],
                capture_output=True,
                text=True,
            )
            if res.returncode != 0:
                print(f"[Model Factory] ffmpeg conversion failed for clip {clip_id}: {res.stderr}")
                continue

            audio_data, sr = sf.read(wav_16k_path)
            if audio_data.ndim > 1:
                audio_data = audio_data[:, 0]

            dur_s = len(audio_data) / SAMPLE_RATE

            # Quranic / EveryAyah Bismillah trimming:
            # If the clip is much longer than expected for its phoneme count,
            # an introductory Bismillah or recitation was included. Trim from end
            # so the audio aligns with the target phonemes (exact Test 3 recipe).
            expected_s = len(phonemes) * 0.4 + 1.5
            if dur_s > expected_s + 3.0:
                keep_s = max(expected_s + 1.0, dur_s * 0.35)
                keep_samples = int(keep_s * SAMPLE_RATE)
                audio_data = audio_data[-keep_samples:]

            # Pad short clips to minimum 500ms
            min_samples = int(0.5 * SAMPLE_RATE)
            if len(audio_data) < min_samples:
                audio_data = np.pad(audio_data, (0, min_samples - len(audio_data)))

            processed_clips.append({
                "id": clip_id,
                "audio": audio_data.astype(np.float32),
                "phonemes": phonemes,
                "split": item.get("split", "auto"),
            })

        if len(processed_clips) < 3:
            raise ValueError(f"Only {len(processed_clips)} valid audio clips could be loaded (need at least 3)")

        # ── Step 3: Build dynamic vocabulary ──
        unique_phonemes = sorted(list(set(p for clip in processed_clips for p in clip["phonemes"])))
        vocab = {"<pad>": 0, "<unk>": 1}
        for p in unique_phonemes:
            if p not in vocab:
                vocab[p] = len(vocab)
        id_to_phoneme = {v: k for k, v in vocab.items()}
        vocab_size = len(vocab)
        print(f"[Model Factory] Vocabulary built: {vocab_size} tokens ({len(unique_phonemes)} distinct phonemes)")

        # ── Step 4: Train/Held-Out Split ──
        pre_train = [c for c in processed_clips if c["split"] == "train"]
        pre_eval = [c for c in processed_clips if c["split"] == "eval"]

        if pre_train and pre_eval:
            train_clips = pre_train
            heldout_clips = pre_eval
        else:
            # Deterministic 80/20 split
            n_total = len(processed_clips)
            n_heldout = max(1, int(round(n_total * 0.20))) if n_total >= 5 else 1
            heldout_clips = processed_clips[-n_heldout:]
            train_clips = processed_clips[:-n_heldout]

        print(f"[Model Factory] Dataset split: {len(train_clips)} train, {len(heldout_clips)} held-out")

        # ── Step 5: Initialize Model & Optimizer ──
        print(f"[Model Factory] Loading base checkpoint {base_model}...")
        fe = Wav2Vec2FeatureExtractor(
            feature_size=1,
            sampling_rate=SAMPLE_RATE,
            padding_value=0.0,
            do_normalize=True,
            return_attention_mask=True,
        )

        model = Wav2Vec2ForCTC.from_pretrained(
            base_model,
            ctc_loss_reduction="mean",
            pad_token_id=0,
            vocab_size=vocab_size,
            ignore_mismatched_sizes=True,
        )

        # Frozen feature encoder & zero dropout fine-tuning recipe
        model.freeze_feature_encoder()
        model.config.attention_dropout = 0.0
        model.config.hidden_dropout = 0.0
        model.config.feat_proj_dropout = 0.0
        model.config.final_dropout = 0.0
        model.config.ctc_zero_infinity = True
        model.config.mask_time_prob = 0.0

        with torch.no_grad():
            model.lm_head.bias.fill_(0.0)
        model.to(DEVICE)

        def collate_fn(batch):
            feats = fe(
                [item["audio"] for item in batch],
                sampling_rate=SAMPLE_RATE,
                return_tensors="pt",
                padding=True,
            )
            seqs = [[vocab.get(p, 1) for p in item["phonemes"]] for item in batch]
            max_len = max(len(s) for s in seqs)
            labels = torch.full((len(batch), max_len), -100, dtype=torch.long)
            for i, seq in enumerate(seqs):
                labels[i, :len(seq)] = torch.tensor(seq, dtype=torch.long)
            return {
                "input_values": feats.input_values.to(DEVICE),
                "attention_mask": feats.attention_mask.to(DEVICE),
                "labels": labels.to(DEVICE),
            }

        # Differentiated learning rates
        bb_lr = float(learning_rate) if learning_rate else 1e-4
        hd_lr = bb_lr * 5.0

        backbone_params = [p for n, p in model.named_parameters() if p.requires_grad and "lm_head" not in n]
        head_params = [p for n, p in model.named_parameters() if p.requires_grad and "lm_head" in n]

        optimizer = torch.optim.AdamW(
            [
                {"params": backbone_params, "lr": bb_lr},
                {"params": head_params, "lr": hd_lr},
            ],
            weight_decay=0.01,
        )

        actual_batch_size = min(batch_size, len(train_clips))
        num_batches = (len(train_clips) + actual_batch_size - 1) // actual_batch_size
        num_epochs = max(20, min(epochs, 250))
        total_steps = num_epochs * num_batches

        scheduler = torch.optim.lr_scheduler.OneCycleLR(
            optimizer,
            max_lr=[bb_lr, hd_lr],
            total_steps=total_steps,
            pct_start=0.15,
            anneal_strategy="cos",
        )

        # ── Step 6: Training Loop ──
        print(f"[Model Factory] Training {len(train_clips)} clips for {num_epochs} epochs ({total_steps} steps)")
        model.train()
        indices = np.arange(len(train_clips))
        best_loss = float("inf")
        best_state = None

        for epoch in range(1, num_epochs + 1):
            np.random.shuffle(indices)
            batches = [
                [train_clips[indices[j]] for j in range(i, min(i + actual_batch_size, len(indices)))]
                for i in range(0, len(indices), actual_batch_size)
            ]

            epoch_loss = 0.0
            n_step = 0
            for batch_data in batches:
                batch = collate_fn(batch_data)
                out = model(
                    input_values=batch["input_values"],
                    attention_mask=batch["attention_mask"],
                    labels=batch["labels"],
                )
                loss = out.loss
                if torch.isnan(loss) or torch.isinf(loss):
                    continue

                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
                optimizer.step()
                scheduler.step()
                optimizer.zero_grad()

                epoch_loss += loss.item()
                n_step += 1

            if n_step > 0:
                avg = epoch_loss / n_step
                if avg < best_loss:
                    best_loss = avg
                    best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

            if epoch == 1 or epoch % 25 == 0 or epoch == num_epochs:
                print(f"[Model Factory] Epoch {epoch:3d}/{num_epochs} | loss: {avg:.4f}")

        if best_state is not None:
            model.load_state_dict(best_state)
            model.to(DEVICE)

        # ── Step 7: GPU Evaluation on Held-Out Split ──
        print("[Model Factory] Evaluating held-out split on GPU...")
        model.eval()

        def ctc_greedy_decode(pred_ids):
            collapsed = []
            prev = None
            for t in pred_ids:
                if t != prev:
                    collapsed.append(t)
                    prev = t
            return [id_to_phoneme[t] for t in collapsed if t != 0 and t in id_to_phoneme]

        all_refs = []
        all_hyps = []
        count_ok = 0
        exact_ok = 0
        confusions = {}

        with torch.no_grad():
            for item in heldout_clips:
                feats = fe(
                    item["audio"],
                    sampling_rate=SAMPLE_RATE,
                    return_tensors="pt",
                    padding=True,
                )
                logits = model(feats.input_values.to(DEVICE)).logits
                ids = torch.argmax(logits, dim=-1)[0].cpu().tolist()
                pred = ctc_greedy_decode(ids)

                expected = item["phonemes"]
                ref_str = " ".join(expected)
                hyp_str = " ".join(pred)

                all_refs.append(ref_str)
                all_hyps.append(hyp_str)

                if abs(len(pred) - len(expected)) <= 1:
                    count_ok += 1
                if pred == expected:
                    exact_ok += 1

                tag = "OK" if pred == expected else ("~ " if abs(len(pred) - len(expected)) <= 1 else "X ")
                print(f"[Model Factory Eval] [{tag}] {item['id']}: expect='{ref_str}' got='{hyp_str}'")

                # Track simple substitution confusions
                min_len = min(len(expected), len(pred))
                for idx in range(min_len):
                    e_p, g_p = expected[idx], pred[idx]
                    if e_p != g_p:
                        key = f"{e_p}->{g_p}"
                        confusions[key] = confusions.get(key, 0) + 1

        n_eval = len(heldout_clips)
        per = float(jiwer.wer(all_refs, all_hyps)) if all_refs else 0.0
        cer = float(jiwer.cer(all_refs, all_hyps)) if all_refs else 0.0
        count_pct = float(count_ok / n_eval * 100) if n_eval else 0.0
        exact_pct = float(exact_ok / n_eval * 100) if n_eval else 0.0

        confusion_list = []
        for k, cnt in sorted(confusions.items(), key=lambda x: -x[1])[:10]:
            exp_p, got_p = k.split("->")
            confusion_list.append({"expected": exp_p, "got": got_p, "count": cnt})

        total_phonemes = sum(len(c["phonemes"]) for c in heldout_clips)

        eval_result = {
            "per": round(per, 4),
            "cer": round(cer, 4),
            "wer": round(per, 4),  # Standardized for UI
            "count_match_pct": round(count_pct, 1),
            "exact_match_pct": round(exact_pct, 1),
            "total_segments_evaluated": n_eval,
            "total_phonemes_compared": total_phonemes,
            "confusion_matrix": confusion_list,
            "per_tajweed_rule": {},
            "evaluated_at": datetime.utcnow().isoformat() + "Z",
            "had_errors": False,
        }

        print(f"[Model Factory] Evaluation results: PER={per*100:.1f}%, Exact={exact_pct:.1f}%, Count={count_pct:.1f}%")

        # ── Step 8: Save weights & vocab to R2 ──
        out_dir = f"/tmp/model_{job_id}"
        os.makedirs(out_dir, exist_ok=True)
        model.save_pretrained(out_dir)
        fe.save_pretrained(out_dir)
        with open(os.path.join(out_dir, "vocab.json"), "w", encoding="utf-8") as f:
            json.dump(vocab, f, ensure_ascii=False, indent=2)

        print("[Model Factory] Uploading model artifacts to Cloudflare R2...")
        if s3 is None:
            s3 = get_s3_client(r2_endpoint, r2_access_key, r2_secret_key)

        for fname in os.listdir(out_dir):
            fpath = os.path.join(out_dir, fname)
            s3_key = f"adapters/{job_id}/{fname}"
            s3.upload_file(fpath, bucket, s3_key)
            print(f"[Model Factory] Uploaded: {s3_key}")

        adapter_prefix = f"adapters/{job_id}"

        # ── Step 9: Reconcile usage and notify webhook ──
        elapsed_seconds = time.time() - job_start_time
        tier = GPU_TIERS[1]  # A10G
        actual_cost_usd = (elapsed_seconds / 3600) * tier["hourly_cost_usd"]
        actual_credits = max(10, round(actual_cost_usd * CREDIT_MARKUP_MULTIPLIER * CREDITS_PER_USD))

        print(f"[Model Factory] Notifying completion webhook: {webhook_url}")
        if webhook_url:
            for attempt in range(1, 4):
                try:
                    res = requests.post(
                        webhook_url,
                        headers={"Bypass-Tunnel-Reminder": "true", "User-Agent": "Modal-Trainer/1.0"},
                        json={
                            "job_id": job_id,
                            "status": "completed",
                            "adapter_prefix": adapter_prefix,
                            "resolved_base_model": base_model,
                            "actual_gpu_seconds": round(elapsed_seconds),
                            "actual_credits": actual_credits,
                            "eval_result": eval_result,
                        },
                        timeout=30,
                    )
                    if res.status_code == 200:
                        print(f"[Model Factory] Completion webhook successfully delivered on attempt {attempt}: HTTP 200")
                        break
                    else:
                        print(f"[Model Factory] Completion webhook attempt {attempt} returned HTTP {res.status_code}: {res.text[:200]}")
                except Exception as e:
                    print(f"[Model Factory] Completion webhook attempt {attempt} failed: {e}")
                time.sleep(2)

        # ── Step 10: Direct Supabase sync guarantee ──
        if supabase_url and supabase_key:
            try:
                sb_headers = {
                    "apikey": supabase_key,
                    "Authorization": f"Bearer {supabase_key}",
                    "Content-Type": "application/json",
                    "Prefer": "return=representation",
                }
                get_res = requests.get(f"{supabase_url}/rest/v1/jobs?id=eq.{job_id}&select=config,user_id", headers=sb_headers, timeout=15)
                if get_res.ok and get_res.json():
                    row = get_res.json()[0]
                    cfg = row.get("config") or {}
                    cfg["actual_gpu_seconds"] = round(elapsed_seconds)
                    cfg["actual_credits"] = actual_credits
                    cfg["eval_status"] = "completed"
                    cfg["eval_result"] = eval_result
                    user_id = row.get("user_id")

                    requests.patch(
                        f"{supabase_url}/rest/v1/jobs?id=eq.{job_id}",
                        headers=sb_headers,
                        json={
                            "status": "completed",
                            "result_url": adapter_prefix,
                            "completed_at": datetime.utcnow().isoformat() + "Z",
                            "credits_used": actual_credits,
                            "config": cfg,
                        },
                        timeout=15,
                    )
                    print(f"[Model Factory] Direct Supabase sync completed for job {job_id}")

                    if user_id and confirmed_credit_hold > 0:
                        prof_res = requests.get(f"{supabase_url}/rest/v1/profiles?id=eq.{user_id}&select=credits_balance,credits_held", headers=sb_headers, timeout=15)
                        if prof_res.ok and prof_res.json():
                            p = prof_res.json()[0]
                            held = p.get("credits_held", 0)
                            bal = p.get("credits_balance", 0)
                            excess = max(0, confirmed_credit_hold - actual_credits)
                            requests.patch(
                                f"{supabase_url}/rest/v1/profiles?id=eq.{user_id}",
                                headers=sb_headers,
                                json={
                                    "credits_balance": bal + excess,
                                    "credits_held": max(0, held - confirmed_credit_hold),
                                },
                                timeout=15,
                            )
                            print(f"[Model Factory] Direct Supabase billing settled: charged {actual_credits}, refunded {excess}")
            except Exception as sb_err:
                print(f"[Model Factory] Direct Supabase sync warning: {sb_err}")

        return {
            "status": "completed",
            "adapter_prefix": adapter_prefix,
            "eval_result": eval_result,
        }

    except Exception as err:
        print(f"[Model Factory] Training fatal error: {err}")
        notify_failure(str(err))
        raise err


# ════════════════════════════════════════════════════════════════════════
# PRE-JOB PLANNING & COST ESTIMATION (CPU-ONLY)
# ════════════════════════════════════════════════════════════════════════
@app.function(image=planning_image, timeout=60)
@modal.fastapi_endpoint(method="POST")
def estimate_cost(item: dict):
    dataset_size = int(item.get("dataset_size", 50))
    base_model = item.get("base_model", "facebook/wav2vec2-base")

    # Hardware & parameter characteristics
    tier = GPU_TIERS[1]  # A10G
    num_epochs = 150
    batch_size = 4
    total_steps = (dataset_size // batch_size + 1) * num_epochs

    # Calibration: ~0.025s per step on A10G + 60s load overhead
    estimated_seconds = 60.0 + (total_steps * 0.025)
    estimated_hours = estimated_seconds / 3600
    raw_cost_usd = estimated_hours * tier["hourly_cost_usd"]
    estimated_credits = max(25, round(raw_cost_usd * CREDIT_MARKUP_MULTIPLIER * CREDITS_PER_USD))

    return {
        "status": "ok",
        "resolved_model": base_model,
        "gpu_tier": tier["name"],
        "modal_gpu": tier["modal_gpu"],
        "estimated_vram_gb": 3.0,
        "estimated_seconds": round(estimated_seconds),
        "estimated_credits": estimated_credits,
        "num_train_epochs": num_epochs,
        "batch_size": batch_size,
    }


# ════════════════════════════════════════════════════════════════════════
# START TRAINING ENDPOINT
# ════════════════════════════════════════════════════════════════════════
@app.function(image=planning_image, timeout=60)
@modal.fastapi_endpoint(method="POST")
def start_training(item: dict):
    job_id = item.get("job_id")
    dataset_url = item.get("dataset_url")
    webhook_url = item.get("webhook_url")
    base_model = item.get("base_model", "facebook/wav2vec2-base")
    dataset_size = int(item.get("dataset_size", 50))
    learning_rate = item.get("learning_rate", 1e-4)
    confirmed_credit_hold = float(item.get("confirmed_credit_hold", 0.0))
    r2_endpoint = item.get("r2_endpoint", "")
    r2_access_key = item.get("r2_access_key", "")
    r2_secret_key = item.get("r2_secret_key", "")
    r2_bucket = item.get("r2_bucket", "")
    supabase_url = item.get("supabase_url", "")
    supabase_key = item.get("supabase_key", "")

    if not job_id or not dataset_url:
        return {"status": "failed", "error": "Missing job_id or dataset_url"}

    tier = GPU_TIERS[1]  # A10G
    total_steps = (dataset_size // 4 + 1) * 150
    estimated_seconds = 60.0 + (total_steps * 0.025)
    estimated_credits = max(25, round((estimated_seconds / 3600) * tier["hourly_cost_usd"] * CREDIT_MARKUP_MULTIPLIER * CREDITS_PER_USD))

    print(f"[Model Factory] Spawning train_model for job {job_id} on {tier['name']}")
    call = train_model.with_options(gpu=tier["modal_gpu"]).spawn(
        job_id=job_id,
        dataset_url=dataset_url,
        webhook_url=webhook_url,
        base_model=base_model,
        learning_rate=float(learning_rate),
        epochs=150,
        batch_size=4,
        confirmed_credit_hold=confirmed_credit_hold or float(estimated_credits),
        r2_endpoint=r2_endpoint,
        r2_access_key=r2_access_key,
        r2_secret_key=r2_secret_key,
        r2_bucket=r2_bucket,
        supabase_url=supabase_url,
        supabase_key=supabase_key,
    )

    return {
        "status": "started",
        "call_id": call.object_id,
        "gpu_tier": tier["name"],
        "estimated_credits": estimated_credits,
    }


@app.local_entrypoint()
def main():
    print("Modal CTC Training backend loaded.")
    print("Deploy with: modal deploy modal_backend/train.py")