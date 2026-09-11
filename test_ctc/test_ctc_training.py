"""
Minimal CTC Fine-Tuning Validation Script
==========================================

Proves the core training mechanics work end-to-end:
  1. Loads wav2vec2-base + custom QPS phoneme vocabulary
  2. Fine-tunes on 20 toy clips for 10 epochs (full fine-tune, no LoRA)
  3. Prints loss per epoch — should decrease
  4. Runs inference on 3 training clips — should roughly memorize them
  5. Computes PER via jiwer — confirms eval math works

This is a STANDALONE script. No VAD, no R2, no Supabase, no Next.js.
Run after generate_toy_data.py has created test_ctc/toy_clips/.

Usage:
    pip install transformers torch torchaudio soundfile jiwer
    python generate_toy_data.py
    python test_ctc_training.py

Expected output:
    - Loss decreasing from ~3-4 down to <0.5 over 10 epochs
    - Predicted phonemes roughly matching labels on training clips
    - PER printed (should be low on memorized training data)
"""

import os
import json
import glob
import torch
import torchaudio
import numpy as np
import soundfile as sf
from pathlib import Path

from transformers import (
    Wav2Vec2ForCTC,
    Wav2Vec2CTCTokenizer,
    Wav2Vec2FeatureExtractor,
    Wav2Vec2Processor,
    Wav2Vec2Config,
)

# ─────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────

BASE_CHECKPOINT = "facebook/wav2vec2-base"  # 95M params, fast to load
SAMPLE_RATE = 16000
NUM_EPOCHS = 15
LEARNING_RATE = 3e-4
BATCH_SIZE = 4  # Small batch for 20 clips
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

DATA_DIR = os.path.join(os.path.dirname(__file__), "toy_clips")
VOCAB_PATH = os.path.join(DATA_DIR, "vocab.json")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "output_model")


# ─────────────────────────────────────────────
# Data Loading
# ─────────────────────────────────────────────

def load_dataset(data_dir: str) -> list[dict]:
    """Load all clip/label pairs from the toy_clips directory."""
    pairs = []
    wav_files = sorted(glob.glob(os.path.join(data_dir, "*.wav")))

    for wav_path in wav_files:
        txt_path = wav_path.replace(".wav", ".txt")
        if not os.path.exists(txt_path):
            print(f"  WARNING: No label file for {wav_path}, skipping")
            continue

        with open(txt_path, "r", encoding="utf-8") as f:
            label = f.read().strip()

        pairs.append({
            "audio_path": wav_path,
            "label": label,
            "name": os.path.basename(wav_path),
        })

    return pairs


def load_audio(path: str, target_sr: int = 16000) -> np.ndarray:
    """Load and resample audio to 16kHz mono."""
    audio, sr = sf.read(path, dtype="float32")
    if len(audio.shape) > 1:
        audio = audio.mean(axis=1)  # stereo → mono
    if sr != target_sr:
        audio_tensor = torch.tensor(audio).unsqueeze(0)
        resampler = torchaudio.transforms.Resample(sr, target_sr)
        audio = resampler(audio_tensor).squeeze(0).numpy()
    return audio


# ─────────────────────────────────────────────
# Tokenizer + Processor Setup
# ─────────────────────────────────────────────

def build_processor(vocab_path: str) -> Wav2Vec2Processor:
    """Build a Wav2Vec2Processor with our custom QPS phoneme vocabulary."""
    tokenizer = Wav2Vec2CTCTokenizer(
        vocab_path,
        unk_token="<unk>",
        pad_token="<pad>",
        word_delimiter_token="|",
    )

    feature_extractor = Wav2Vec2FeatureExtractor(
        feature_size=1,
        sampling_rate=SAMPLE_RATE,
        padding_value=0.0,
        do_normalize=True,
        return_attention_mask=True,
    )

    return Wav2Vec2Processor(
        feature_extractor=feature_extractor,
        tokenizer=tokenizer,
    )


# ─────────────────────────────────────────────
# Collator
# ─────────────────────────────────────────────

class CTCDataCollator:
    """Collate audio + labels into padded batches for CTC training."""

    def __init__(self, processor: Wav2Vec2Processor):
        self.processor = processor

    def __call__(self, batch: list[dict]) -> dict:
        # Process audio
        input_values = self.processor(
            [item["audio"] for item in batch],
            sampling_rate=SAMPLE_RATE,
            return_tensors="pt",
            padding=True,
        )

        # Process labels directly via tokenizer
        labels_batch = self.processor.tokenizer(
            [item["label"] for item in batch],
            return_tensors="pt",
            padding=True,
        )

        # Replace padding token id with -100 so CTC loss ignores them
        labels = labels_batch["input_ids"].masked_fill(
            labels_batch.attention_mask.ne(1), -100
        )

        return {
            "input_values": input_values.input_values,
            "attention_mask": input_values.attention_mask,
            "labels": labels,
        }


# ─────────────────────────────────────────────
# Training Loop
# ─────────────────────────────────────────────

def train():
    print("=" * 60)
    print("CTC Fine-Tuning Validation")
    print("=" * 60)
    print(f"Device:     {DEVICE}")
    print(f"Checkpoint: {BASE_CHECKPOINT}")
    print(f"Epochs:     {NUM_EPOCHS}")
    print(f"LR:         {LEARNING_RATE}")
    print(f"Batch size: {BATCH_SIZE}")
    print()

    # ── Load data ──
    print("Loading toy dataset...")
    dataset = load_dataset(DATA_DIR)
    if len(dataset) == 0:
        print("ERROR: No data found! Run generate_toy_data.py first.")
        return
    print(f"  Loaded {len(dataset)} clips")

    # Load audio into memory
    for item in dataset:
        item["audio"] = load_audio(item["audio_path"])
        dur_ms = len(item["audio"]) / SAMPLE_RATE * 1000
        print(f"    {item['name']:>12s}  {dur_ms:5.0f}ms  label: {item['label']}")

    # ── Build processor ──
    print("\nBuilding processor with custom vocab...")
    if not os.path.exists(VOCAB_PATH):
        print(f"ERROR: Vocab file not found at {VOCAB_PATH}")
        print("Run generate_toy_data.py first.")
        return

    processor = build_processor(VOCAB_PATH)
    vocab_size = len(processor.tokenizer)
    print(f"  Vocab size: {vocab_size}")

    # ── Load model ──
    print(f"\nLoading {BASE_CHECKPOINT}...")
    model = Wav2Vec2ForCTC.from_pretrained(
        BASE_CHECKPOINT,
        ctc_loss_reduction="mean",
        pad_token_id=processor.tokenizer.pad_token_id,
        vocab_size=vocab_size,
        ignore_mismatched_sizes=True,  # We're replacing the head
    )

    # Freeze the feature extractor (standard practice for wav2vec2 fine-tuning)
    model.freeze_feature_encoder()
    model.to(DEVICE)

    trainable_params = sum(p.numel() for p in model.parameters() if p.requires_grad)
    total_params = sum(p.numel() for p in model.parameters())
    print(f"  Total params:     {total_params:,}")
    print(f"  Trainable params: {trainable_params:,}")
    print(f"  Frozen:           {total_params - trainable_params:,} (feature encoder)")

    # ── Prepare batches ──
    collator = CTCDataCollator(processor)

    # Simple manual batching (no DataLoader needed for 20 clips)
    def make_batches(data, batch_size):
        batches = []
        for i in range(0, len(data), batch_size):
            batches.append(data[i : i + batch_size])
        return batches

    batches = make_batches(dataset, BATCH_SIZE)
    print(f"\n  {len(batches)} batches of size {BATCH_SIZE}")

    # ── Optimizer ──
    optimizer = torch.optim.AdamW(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr=LEARNING_RATE,
        weight_decay=0.005,
    )

    # ── Training ──
    print("\n" + "─" * 60)
    print("TRAINING")
    print("─" * 60)

    loss_history = []
    model.train()

    for epoch in range(1, NUM_EPOCHS + 1):
        epoch_loss = 0.0
        num_batches = 0

        for batch_data in batches:
            batch = collator(batch_data)
            input_values = batch["input_values"].to(DEVICE)
            attention_mask = batch["attention_mask"].to(DEVICE)
            labels = batch["labels"].to(DEVICE)

            outputs = model(
                input_values=input_values,
                attention_mask=attention_mask,
                labels=labels,
            )

            loss = outputs.loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            optimizer.zero_grad()

            epoch_loss += loss.item()
            num_batches += 1

        avg_loss = epoch_loss / num_batches
        loss_history.append(avg_loss)

        # Arrow indicator for loss direction
        if len(loss_history) >= 2:
            delta = loss_history[-1] - loss_history[-2]
            arrow = "↓" if delta < -0.01 else ("↑" if delta > 0.01 else "→")
        else:
            arrow = " "

        print(f"  Epoch {epoch:2d}/{NUM_EPOCHS}  loss: {avg_loss:.4f}  {arrow}")

    # ── Loss check ──
    print("\n" + "─" * 60)
    print("LOSS ANALYSIS")
    print("─" * 60)
    first_loss = loss_history[0]
    final_loss = loss_history[-1]
    decreased = final_loss < first_loss * 0.5  # At least 50% reduction

    print(f"  First epoch loss: {first_loss:.4f}")
    print(f"  Final epoch loss: {final_loss:.4f}")
    print(f"  Reduction:        {((first_loss - final_loss) / first_loss * 100):.1f}%")

    if decreased:
        print("  ✅ PASS — Loss decreased significantly")
    else:
        print("  ❌ FAIL — Loss did not decrease enough")
        print("     Possible causes:")
        print("     - Vocab/tokenizer mismatch (labels not mapping to correct IDs)")
        print("     - Audio too short for wav2vec2's convolutional downsampling")
        print("     - Learning rate too low/high")

    # ── Inference ──
    print("\n" + "─" * 60)
    print("INFERENCE (on 5 training clips)")
    print("─" * 60)

    model.eval()
    test_clips = dataset[:5]
    predictions = []
    references = []

    with torch.no_grad():
        for item in test_clips:
            inputs = processor(
                item["audio"],
                sampling_rate=SAMPLE_RATE,
                return_tensors="pt",
                padding=True,
            )
            input_values = inputs.input_values.to(DEVICE)

            logits = model(input_values).logits
            pred_ids = torch.argmax(logits, dim=-1)

            # Decode — processor.batch_decode handles CTC blank removal
            pred_text = processor.batch_decode(pred_ids)[0]

            expected = item["label"]
            predictions.append(pred_text)
            references.append(expected)

            match = "✅" if pred_text.strip() == expected.strip() else "❌"
            print(f"  {item['name']:>12s}  expected: {expected:<20s}  got: {pred_text:<20s}  {match}")

    # ── PER via jiwer ──
    print("\n" + "─" * 60)
    print("PER EVALUATION (via jiwer)")
    print("─" * 60)

    try:
        import jiwer

        # For PER, we treat each phoneme as a "word" (space-separated)
        # jiwer.wer on space-separated phonemes = PER
        per = jiwer.wer(references, predictions)
        print(f"  Phoneme Error Rate (PER): {per * 100:.1f}%")

        if per < 0.3:
            print("  ✅ PASS — Model memorized training data (PER < 30%)")
        elif per < 0.6:
            print("  ⚠️  PARTIAL — Model learned something but didn't fully memorize")
        else:
            print("  ❌ FAIL — Model failed to memorize training data (PER >= 60%)")
            print("     This indicates a fundamental issue in the training loop.")

    except ImportError:
        print("  ⚠️  jiwer not installed — computing PER manually")

        # Manual PER: edit distance / reference length
        def edit_distance(ref_tokens, hyp_tokens):
            m, n = len(ref_tokens), len(hyp_tokens)
            dp = [[0] * (n + 1) for _ in range(m + 1)]
            for i in range(m + 1):
                dp[i][0] = i
            for j in range(n + 1):
                dp[0][j] = j
            for i in range(1, m + 1):
                for j in range(1, n + 1):
                    if ref_tokens[i - 1] == hyp_tokens[j - 1]:
                        dp[i][j] = dp[i - 1][j - 1]
                    else:
                        dp[i][j] = 1 + min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
            return dp[m][n]

        total_edits = 0
        total_ref_len = 0
        for ref, hyp in zip(references, predictions):
            ref_toks = ref.split()
            hyp_toks = hyp.split()
            total_edits += edit_distance(ref_toks, hyp_toks)
            total_ref_len += len(ref_toks)

        per = total_edits / max(total_ref_len, 1)
        print(f"  Phoneme Error Rate (PER): {per * 100:.1f}%")

    # ── Save model ──
    print("\n" + "─" * 60)
    print("SAVING MODEL")
    print("─" * 60)

    os.makedirs(OUTPUT_DIR, exist_ok=True)
    model.save_pretrained(OUTPUT_DIR)
    processor.save_pretrained(OUTPUT_DIR)
    print(f"  Saved to {OUTPUT_DIR}/")

    # ── Summary ──
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    print(f"  Loss:       {first_loss:.4f} → {final_loss:.4f} ({'✅ decreasing' if decreased else '❌ not decreasing'})")
    print(f"  PER:        {per * 100:.1f}%")
    print(f"  Device:     {DEVICE}")
    print(f"  Checkpoint: {BASE_CHECKPOINT}")
    print(f"  Clips:      {len(dataset)}")
    print(f"  Epochs:     {NUM_EPOCHS}")
    print()

    if decreased and per < 0.5:
        print("  🎉 CTC training loop VALIDATED — ready to integrate into pipeline")
    else:
        print("  ⚠️  Issues detected — review output above before proceeding")


if __name__ == "__main__":
    train()
