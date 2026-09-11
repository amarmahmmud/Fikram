"""
CTC Validation Test 3: Real Audio, Genuine Held-Out Split, Diverse Labels
==========================================================================

The definitive generalization test before backend integration.

Design:
  - 15 verse/surah combos from EveryAyah, 12 unique phoneme labels
  - 5-6 different reciters (speakers) for each verse
  - Split BY RECITER: 4 reciters train, 1 reciter held-out
  - 80% train / 20% held-out, ZERO recording overlap
  - All labels appear in both sets (different speaker = generalization test)

Audio curation:
  - ONLY verses where the ENTIRE audio content = the phoneme label
  - Dropped Saad(38:1), Qaf(50:1), Nun(68:1) — those verses include
    extra text after the muqatta'at letters
  - Used verified single-word verses and pure-letter muqatta'at only

Phoneme coverage: 22 Arabic phonemes (emphatics, pharyngeals, vowels)

Usage:
    modal run test_ctc/test_ctc_modal_v3.py
"""

import modal

app = modal.App("ctc-test3-generalization")

training_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg")
    .pip_install(
        "torch>=2.1",
        "torchaudio>=2.1",
        "transformers>=4.40",
        "soundfile",
        "jiwer",
        "numpy",
    )
)


@app.function(image=training_image, gpu="A10G", timeout=1800)
def run_test3():
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
    print("  TEST 3: REAL AUDIO + GENUINE HELD-OUT SPLIT")
    print("=" * 70)
    print(f"  Device: {DEVICE}")
    if DEVICE == "cuda":
        print(f"  GPU:    {torch.cuda.get_device_name(0)}")

    # ══════════════════════════════════════════
    # 1. PHONEME VOCABULARY (22 Arabic phonemes)
    # ══════════════════════════════════════════
    PHONEMES = [
        "S", "T", "D",         # emphatics: ص ط ض
        "H", "E",              # pharyngeals: ح ع
        "h",                   # glottal: ه
        "a", "aa",             # short/long fatha
        "i", "ii",             # short/long kasra
        "u",                   # short damma
        "d", "f", "j",        # د ف ج
        "l", "m", "n",        # ل م ن
        "q", "r", "s",        # ق ر س
        "w", "y",             # و ي (consonant)
    ]
    vocab = {"<pad>": 0, "<unk>": 1}
    for p in PHONEMES:
        vocab[p] = len(vocab)
    id_to_phoneme = {v: k for k, v in vocab.items()}
    vocab_size = len(vocab)
    print(f"\n  Vocab: {vocab_size} tokens ({len(PHONEMES)} phonemes)")

    # ══════════════════════════════════════════
    # 2. VERSE DEFINITIONS
    # ══════════════════════════════════════════
    # ONLY verses where audio = exact label content.
    # Verified against Madinah Mushaf verse boundaries.
    VERSES = [
        # ── Pure-letter muqatta'at ──
        # الم (Alif Lam Mim) — 6 surahs, all verse 1 = just letters
        (2,  1, ["a","l","i","f","l","aa","m","m","ii","m"], "AlifLamMim-02"),
        (3,  1, ["a","l","i","f","l","aa","m","m","ii","m"], "AlifLamMim-03"),
        # طه (Ta Ha) — 20:1 is just the two letters
        (20, 1, ["T","aa","h","aa"],                         "TaHa-20"),
        # طسم (Ta Sin Mim) — 26:1, 28:1 are just the letters
        (26, 1, ["T","aa","s","ii","n","m","ii","m"],        "TaSinMim-26"),
        (28, 1, ["T","aa","s","ii","n","m","ii","m"],        "TaSinMim-28"),
        # يس (Ya Sin) — 36:1 is just the two letters
        (36, 1, ["y","aa","s","ii","n"],                     "YaSin-36"),
        # حم (Ha Mim) — 40-46:1 are all just the two letters
        (40, 1, ["H","aa","m","ii","m"],                     "HaMim-40"),
        (43, 1, ["H","aa","m","ii","m"],                     "HaMim-43"),
        (46, 1, ["H","aa","m","ii","m"],                     "HaMim-46"),
        # عسق (Ain Sin Qaf) — 42:2 is just the three letters
        (42, 2, ["E","a","y","n","s","ii","n","q","aa","f"], "AinSinQaf-42"),
        # ── Short single-word verses ──
        # Each verse IS the entire word, no extra text
        (55, 1, ["a","r","r","a","H","m","aa","n"],          "ArRahman-55"),
        (69, 1, ["a","l","H","aa","q","q","a"],              "AlHaqqah-69"),
        (89, 1, ["w","a","l","f","a","j","r"],               "WalFajr-89"),
        (93, 1, ["w","a","D","D","u","H","aa"],              "WadDuha-93"),
        (101,1, ["a","l","q","aa","r","i","E","a"],          "AlQariah-101"),
        (103,1, ["w","a","l","E","a","S","r"],               "WalAsr-103"),
    ]

    n_unique_labels = len(set(tuple(v[2]) for v in VERSES))
    print(f"  Verses: {len(VERSES)} combos, {n_unique_labels} unique labels")
    print(f"  Phonemes per label: {min(len(v[2]) for v in VERSES)}-"
          f"{max(len(v[2]) for v in VERSES)}")

    # ══════════════════════════════════════════
    # 3. RECITERS
    # ══════════════════════════════════════════
    RECITERS = [
        "Alafasy_128kbps",
        "Husary_128kbps",
        "Abdul_Basit_Murattal_192kbps",
        "Minshawy_Murattal_128kbps",
        "Hudhaify_128kbps",
        "Saood_ash-Shuraym_128kbps",
    ]
    BASE_URL = "https://everyayah.com/data"

    # ══════════════════════════════════════════
    # 4. DOWNLOAD
    # ══════════════════════════════════════════
    def download_clip(surah, verse, reciter, phonemes, name):
        """Download MP3 from EveryAyah, convert to 16kHz mono WAV."""
        url = f"{BASE_URL}/{reciter}/{surah:03d}{verse:03d}.mp3"
        safe_reciter = reciter.replace("/", "_")
        mp3_path = f"/tmp/{safe_reciter}_{name}.mp3"
        wav_path = f"/tmp/{safe_reciter}_{name}.wav"

        try:
            urllib.request.urlretrieve(url, mp3_path)
        except Exception:
            return None

        result = subprocess.run(
            ["ffmpeg", "-y", "-i", mp3_path,
             "-ar", str(SAMPLE_RATE), "-ac", "1", wav_path],
            capture_output=True, text=True,
        )
        if result.returncode != 0:
            return None

        audio, sr = sf.read(wav_path)
        if audio.ndim > 1:
            audio = audio[:, 0]

        dur_s = len(audio) / SAMPLE_RATE
        trimmed = False

        # Bismillah handling: estimate expected content duration,
        # if clip is much longer, Bismillah is included — trim from end.
        expected_s = len(phonemes) * 0.4 + 1.5
        if dur_s > expected_s + 3.0:
            keep_s = max(expected_s + 1.0, dur_s * 0.35)
            keep_samples = int(keep_s * SAMPLE_RATE)
            audio = audio[-keep_samples:]
            trimmed = True

        # Pad short clips to minimum 500ms
        min_len = int(0.5 * SAMPLE_RATE)
        if len(audio) < min_len:
            audio = np.pad(audio, (0, min_len - len(audio)))

        return {
            "audio": audio.astype(np.float32),
            "dur_s": len(audio) / SAMPLE_RATE,
            "orig_dur_s": dur_s,
            "trimmed": trimmed,
        }

    print(f"\n  Downloading from {len(RECITERS)} reciters...")
    clips_by_reciter = {}

    for reciter in RECITERS:
        clips = []
        for surah, verse, phonemes, name in VERSES:
            r = download_clip(surah, verse, reciter, phonemes, name)
            if r is None:
                continue
            clips.append({
                "id": f"{reciter[:10]}|{name}",
                "name": name,
                "reciter": reciter,
                "audio": r["audio"],
                "phonemes": phonemes,
                "dur_s": r["dur_s"],
                "trimmed": r["trimmed"],
            })

        ok = len(clips) >= 10
        clips_by_reciter[reciter] = clips if ok else []
        tag = "OK" if ok else "SKIP"
        trims = sum(1 for c in clips if c.get("trimmed"))
        print(f"    [{tag}] {reciter}: {len(clips)}/{len(VERSES)} clips"
              f" ({trims} trimmed)")

    # Filter to reciters with enough clips
    working = {r: c for r, c in clips_by_reciter.items() if len(c) >= 10}
    print(f"\n  Working reciters: {len(working)}/{len(RECITERS)}")

    if len(working) < 3:
        print("  ** ABORT: Need at least 3 working reciters **")
        return {"error": "insufficient reciters", "count": len(working)}

    # ══════════════════════════════════════════
    # 5. TRAIN / HELD-OUT SPLIT (by reciter)
    # ══════════════════════════════════════════
    sorted_reciters = sorted(working.keys())
    heldout_reciter = sorted_reciters[-1]
    train_reciters = sorted_reciters[:-1]

    train_clips = []
    for r in train_reciters:
        train_clips.extend(working[r])
    heldout_clips = working[heldout_reciter]

    total = len(train_clips) + len(heldout_clips)
    ho_pct = len(heldout_clips) / total * 100

    print(f"\n  ──── SPLIT ────")
    print(f"  Train:    {len(train_clips)} clips")
    for r in train_reciters:
        print(f"            - {r} ({len(working[r])} clips)")
    print(f"  Held-out: {len(heldout_clips)} clips from {heldout_reciter}")
    print(f"  Ratio:    {ho_pct:.0f}% held-out")

    # Verify ZERO recording overlap
    train_ids = set(c["id"] for c in train_clips)
    heldout_ids = set(c["id"] for c in heldout_clips)
    overlap = train_ids & heldout_ids
    assert len(overlap) == 0, f"Recording overlap: {overlap}"
    print(f"  Recording overlap: 0 (verified)")

    # Label coverage check
    train_labels = set(tuple(c["phonemes"]) for c in train_clips)
    heldout_labels = set(tuple(c["phonemes"]) for c in heldout_clips)
    only_heldout = heldout_labels - train_labels
    print(f"  Unique labels — train: {len(train_labels)}, "
          f"held-out: {len(heldout_labels)}")
    if only_heldout:
        print(f"  WARNING: {len(only_heldout)} labels ONLY in held-out "
              f"(not seen in training)")

    # Print all held-out clips for transparency
    print(f"\n  Held-out clips ({heldout_reciter}):")
    for c in heldout_clips:
        ph = " ".join(c["phonemes"])
        print(f"    {c['name']:20s}  {c['dur_s']:.1f}s  "
              f"[{len(c['phonemes'])} ph]  {ph}")

    # ══════════════════════════════════════════
    # 6. SHARED UTILITIES
    # ══════════════════════════════════════════

    def ctc_greedy_decode(pred_ids, id_map, blank_id=0):
        collapsed = []
        prev = None
        for t in pred_ids:
            if t != prev:
                collapsed.append(t)
                prev = t
        return [id_map[t] for t in collapsed if t != blank_id and t in id_map]

    def make_collate(fe):
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
                "input_values": feats.input_values.to(DEVICE),
                "attention_mask": feats.attention_mask.to(DEVICE),
                "labels": labels.to(DEVICE),
            }
        return collate

    # ══════════════════════════════════════════
    # 7. MODEL
    # ══════════════════════════════════════════
    print(f"\n  Loading facebook/wav2vec2-base...")
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
    model.to(DEVICE)

    total_p = sum(p.numel() for p in model.parameters())
    train_p = sum(p.numel() for p in model.parameters() if p.requires_grad)
    print(f"  Params: {total_p:,} total, {train_p:,} trainable")

    # ══════════════════════════════════════════
    # 8. TRAINING
    # ══════════════════════════════════════════
    NUM_EPOCHS = 250
    BATCH_SIZE = 4
    BB_LR = 1e-4
    HD_LR = 5e-4

    collate = make_collate(fe)

    backbone_params = [p for n, p in model.named_parameters()
                       if p.requires_grad and "lm_head" not in n]
    head_params = [p for n, p in model.named_parameters()
                   if p.requires_grad and "lm_head" in n]

    optimizer = torch.optim.AdamW([
        {"params": backbone_params, "lr": BB_LR},
        {"params": head_params, "lr": HD_LR},
    ], weight_decay=0.01)

    num_batches = (len(train_clips) + BATCH_SIZE - 1) // BATCH_SIZE
    total_steps = NUM_EPOCHS * num_batches
    scheduler = torch.optim.lr_scheduler.OneCycleLR(
        optimizer, max_lr=[BB_LR, HD_LR],
        total_steps=total_steps, pct_start=0.15,
        anneal_strategy="cos",
    )

    print(f"\n  ──── TRAINING ────")
    print(f"  {len(train_clips)} clips, batch {BATCH_SIZE}, "
          f"{NUM_EPOCHS} epochs, {total_steps} steps")
    print(f"  Encoder: FROZEN | LR: bb={BB_LR}, hd={HD_LR}")

    indices = np.arange(len(train_clips))
    loss_history = []
    best_loss = float("inf")
    best_state = None
    t0 = time.time()

    model.train()
    for epoch in range(1, NUM_EPOCHS + 1):
        np.random.shuffle(indices)
        batches = [
            [train_clips[indices[j]]
             for j in range(i, min(i + BATCH_SIZE, len(indices)))]
            for i in range(0, len(indices), BATCH_SIZE)
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

        if epoch <= 5 or epoch % 25 == 0 or epoch == NUM_EPOCHS:
            trend = ""
            if len(loss_history) >= 2 and not np.isnan(loss_history[-2]):
                d = loss_history[-1] - loss_history[-2]
                trend = " [v]" if d < -0.02 else (
                    " [^]" if d > 0.02 else " [=]")
            print(f"    Epoch {epoch:3d}/{NUM_EPOCHS}  loss: {avg:.4f}{trend}")

    elapsed = time.time() - t0
    print(f"    Done in {elapsed:.1f}s ({elapsed/NUM_EPOCHS:.2f}s/epoch)")
    print(f"    Best loss: {best_loss:.4f}")

    if best_state:
        model.load_state_dict(best_state)
        model.to(DEVICE)

    # ══════════════════════════════════════════
    # 9. EVALUATION (train + held-out separately)
    # ══════════════════════════════════════════
    def evaluate(data, label):
        model.eval()
        all_refs, all_hyps = [], []
        count_ok = exact_ok = 0
        n = len(data)

        print(f"\n  ──── {label} ({n} clips) ────")

        with torch.no_grad():
            for item in data:
                feats = fe(
                    item["audio"], sampling_rate=SAMPLE_RATE,
                    return_tensors="pt", padding=True,
                )
                logits = model(feats.input_values.to(DEVICE)).logits
                ids = torch.argmax(logits, dim=-1)[0].cpu().tolist()
                pred = ctc_greedy_decode(ids, id_to_phoneme)

                expected = item["phonemes"]
                ref_str = " ".join(expected)
                hyp_str = " ".join(pred) if pred else "[EMPTY]"

                all_refs.append(ref_str)
                all_hyps.append(" ".join(pred))

                c_ok = abs(len(pred) - len(expected)) <= 1
                e_ok = pred == expected
                if c_ok: count_ok += 1
                if e_ok: exact_ok += 1

                tag = "OK" if e_ok else ("~ " if c_ok else "X ")
                print(f"    [{tag}] {item['name']:20s}  "
                      f"expect: {ref_str:30s}  got: {hyp_str:30s}  "
                      f"(exp={len(expected)}, got={len(pred)})")

        per = jiwer.wer(all_refs, all_hyps) if all_refs else 1.0
        count_pct = count_ok / n * 100 if n else 0
        exact_pct = exact_ok / n * 100 if n else 0

        c1 = per < 0.25
        c2 = count_pct >= 70
        c3 = exact_pct >= 40
        passed = c1 and c2 and c3

        print(f"\n  {label} METRICS:")
        print(f"    PER:         {per*100:.1f}%  "
              f"{'PASS' if c1 else 'FAIL'} (need <25%)")
        print(f"    Count Match: {count_pct:.0f}%   "
              f"{'PASS' if c2 else 'FAIL'} (need >=70%)")
        print(f"    Exact Match: {exact_pct:.0f}%   "
              f"{'PASS' if c3 else 'FAIL'} (need >=40%)")
        print(f"    Overall:     {'ALL PASSED' if passed else 'NOT PASSING'}")

        return {
            "per": float(per),
            "count_match_pct": float(count_pct),
            "exact_match_pct": float(exact_pct),
            "passed": passed,
            "n_clips": n,
        }

    train_result = evaluate(train_clips, "TRAIN SET")
    model.train()  # Reset BN/dropout state
    model.eval()
    heldout_result = evaluate(heldout_clips, "HELD-OUT SET")

    # ══════════════════════════════════════════
    # 10. SUMMARY
    # ══════════════════════════════════════════
    gap_exact = train_result["exact_match_pct"] - heldout_result["exact_match_pct"]
    gap_per = heldout_result["per"] - train_result["per"]

    print("\n" + "=" * 70)
    print("  TEST 3 SUMMARY")
    print("=" * 70)
    print(f"\n  Data: {total} real Quranic clips from "
          f"{len(working)} reciters")
    print(f"  Split: {len(train_clips)} train / "
          f"{len(heldout_clips)} held-out ({ho_pct:.0f}%)")
    print(f"  Held-out reciter: {heldout_reciter}")
    print(f"  Recording overlap: 0")
    print(f"  Unique labels: {n_unique_labels}")

    print(f"\n  {'Metric':<20s} {'Train':>10s} {'Held-Out':>10s} {'Gap':>8s}")
    print(f"  {'-'*48}")
    print(f"  {'PER':<20s} {train_result['per']*100:>9.1f}% "
          f"{heldout_result['per']*100:>9.1f}% "
          f"{gap_per*100:>+7.1f}pp")
    print(f"  {'Count Match':<20s} {train_result['count_match_pct']:>9.0f}% "
          f"{heldout_result['count_match_pct']:>9.0f}%")
    print(f"  {'Exact Match':<20s} {train_result['exact_match_pct']:>9.0f}% "
          f"{heldout_result['exact_match_pct']:>9.0f}% "
          f"{-gap_exact:>+7.0f}pp")

    ho_passed = heldout_result["passed"]
    print(f"\n  HELD-OUT VERDICT: {'PASS' if ho_passed else 'FAIL'}")

    if heldout_result["exact_match_pct"] < 10:
        print("  ** Total collapse on held-out — model memorized, "
              "did not generalize")
    elif gap_exact > 50:
        print(f"  ** Large overfitting gap ({gap_exact:.0f}pp) — "
              "needs more data/regularization")
    elif ho_passed:
        print("  ** Cross-speaker generalization confirmed! "
              "Ready for backend integration.")
    print("=" * 70)

    return {
        "train": train_result,
        "heldout": heldout_result,
        "heldout_reciter": heldout_reciter,
        "n_reciters": len(working),
        "n_total_clips": total,
        "best_loss": float(best_loss),
    }


@app.local_entrypoint()
def main():
    print("Launching Test 3: Real audio generalization on Modal (A10G)...")
    print("15 verses x 5+ reciters, split by speaker\n")

    result = run_test3.remote()

    if "error" in result:
        print(f"\nERROR: {result['error']}")
        return

    print("\n" + "=" * 50)
    print("  TEST 3 FINAL RESULTS")
    print("=" * 50)
    print(f"\n  Reciters: {result['n_reciters']}")
    print(f"  Total clips: {result['n_total_clips']}")
    print(f"  Held-out reciter: {result['heldout_reciter']}")
    print(f"  Best training loss: {result['best_loss']:.4f}")

    for label, data in [("Train", result["train"]),
                        ("Held-Out", result["heldout"])]:
        print(f"\n  {label}:")
        print(f"    PER:         {data['per']*100:.1f}%")
        print(f"    Count Match: {data['count_match_pct']:.0f}%")
        print(f"    Exact Match: {data['exact_match_pct']:.0f}%")
        print(f"    Status:      {'PASS' if data['passed'] else 'FAIL'}")

    print(f"\n  VERDICT: {'PASS -- Ready for backend integration'}"
          if result["heldout"]["passed"]
          else "  VERDICT: FAIL -- Needs diagnosis before integration")
