"""
CTC Fine-Tuning Validation — REAL SPEECH (espeak-ng)
=====================================================

Validates Wav2Vec2ForCTC can learn short phoneme sequences from
actual speech waveforms — the production-relevant test.

Previous failure analysis:
  - Synthetic harmonic audio + unfrozen encoder = total blank collapse.
  - Wav2vec2's pretrained CNN extracts speech formants; harmonic stacks
    produce garbage features → no learning signal → 100% PER.

This version:
  - espeak-ng synthesizes REAL speech waveforms per phoneme sequence.
  - Feature encoder FROZEN (pretrained features work on real speech).
  - Only transformer + lm_head trained (~87M params, but with real
    features, the lm_head mapping is learnable).
  - Same strict criteria: PER<25%, count-match≥70%, exact-match≥40%.

Usage:
    modal run test_ctc/test_ctc_modal.py
"""

import modal

app = modal.App("ctc-speech-validation")

training_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("espeak-ng", "ffmpeg")
    .pip_install(
        "torch>=2.1",
        "torchaudio>=2.1",
        "transformers>=4.40",
        "soundfile",
        "jiwer",
        "numpy",
    )
)


@app.function(image=training_image, gpu="A10G", timeout=900)
def run_ctc_validation():
    import os, time, subprocess
    import torch
    import numpy as np
    import soundfile as sf
    import jiwer
    from transformers import Wav2Vec2ForCTC, Wav2Vec2FeatureExtractor

    SAMPLE_RATE = 16000
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

    print("=" * 65)
    print("  CTC VALIDATION — REAL SPEECH (espeak-ng + Wav2Vec2)")
    print("=" * 65)
    print(f"  Device: {DEVICE}")
    if DEVICE == "cuda":
        print(f"  GPU:    {torch.cuda.get_device_name(0)}")

    # ─────────────────────────────────────────
    # 1. Phoneme Vocabulary
    # ─────────────────────────────────────────
    PHONEMES = ["b", "t", "s", "m", "n", "l", "r", "a", "i", "u"]
    vocab = {"<pad>": 0, "<unk>": 1}
    for p in PHONEMES:
        vocab[p] = len(vocab)
    id_to_phoneme = {v: k for k, v in vocab.items()}
    vocab_size = len(vocab)
    print(f"\n  Vocab ({vocab_size} tokens): {vocab}")

    # ─────────────────────────────────────────
    # 2. espeak-ng Phoneme Mapping
    # ─────────────────────────────────────────
    # Map our phonemes to espeak-ng's English phoneme notation.
    # These are chosen to produce clear, distinct speech sounds.
    # NOTE: 'A' (back open vowel) caused blank-collapse on /a/ clips
    #        because espeak's English /A/ is breathy/quiet. Using 'aa'
    #        (a more fronted, open vowel) produces clearer audio.
    ESPEAK_MAP = {
        "a": "aa",     # clear open vowel (not 'A' which is too quiet)
        "i": "i:",     # close front vowel (like Arabic kasra)
        "u": "u:",     # close back vowel (like Arabic damma)
        "b": "b",
        "t": "t",
        "s": "s",
        "m": "m",
        "n": "n",
        "l": "l",
        "r": "r",
    }

    # 40 clips: vowels (3) + CV (15) + CVC (12) + VC (5) + VCV (5)
    CLIP_LABELS = [
        # Pure vowels — directly pronounceable
        ["a"], ["i"], ["u"],
        # CV pairs — the core Noorani Qaida task
        ["b", "a"], ["t", "a"], ["s", "a"], ["m", "a"], ["n", "a"],
        ["l", "a"], ["r", "a"],
        ["b", "i"], ["t", "i"], ["s", "i"],
        ["m", "u"], ["n", "u"],
        # CVC — short syllables
        ["b", "a", "s"], ["t", "a", "n"], ["m", "a", "l"],
        ["r", "a", "b"], ["s", "a", "m"], ["n", "u", "r"],
        ["b", "i", "l"], ["m", "i", "n"], ["l", "a", "m"],
        ["t", "a", "b"], ["s", "i", "l"], ["b", "u", "t"],
        # VC pairs
        ["a", "b"], ["i", "m"], ["u", "n"], ["a", "l"], ["i", "r"],
        # VCV
        ["a", "b", "a"], ["i", "m", "i"], ["u", "n", "u"],
        ["a", "l", "a"], ["i", "r", "i"],
        # Extra CV pairs for training signal
        ["l", "i"], ["r", "u"], ["t", "u"], ["s", "u"], ["m", "i"],
    ]

    # ─────────────────────────────────────────
    # 3. Synthesize Audio with espeak-ng
    # ─────────────────────────────────────────
    def phonemes_to_espeak(phoneme_list):
        """Convert phoneme list to espeak-ng phoneme notation string."""
        return "".join(ESPEAK_MAP[p] for p in phoneme_list)

    def synthesize_clip(phoneme_list, clip_id):
        """Generate a WAV clip using espeak-ng's phoneme input mode."""
        espeak_str = phonemes_to_espeak(phoneme_list)
        wav_path = f"/tmp/clip_{clip_id:02d}.wav"

        result = subprocess.run(
            [
                "espeak-ng",
                f"[[{espeak_str}]]",    # phoneme input mode
                "-v", "en",              # English voice
                "-s", "80",              # slow speed for clear phonemes
                "-w", wav_path,
            ],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            print(f"  WARNING: espeak-ng failed for clip_{clip_id:02d} "
                  f"({espeak_str}): {result.stderr.strip()}")
            # Fallback: short silence (will fail alignment but won't crash)
            return np.zeros(int(0.5 * SAMPLE_RATE), dtype=np.float32)

        audio, sr = sf.read(wav_path)
        # Resample to 16kHz if needed
        if sr != SAMPLE_RATE:
            import torchaudio
            audio_t = torch.tensor(audio).float()
            if audio_t.ndim == 1:
                audio_t = audio_t.unsqueeze(0)
            audio_t = torchaudio.functional.resample(audio_t, sr, SAMPLE_RATE)
            audio = audio_t.squeeze(0).numpy()
        if audio.ndim > 1:
            audio = audio[:, 0]  # mono

        # Pad to minimum 500ms (8000 samples) — ensures enough frames
        # for CTC after wav2vec2's CNN downsampling (~320× stride)
        min_samples = int(0.5 * SAMPLE_RATE)
        if len(audio) < min_samples:
            audio = np.pad(audio, (0, min_samples - len(audio)))

        return audio.astype(np.float32)

    print(f"\n  Synthesizing {len(CLIP_LABELS)} clips with espeak-ng...")
    dataset = []
    for idx, labels in enumerate(CLIP_LABELS):
        audio = synthesize_clip(labels, idx)
        dur_ms = len(audio) / SAMPLE_RATE * 1000
        dataset.append({
            "id": f"clip_{idx:02d}",
            "audio": audio,
            "phonemes": labels,
            "duration_ms": dur_ms,
        })

    # Print summary
    durations = [c["duration_ms"] for c in dataset]
    print(f"  Done: {len(dataset)} clips")
    print(f"  Duration range: {min(durations):.0f}ms - {max(durations):.0f}ms")
    print(f"  Total phonemes: {sum(len(c['phonemes']) for c in dataset)}")
    print(f"\n  Sample clips:")
    for c in dataset[:5]:
        print(f"    {c['id']}  {c['duration_ms']:5.0f}ms  label: {' '.join(c['phonemes'])}")
    print("    ...")
    for c in dataset[-3:]:
        print(f"    {c['id']}  {c['duration_ms']:5.0f}ms  label: {' '.join(c['phonemes'])}")

    # ─────────────────────────────────────────
    # 4. Model Setup
    # ─────────────────────────────────────────
    feature_extractor = Wav2Vec2FeatureExtractor(
        feature_size=1, sampling_rate=SAMPLE_RATE,
        padding_value=0.0, do_normalize=True,
        return_attention_mask=True,
    )

    print(f"\n  Loading facebook/wav2vec2-base...")
    model = Wav2Vec2ForCTC.from_pretrained(
        "facebook/wav2vec2-base",
        ctc_loss_reduction="mean",
        pad_token_id=0,
        vocab_size=vocab_size,
        ignore_mismatched_sizes=True,
    )

    # FREEZE feature encoder — pretrained features work on real speech.
    model.freeze_feature_encoder()

    # Disable dropout + masking for clean memorization test
    model.config.attention_dropout = 0.0
    model.config.hidden_dropout = 0.0
    model.config.feat_proj_dropout = 0.0
    model.config.final_dropout = 0.0
    model.config.ctc_zero_infinity = True
    model.config.mask_time_prob = 0.0  # no time masking during training

    # Neutral lm_head bias — prevents blank-biased initialization
    with torch.no_grad():
        model.lm_head.bias.fill_(0.0)

    model.to(DEVICE)

    total_p = sum(p.numel() for p in model.parameters())
    train_p = sum(p.numel() for p in model.parameters() if p.requires_grad)
    frozen_p = total_p - train_p
    print(f"  Total:     {total_p:,}")
    print(f"  Trainable: {train_p:,}")
    print(f"  Frozen:    {frozen_p:,}")

    # ─────────────────────────────────────────
    # 5. Collation
    # ─────────────────────────────────────────
    def collate(batch):
        feats = feature_extractor(
            [item["audio"] for item in batch],
            sampling_rate=SAMPLE_RATE,
            return_tensors="pt", padding=True,
        )
        seqs = [[vocab[p] for p in item["phonemes"]] for item in batch]
        max_len = max(len(s) for s in seqs)
        labels = torch.full((len(batch), max_len), -100, dtype=torch.long)
        for i, seq in enumerate(seqs):
            labels[i, :len(seq)] = torch.tensor(seq, dtype=torch.long)
        return {
            "input_values": feats.input_values.to(DEVICE),
            "attention_mask": feats.attention_mask.to(DEVICE),
            "labels": labels.to(DEVICE),
        }

    # ─────────────────────────────────────────
    # 6. Optimizer — Differentiated LR
    # ─────────────────────────────────────────
    NUM_EPOCHS = 200
    BATCH_SIZE = 4

    # Higher LR for lm_head (randomly initialized) vs backbone
    backbone_params = [p for n, p in model.named_parameters()
                       if p.requires_grad and "lm_head" not in n]
    head_params = [p for n, p in model.named_parameters()
                   if p.requires_grad and "lm_head" in n]

    optimizer = torch.optim.AdamW([
        {"params": backbone_params, "lr": 1e-4},
        {"params": head_params, "lr": 5e-4},
    ], weight_decay=0.01)

    num_batches = (len(dataset) + BATCH_SIZE - 1) // BATCH_SIZE
    total_steps = NUM_EPOCHS * num_batches
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=[1e-4, 5e-4],
        total_steps=total_steps, pct_start=0.15,
        anneal_strategy="cos",
    )

    # ─────────────────────────────────────────
    # 7. Decoding helper
    # ─────────────────────────────────────────
    def ctc_decode(pred_ids, id_map, blank_id=0):
        """Greedy CTC decode: collapse repeats, remove blanks."""
        collapsed = []
        prev = None
        for t in pred_ids:
            if t != prev:
                collapsed.append(t)
                prev = t
        return [id_map[t] for t in collapsed if t != blank_id and t in id_map]

    def run_inference(dataset_subset, label=""):
        """Run inference on a subset, return predictions + stats."""
        model.eval()
        all_refs, all_hyps = [], []
        count_matches = exact_matches = 0

        with torch.no_grad():
            for item in dataset_subset:
                feats = feature_extractor(
                    item["audio"], sampling_rate=SAMPLE_RATE,
                    return_tensors="pt", padding=True,
                )
                logits = model(feats.input_values.to(DEVICE)).logits
                ids = torch.argmax(logits, dim=-1)[0].cpu().tolist()
                pred = ctc_decode(ids, id_to_phoneme)

                expected = item["phonemes"]
                ref_str = " ".join(expected)
                hyp_str = " ".join(pred) if pred else "[EMPTY]"

                all_refs.append(ref_str)
                all_hyps.append(" ".join(pred))

                count_ok = abs(len(pred) - len(expected)) <= 1
                exact_ok = pred == expected
                if count_ok: count_matches += 1
                if exact_ok: exact_matches += 1

        per = jiwer.wer(all_refs, all_hyps) if all_refs else 1.0
        n = len(dataset_subset)
        return per, count_matches / n, exact_matches / n, all_refs, all_hyps

    # ─────────────────────────────────────────
    # 8. Training Loop
    # ─────────────────────────────────────────
    print("\n" + "-" * 65)
    print("  TRAINING")
    print("-" * 65)
    print(f"  {len(dataset)} clips, batch {BATCH_SIZE}, {NUM_EPOCHS} epochs, {total_steps} steps")
    print(f"  Feature encoder: FROZEN (real speech)")
    print(f"  LR: backbone={1e-4}, lm_head={5e-4}")
    print(f"  Dropout: OFF, masking: OFF (memorization test)")

    indices = np.arange(len(dataset))
    loss_history = []
    best_loss = float("inf")
    best_state = None
    t0 = time.time()

    model.train()
    for epoch in range(1, NUM_EPOCHS + 1):
        np.random.shuffle(indices)
        batches = [
            [dataset[indices[j]] for j in range(i, min(i + BATCH_SIZE, len(indices)))]
            for i in range(0, len(indices), BATCH_SIZE)
        ]

        epoch_loss = 0.0
        n_batches = 0

        for batch_data in batches:
            batch = collate(batch_data)
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
            n_batches += 1

            # Diagnostic: check blank probability on first batch of first epoch
            if epoch == 1 and n_batches == 1:
                with torch.no_grad():
                    probs = torch.softmax(out.logits, dim=-1)
                    blank_p = probs[:, :, 0].mean().item()
                    print(f"\n  [DIAGNOSTIC] Epoch 1, Batch 1:")
                    print(f"    Mean P(blank): {blank_p:.4f}")
                    print(f"    Loss: {loss.item():.4f}")
                    # Show top prediction for first clip, first 5 frames
                    top_ids = torch.argmax(probs[0], dim=-1)[:10].cpu().tolist()
                    top_probs = probs[0].max(dim=-1).values[:10].cpu().tolist()
                    print(f"    First 10 frame predictions: {top_ids}")
                    print(f"    First 10 frame max probs:   {[f'{p:.3f}' for p in top_probs]}")
                    print()

        if n_batches == 0:
            loss_history.append(float("nan"))
            continue

        avg = epoch_loss / n_batches
        loss_history.append(avg)

        if avg < best_loss:
            best_loss = avg
            best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

        # Log + mid-training diagnostics
        if epoch <= 5 or epoch % 25 == 0 or epoch == NUM_EPOCHS:
            lr_bb = optimizer.param_groups[0]["lr"]
            lr_hd = optimizer.param_groups[1]["lr"]
            trend = ""
            if len(loss_history) >= 2 and not np.isnan(loss_history[-2]):
                d = loss_history[-1] - loss_history[-2]
                trend = " [v]" if d < -0.02 else (" [^]" if d > 0.02 else " [=]")
            print(f"  Epoch {epoch:3d}/{NUM_EPOCHS}  loss: {avg:.4f}{trend}  "
                  f"lr: bb={lr_bb:.6f} hd={lr_hd:.6f}")

        # Mid-training inference check every 50 epochs
        if epoch in (50, 100, 150):
            per, cm, em, _, _ = run_inference(dataset[:6], f"epoch-{epoch}")
            print(f"    >> Mid-check (6 clips): PER={per*100:.1f}%, "
                  f"count={cm*100:.0f}%, exact={em*100:.0f}%")
            model.train()

    train_time = time.time() - t0
    print(f"\n  Done in {train_time:.1f}s ({train_time / NUM_EPOCHS:.2f}s/epoch)")

    # Load best checkpoint
    if best_state:
        model.load_state_dict(best_state)
        model.to(DEVICE)
        print(f"  Best checkpoint loss: {best_loss:.4f}")

    # ─────────────────────────────────────────
    # 9. Full Inference + Strict Evaluation
    # ─────────────────────────────────────────
    print("\n" + "-" * 65)
    print("  INFERENCE (all clips)")
    print("-" * 65)

    model.eval()
    all_refs, all_hyps = [], []
    count_matches = exact_matches = 0

    with torch.no_grad():
        for item in dataset:
            feats = feature_extractor(
                item["audio"], sampling_rate=SAMPLE_RATE,
                return_tensors="pt", padding=True,
            )
            logits = model(feats.input_values.to(DEVICE)).logits
            ids = torch.argmax(logits, dim=-1)[0].cpu().tolist()
            pred = ctc_decode(ids, id_to_phoneme)

            expected = item["phonemes"]
            ref_str = " ".join(expected)
            hyp_str = " ".join(pred) if pred else "[EMPTY]"

            all_refs.append(ref_str)
            all_hyps.append(" ".join(pred))

            count_ok = abs(len(pred) - len(expected)) <= 1
            exact_ok = pred == expected
            if count_ok: count_matches += 1
            if exact_ok: exact_matches += 1

            tag = "OK" if exact_ok else ("~" if count_ok else "X ")
            print(f"  [{tag}] {item['id']}  expect: {ref_str:20s}  got: {hyp_str:20s}  "
                  f"(exp={len(expected)}, got={len(pred)})")

    # ─────────────────────────────────────────
    # 10. Strict Pass Criteria
    # ─────────────────────────────────────────
    per = jiwer.wer(all_refs, all_hyps)
    n = len(dataset)
    count_pct = count_matches / n * 100
    exact_pct = exact_matches / n * 100
    first_loss = loss_history[0] if loss_history else float("nan")

    print("\n" + "=" * 65)
    print("  STRICT VALIDATION RESULTS")
    print("=" * 65)
    print(f"  Loss:              {first_loss:.4f} -> {best_loss:.4f}")
    print(f"  PER:               {per * 100:.1f}%")
    print(f"  Count Match (+-1): {count_matches}/{n} ({count_pct:.0f}%)")
    print(f"  Exact Match:       {exact_matches}/{n} ({exact_pct:.0f}%)")

    c1 = per < 0.25
    c2 = count_pct >= 70
    c3 = exact_pct >= 40

    print(f"\n  Criteria 1 -- PER < 25%:          {'PASS' if c1 else 'FAIL'} ({per*100:.1f}%)")
    print(f"  Criteria 2 -- Count match >= 70%: {'PASS' if c2 else 'FAIL'} ({count_pct:.0f}%)")
    print(f"  Criteria 3 -- Exact match >= 40%: {'PASS' if c3 else 'FAIL'} ({exact_pct:.0f}%)")

    passed = c1 and c2 and c3
    status = "ALL CRITERIA PASSED" if passed else "NOT YET PASSING"
    print(f"\n  Overall: {status}")
    print("=" * 65)

    return {
        "loss_first": float(first_loss),
        "loss_best": float(best_loss),
        "per": float(per),
        "count_match_pct": float(count_pct),
        "exact_match_pct": float(exact_pct),
        "passed": passed,
        "status": status,
    }


@app.local_entrypoint()
def main():
    print("Launching CTC validation on Modal (A10G)...")
    print("Audio: espeak-ng real speech | Model: wav2vec2-base (frozen encoder)")
    print("Pass requires: PER<25%, count-match>=70%, exact-match>=40%\n")
    result = run_ctc_validation.remote()
    print("\n-- Result --")
    print(f"  Loss:        {result['loss_first']:.4f} -> {result['loss_best']:.4f}")
    print(f"  PER:         {result['per']*100:.1f}%")
    print(f"  Count Match: {result['count_match_pct']:.0f}%")
    print(f"  Exact Match: {result['exact_match_pct']:.0f}%")
    print(f"  Status:      {result['status']}")
    print(f"  Passed:      {'YES' if result['passed'] else 'NO'}")
