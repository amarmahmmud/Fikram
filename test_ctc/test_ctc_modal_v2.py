"""
CTC Validation Phase 2: Held-Out Generalization + Real Quranic Audio
=====================================================================

Two tests that must pass BEFORE backend integration:

Test 1 — Held-Out Generalization (espeak-ng):
  Split the 42-clip espeak dataset into 32 train + 10 held-out.
  Retrain with the exact same config that got 100% on the full set.
  Report metrics on held-out clips only.
  Answers: Is the model learning phoneme patterns or memorizing clips?

Test 2 — Real Audio (EveryAyah Quranic recitation):
  Download 13 muqatta'at verse clips from EveryAyah (Alafasy).
  Same frozen-encoder + differentiated-LR recipe.
  Report metrics on real recorded speech.
  Answers: Does the recipe transfer from TTS to actual human speech?

Usage:
    modal run test_ctc/test_ctc_modal_v2.py
"""

import modal

app = modal.App("ctc-validation-phase2")

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


@app.function(image=training_image, gpu="A10G", timeout=1500)
def run_phase2_tests():
    import os, time, subprocess
    import torch
    import numpy as np
    import soundfile as sf
    import jiwer
    import urllib.request
    from transformers import Wav2Vec2ForCTC, Wav2Vec2FeatureExtractor

    SAMPLE_RATE = 16000
    DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

    print("=" * 70)
    print("  CTC VALIDATION PHASE 2")
    print("=" * 70)
    print(f"  Device: {DEVICE}")
    if DEVICE == "cuda":
        print(f"  GPU:    {torch.cuda.get_device_name(0)}")

    # ══════════════════════════════════════════
    # SHARED UTILITIES
    # ══════════════════════════════════════════

    def build_vocab(phoneme_list):
        vocab = {"<pad>": 0, "<unk>": 1}
        for p in phoneme_list:
            if p not in vocab:
                vocab[p] = len(vocab)
        return vocab, {v: k for k, v in vocab.items()}

    def ctc_greedy_decode(pred_ids, id_map, blank_id=0):
        """Standard CTC greedy decode: collapse repeats, remove blanks."""
        collapsed = []
        prev = None
        for t in pred_ids:
            if t != prev:
                collapsed.append(t)
                prev = t
        return [id_map[t] for t in collapsed if t != blank_id and t in id_map]

    def make_collate(fe, vocab, device):
        """Return a collate function closed over feature extractor and vocab."""
        def collate(batch):
            feats = fe(
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
                "input_values": feats.input_values.to(device),
                "attention_mask": feats.attention_mask.to(device),
                "labels": labels.to(device),
            }
        return collate

    def setup_model(vocab_size, device):
        """Load wav2vec2-base with frozen encoder, no dropout, no masking."""
        fe = Wav2Vec2FeatureExtractor(
            feature_size=1, sampling_rate=SAMPLE_RATE,
            padding_value=0.0, do_normalize=True,
            return_attention_mask=True,
        )
        model = Wav2Vec2ForCTC.from_pretrained(
            "facebook/wav2vec2-base",
            ctc_loss_reduction="mean",
            pad_token_id=0,
            vocab_size=vocab_size,
            ignore_mismatched_sizes=True,
        )
        model.freeze_feature_encoder()
        model.config.attention_dropout = 0.0
        model.config.hidden_dropout = 0.0
        model.config.feat_proj_dropout = 0.0
        model.config.final_dropout = 0.0
        model.config.ctc_zero_infinity = True
        model.config.mask_time_prob = 0.0
        with torch.no_grad():
            model.lm_head.bias.fill_(0.0)
        model.to(device)
        return model, fe

    def train_model(model, fe, train_data, vocab, device,
                    num_epochs=200, batch_size=4,
                    bb_lr=1e-4, hd_lr=5e-4):
        """Train and return (best_loss, loss_history). Loads best state into model."""
        collate = make_collate(fe, vocab, device)

        backbone_params = [p for n, p in model.named_parameters()
                           if p.requires_grad and "lm_head" not in n]
        head_params = [p for n, p in model.named_parameters()
                       if p.requires_grad and "lm_head" in n]

        optimizer = torch.optim.AdamW([
            {"params": backbone_params, "lr": bb_lr},
            {"params": head_params, "lr": hd_lr},
        ], weight_decay=0.01)

        num_batches = (len(train_data) + batch_size - 1) // batch_size
        total_steps = num_epochs * num_batches
        scheduler = torch.optim.lr_scheduler.OneCycleLR(
            optimizer, max_lr=[bb_lr, hd_lr],
            total_steps=total_steps, pct_start=0.15,
            anneal_strategy="cos",
        )

        indices = np.arange(len(train_data))
        best_loss = float("inf")
        best_state = None
        loss_history = []
        t0 = time.time()

        model.train()
        for epoch in range(1, num_epochs + 1):
            np.random.shuffle(indices)
            batches = [
                [train_data[indices[j]]
                 for j in range(i, min(i + batch_size, len(indices)))]
                for i in range(0, len(indices), batch_size)
            ]

            epoch_loss = 0.0
            n = 0
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
                n += 1

            if n == 0:
                loss_history.append(float("nan"))
                continue

            avg = epoch_loss / n
            loss_history.append(avg)

            if avg < best_loss:
                best_loss = avg
                best_state = {k: v.cpu().clone()
                              for k, v in model.state_dict().items()}

            if epoch <= 5 or epoch % 25 == 0 or epoch == num_epochs:
                trend = ""
                if len(loss_history) >= 2 and not np.isnan(loss_history[-2]):
                    d = loss_history[-1] - loss_history[-2]
                    trend = " [v]" if d < -0.02 else (
                        " [^]" if d > 0.02 else " [=]")
                print(f"      Epoch {epoch:3d}/{num_epochs}  "
                      f"loss: {avg:.4f}{trend}")

        elapsed = time.time() - t0
        print(f"      Done in {elapsed:.1f}s, best loss: {best_loss:.4f}")

        if best_state:
            model.load_state_dict(best_state)
            model.to(device)

        return best_loss, loss_history

    def evaluate_set(model, fe, data, vocab, id_to_phoneme, device, label=""):
        """Evaluate on a dataset, print per-clip results, return metrics dict."""
        model.eval()
        all_refs, all_hyps = [], []
        count_matches = exact_matches = 0
        n = len(data)

        print(f"\n    {label} ({n} clips):")

        with torch.no_grad():
            for item in data:
                feats = fe(
                    item["audio"], sampling_rate=SAMPLE_RATE,
                    return_tensors="pt", padding=True,
                )
                logits = model(feats.input_values.to(device)).logits
                ids = torch.argmax(logits, dim=-1)[0].cpu().tolist()
                pred = ctc_greedy_decode(ids, id_to_phoneme)

                expected = item["phonemes"]
                ref_str = " ".join(expected)
                hyp_str = " ".join(pred) if pred else "[EMPTY]"

                all_refs.append(ref_str)
                all_hyps.append(" ".join(pred))

                count_ok = abs(len(pred) - len(expected)) <= 1
                exact_ok = pred == expected
                if count_ok:
                    count_matches += 1
                if exact_ok:
                    exact_matches += 1

                tag = "OK" if exact_ok else ("~ " if count_ok else "X ")
                name = item.get("name", item.get("id", "?"))
                print(f"      [{tag}] {name:20s}  "
                      f"expect: {ref_str:20s}  got: {hyp_str:20s}  "
                      f"(exp={len(expected)}, got={len(pred)})")

        per = jiwer.wer(all_refs, all_hyps) if all_refs else 1.0
        count_pct = count_matches / n * 100 if n else 0
        exact_pct = exact_matches / n * 100 if n else 0

        c1 = per < 0.25
        c2 = count_pct >= 70
        c3 = exact_pct >= 40
        passed = c1 and c2 and c3

        print(f"\n    {label} Metrics:")
        print(f"      PER:         {per*100:.1f}%  "
              f"{'PASS' if c1 else 'FAIL'} (need <25%)")
        print(f"      Count Match: {count_pct:.0f}%   "
              f"{'PASS' if c2 else 'FAIL'} (need >=70%)")
        print(f"      Exact Match: {exact_pct:.0f}%   "
              f"{'PASS' if c3 else 'FAIL'} (need >=40%)")
        print(f"      Overall:     {'ALL PASSED' if passed else 'NOT PASSING'}")

        return {
            "per": float(per),
            "count_match_pct": float(count_pct),
            "exact_match_pct": float(exact_pct),
            "passed": passed,
        }

    # ══════════════════════════════════════════
    # ESPEAK-NG AUDIO GENERATOR
    # ══════════════════════════════════════════

    ESPEAK_MAP = {
        "a": "aa", "i": "i:", "u": "u:",
        "b": "b", "t": "t", "s": "s",
        "m": "m", "n": "n", "l": "l", "r": "r",
    }

    def synthesize_espeak(phoneme_list, clip_id):
        espeak_str = "".join(ESPEAK_MAP[p] for p in phoneme_list)
        wav_path = f"/tmp/espeak_{clip_id:03d}.wav"
        result = subprocess.run(
            ["espeak-ng", f"[[{espeak_str}]]", "-v", "en",
             "-s", "80", "-w", wav_path],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            print(f"      WARN: espeak failed for clip {clip_id}: "
                  f"{result.stderr.strip()}")
            return np.zeros(int(0.5 * SAMPLE_RATE), dtype=np.float32)
        audio, sr = sf.read(wav_path)
        if sr != SAMPLE_RATE:
            import torchaudio
            t = torch.tensor(audio).float()
            if t.ndim == 1:
                t = t.unsqueeze(0)
            t = torchaudio.functional.resample(t, sr, SAMPLE_RATE)
            audio = t.squeeze(0).numpy()
        if audio.ndim > 1:
            audio = audio[:, 0]
        min_len = int(0.5 * SAMPLE_RATE)
        if len(audio) < min_len:
            audio = np.pad(audio, (0, min_len - len(audio)))
        return audio.astype(np.float32)

    # ══════════════════════════════════════════════════════════════
    #  TEST 1: HELD-OUT GENERALIZATION
    # ══════════════════════════════════════════════════════════════

    print("\n" + "=" * 70)
    print("  TEST 1: HELD-OUT GENERALIZATION (espeak-ng)")
    print("=" * 70)

    PHONEMES_1 = ["b", "t", "s", "m", "n", "l", "r", "a", "i", "u"]

    ALL_LABELS = [
        # 0-2: vowels
        ["a"], ["i"], ["u"],
        # 3-9: CV with /a/
        ["b", "a"], ["t", "a"], ["s", "a"], ["m", "a"], ["n", "a"],
        ["l", "a"], ["r", "a"],
        # 10-12: CV with /i/
        ["b", "i"], ["t", "i"], ["s", "i"],
        # 13-14: CV with /u/
        ["m", "u"], ["n", "u"],
        # 15-26: CVC
        ["b", "a", "s"], ["t", "a", "n"], ["m", "a", "l"],
        ["r", "a", "b"], ["s", "a", "m"], ["n", "u", "r"],
        ["b", "i", "l"], ["m", "i", "n"], ["l", "a", "m"],
        ["t", "a", "b"], ["s", "i", "l"], ["b", "u", "t"],
        # 27-31: VC
        ["a", "b"], ["i", "m"], ["u", "n"], ["a", "l"], ["i", "r"],
        # 32-36: VCV
        ["a", "b", "a"], ["i", "m", "i"], ["u", "n", "u"],
        ["a", "l", "a"], ["i", "r", "i"],
        # 37-41: extra CV
        ["l", "i"], ["r", "u"], ["t", "u"], ["s", "u"], ["m", "i"],
    ]

    # Held-out indices: chosen so every phoneme in held-out appears
    # in training, but the COMBINATIONS are novel.
    # 10 clips: 1 single + 4 CV + 3 CVC + 1 VC + 1 VCV
    HELDOUT_IDX = {2, 6, 10, 14, 17, 22, 26, 30, 34, 39}

    print("\n    Generating 42 espeak clips...")
    all_clips = []
    for idx, labels in enumerate(ALL_LABELS):
        audio = synthesize_espeak(labels, idx)
        all_clips.append({
            "id": f"clip_{idx:02d}",
            "name": f"{'*' if idx in HELDOUT_IDX else ' '}clip_{idx:02d}",
            "audio": audio,
            "phonemes": labels,
        })

    train_clips = [c for i, c in enumerate(all_clips) if i not in HELDOUT_IDX]
    heldout_clips = [c for i, c in enumerate(all_clips) if i in HELDOUT_IDX]

    print(f"    Split: {len(train_clips)} train, {len(heldout_clips)} held-out")
    print(f"\n    Held-out clips (novel combinations):")
    for c in heldout_clips:
        print(f"      {c['id']}  label: {' '.join(c['phonemes'])}")

    # Build vocab, model, train
    vocab_1, id2p_1 = build_vocab(PHONEMES_1)
    print(f"\n    Vocab ({len(vocab_1)} tokens)")

    print(f"\n    Loading model...")
    model_1, fe_1 = setup_model(len(vocab_1), DEVICE)

    print(f"\n    Training on {len(train_clips)} clips...")
    best_loss_1, _ = train_model(
        model_1, fe_1, train_clips, vocab_1, DEVICE,
        num_epochs=200, batch_size=4, bb_lr=1e-4, hd_lr=5e-4,
    )

    # Evaluate on BOTH sets for comparison
    train_result = evaluate_set(
        model_1, fe_1, train_clips, vocab_1, id2p_1, DEVICE,
        label="TRAIN SET",
    )
    heldout_result = evaluate_set(
        model_1, fe_1, heldout_clips, vocab_1, id2p_1, DEVICE,
        label="HELD-OUT SET",
    )

    # Gap analysis
    gap = train_result["exact_match_pct"] - heldout_result["exact_match_pct"]
    print(f"\n    Overfitting gap (exact match): "
          f"{train_result['exact_match_pct']:.0f}% train - "
          f"{heldout_result['exact_match_pct']:.0f}% held-out = "
          f"{gap:.0f}pp")
    if heldout_result["exact_match_pct"] < 10:
        print("    ** WARNING: Near-total collapse on held-out data. "
              "Model is memorizing, not learning phoneme patterns.")
    elif gap > 50:
        print("    ** NOTE: Large overfitting gap expected with only "
              f"{len(train_clips)} training clips.")

    # ══════════════════════════════════════════════════════════════
    #  TEST 2: REAL QURANIC AUDIO (EveryAyah)
    # ══════════════════════════════════════════════════════════════

    print("\n\n" + "=" * 70)
    print("  TEST 2: REAL QURANIC AUDIO (EveryAyah)")
    print("=" * 70)

    # Arabic phonemes needed for the muqatta'at letter names
    PHONEMES_2 = [
        "S",   # emphatic /sˤ/ (ص)
        "T",   # emphatic /tˤ/ (ط)
        "H",   # pharyngeal /ħ/ (ح)
        "h",   # glottal /h/ (ه)
        "d",   # /d/ (د)
        "f",   # /f/ (ف)
        "m",   # /m/ (م)
        "n",   # /n/ (ن)
        "q",   # /q/ (ق)
        "s",   # /s/ (س)
        "y",   # /j/ (ي)
        "aa",  # long /aː/
        "ii",  # long /iː/
        "uu",  # long /uː/
    ]

    # Muqatta'at clips — each is a short verse of 1-2 letter names
    # Format: surah, verse, phoneme label, descriptive name
    QURAN_CLIPS = [
        # Single letters (3 phonemes each, ~1-3s audio)
        (38, 1, ["S", "aa", "d"],                 "Saad-38"),
        (50, 1, ["q", "aa", "f"],                 "Qaf-50"),
        (68, 1, ["n", "uu", "n"],                 "Nun-68"),
        # Ha Mim — 7 surahs, same label, DIFFERENT recordings
        # Tests: can the model generalize across speaker variation?
        (40, 1, ["H", "aa", "m", "ii", "m"],      "HaMim-40"),
        (41, 1, ["H", "aa", "m", "ii", "m"],      "HaMim-41"),
        (42, 1, ["H", "aa", "m", "ii", "m"],      "HaMim-42"),
        (43, 1, ["H", "aa", "m", "ii", "m"],      "HaMim-43"),
        (44, 1, ["H", "aa", "m", "ii", "m"],      "HaMim-44"),
        (45, 1, ["H", "aa", "m", "ii", "m"],      "HaMim-45"),
        (46, 1, ["H", "aa", "m", "ii", "m"],      "HaMim-46"),
        # Ta Ha (4 phonemes, ~2-3s)
        (20, 1, ["T", "aa", "h", "aa"],            "TaHa-20"),
        # Ya Sin (5 phonemes, ~2-3s)
        (36, 1, ["y", "aa", "s", "ii", "n"],       "YaSin-36"),
    ]

    RECITER = "Alafasy_128kbps"
    BASE_URL = f"https://everyayah.com/data/{RECITER}"

    def download_quran_clip(surah, verse, name):
        """Download an MP3, convert to 16kHz mono WAV, return numpy array."""
        mp3_path = f"/tmp/quran_{name}.mp3"
        wav_path = f"/tmp/quran_{name}.wav"
        url = f"{BASE_URL}/{surah:03d}{verse:03d}.mp3"

        try:
            urllib.request.urlretrieve(url, mp3_path)
        except Exception as e:
            print(f"      FAIL: Could not download {url}: {e}")
            return None

        # Convert MP3 → 16kHz mono WAV with ffmpeg
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", mp3_path,
             "-ar", "16000", "-ac", "1", wav_path],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            print(f"      FAIL: ffmpeg error for {name}: "
                  f"{result.stderr[:200]}")
            return None

        audio, sr = sf.read(wav_path)
        if audio.ndim > 1:
            audio = audio[:, 0]
        return audio.astype(np.float32)

    print(f"\n    Downloading {len(QURAN_CLIPS)} clips from EveryAyah "
          f"({RECITER})...")

    real_clips = []
    skipped = []
    for surah, verse, phonemes, name in QURAN_CLIPS:
        audio = download_quran_clip(surah, verse, name)
        if audio is None:
            skipped.append(name)
            continue

        dur_s = len(audio) / SAMPLE_RATE

        # If clip > 6s, Bismillah is likely included.
        # Take only the LAST portion (muqatta'at are at the end).
        if dur_s > 6.0:
            keep_s = min(4.0, dur_s * 0.4)  # last 4s or 40% of clip
            keep_samples = int(keep_s * SAMPLE_RATE)
            print(f"      {name}: {dur_s:.1f}s (trimmed to last "
                  f"{keep_s:.1f}s — likely has Bismillah)")
            audio = audio[-keep_samples:]
        else:
            print(f"      {name}: {dur_s:.1f}s OK")

        # Pad to minimum 500ms
        min_len = int(0.5 * SAMPLE_RATE)
        if len(audio) < min_len:
            audio = np.pad(audio, (0, min_len - len(audio)))

        real_clips.append({
            "id": name,
            "name": name,
            "audio": audio,
            "phonemes": phonemes,
            "duration_s": len(audio) / SAMPLE_RATE,
        })

    if skipped:
        print(f"\n    Skipped {len(skipped)}: {skipped}")
    print(f"    Usable: {len(real_clips)} clips, "
          f"{sum(len(c['phonemes']) for c in real_clips)} total phonemes")

    if len(real_clips) < 5:
        print("\n    ** NOT ENOUGH CLIPS — skipping real audio test **")
        real_result = {
            "per": 1.0, "count_match_pct": 0.0,
            "exact_match_pct": 0.0, "passed": False,
            "error": "insufficient clips downloaded",
        }
    else:
        # Build vocab & model (fresh model — don't reuse espeak weights)
        vocab_2, id2p_2 = build_vocab(PHONEMES_2)
        print(f"\n    Vocab ({len(vocab_2)} tokens): {vocab_2}")

        print(f"\n    Loading fresh model...")
        model_2, fe_2 = setup_model(len(vocab_2), DEVICE)

        total_p = sum(p.numel() for p in model_2.parameters())
        train_p = sum(p.numel() for p in model_2.parameters()
                      if p.requires_grad)
        print(f"    Total: {total_p:,}, Trainable: {train_p:,}")

        # Train on ALL real clips (memorization test — tiny dataset)
        print(f"\n    Training on {len(real_clips)} real clips...")
        best_loss_2, _ = train_model(
            model_2, fe_2, real_clips, vocab_2, DEVICE,
            num_epochs=250, batch_size=4, bb_lr=1e-4, hd_lr=5e-4,
        )

        real_result = evaluate_set(
            model_2, fe_2, real_clips, vocab_2, id2p_2, DEVICE,
            label="REAL AUDIO",
        )

    # ══════════════════════════════════════════════════════════════
    #  SUMMARY
    # ══════════════════════════════════════════════════════════════

    print("\n\n" + "=" * 70)
    print("  PHASE 2 SUMMARY")
    print("=" * 70)

    print(f"\n  Test 1 — Held-Out Generalization (espeak-ng):")
    print(f"    Train:    PER={train_result['per']*100:.1f}%  "
          f"Exact={train_result['exact_match_pct']:.0f}%")
    print(f"    Held-out: PER={heldout_result['per']*100:.1f}%  "
          f"Exact={heldout_result['exact_match_pct']:.0f}%  "
          f"{'PASS' if heldout_result['passed'] else 'FAIL'}")

    print(f"\n  Test 2 — Real Quranic Audio:")
    if "error" in real_result:
        print(f"    SKIPPED: {real_result['error']}")
    else:
        print(f"    PER={real_result['per']*100:.1f}%  "
              f"Exact={real_result['exact_match_pct']:.0f}%  "
              f"{'PASS' if real_result['passed'] else 'FAIL'}")

    print("=" * 70)

    return {
        "test1_train": train_result,
        "test1_heldout": heldout_result,
        "test2_real_audio": real_result,
    }


@app.local_entrypoint()
def main():
    print("Launching CTC Phase 2 validation on Modal (A10G)...")
    print("Test 1: Held-out generalization (espeak-ng)")
    print("Test 2: Real Quranic audio (EveryAyah)\n")

    results = run_phase2_tests.remote()

    print("\n" + "=" * 50)
    print("  FINAL RESULTS")
    print("=" * 50)

    t1h = results["test1_heldout"]
    print(f"\n  Test 1 (Held-Out):")
    print(f"    PER:         {t1h['per']*100:.1f}%")
    print(f"    Count Match: {t1h['count_match_pct']:.0f}%")
    print(f"    Exact Match: {t1h['exact_match_pct']:.0f}%")
    print(f"    Status:      {'PASS' if t1h['passed'] else 'FAIL'}")

    t2 = results["test2_real_audio"]
    print(f"\n  Test 2 (Real Audio):")
    if "error" in t2:
        print(f"    SKIPPED: {t2['error']}")
    else:
        print(f"    PER:         {t2['per']*100:.1f}%")
        print(f"    Count Match: {t2['count_match_pct']:.0f}%")
        print(f"    Exact Match: {t2['exact_match_pct']:.0f}%")
        print(f"    Status:      {'PASS' if t2['passed'] else 'FAIL'}")
