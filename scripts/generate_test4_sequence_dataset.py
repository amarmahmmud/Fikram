"""
Generate Test 4 Dataset: Sequence Generalization Validation.
Goal: Prove whether fine-tuned CTC generalizes to novel phoneme sequences never seen in training.

Constraints:
1. 0% Sequence Overlap between Train and Held-Out.
2. 100% Constituent Phoneme Coverage (all phonemes in held-out must exist in train).
3. Evaluated across all 6 reciters (including both seen and unseen reciters).
"""

import json
import os

# 1. Complete pool of verified 16 verses
ALL_VERSES = [
    # Training pool (12 verse instances, 9 unique sequences)
    {"surah": 2, "ayah": 1, "code": "002001", "phonemes": ["a", "l", "i", "f", "l", "aa", "m", "m", "ii", "m"], "label": "AlifLamMim", "target_split": "train"},
    {"surah": 3, "ayah": 1, "code": "003001", "phonemes": ["a", "l", "i", "f", "l", "aa", "m", "m", "ii", "m"], "label": "AlifLamMim", "target_split": "train"},
    {"surah": 20, "ayah": 1, "code": "020001", "phonemes": ["T", "aa", "h", "aa"], "label": "TaHa", "target_split": "train"},
    {"surah": 36, "ayah": 1, "code": "036001", "phonemes": ["y", "aa", "s", "ii", "n"], "label": "YaSin", "target_split": "train"},
    {"surah": 40, "ayah": 1, "code": "040001", "phonemes": ["H", "aa", "m", "ii", "m"], "label": "HaMim", "target_split": "train"},
    {"surah": 43, "ayah": 1, "code": "043001", "phonemes": ["H", "aa", "m", "ii", "m"], "label": "HaMim", "target_split": "train"},
    {"surah": 46, "ayah": 1, "code": "046001", "phonemes": ["H", "aa", "m", "ii", "m"], "label": "HaMim", "target_split": "train"},
    {"surah": 55, "ayah": 1, "code": "055001", "phonemes": ["a", "r", "r", "a", "H", "m", "aa", "n"], "label": "ArRahman", "target_split": "train"},
    {"surah": 69, "ayah": 1, "code": "069001", "phonemes": ["a", "l", "H", "aa", "q", "q", "a"], "label": "AlHaqqah", "target_split": "train"},
    {"surah": 89, "ayah": 1, "code": "089001", "phonemes": ["w", "a", "l", "f", "a", "j", "r"], "label": "WalFajr", "target_split": "train"},
    {"surah": 93, "ayah": 1, "code": "093001", "phonemes": ["w", "a", "D", "D", "u", "H", "aa"], "label": "WadDuha", "target_split": "train"},
    {"surah": 103, "ayah": 1, "code": "103001", "phonemes": ["w", "a", "l", "E", "a", "S", "r"], "label": "WalAsr", "target_split": "train"},

    # Held-out pool (4 verse instances, 3 completely novel sequences never in train)
    {"surah": 26, "ayah": 1, "code": "026001", "phonemes": ["T", "aa", "s", "ii", "n", "m", "ii", "m"], "label": "TaSinMim", "target_split": "eval"},
    {"surah": 28, "ayah": 1, "code": "028001", "phonemes": ["T", "aa", "s", "ii", "n", "m", "ii", "m"], "label": "TaSinMim", "target_split": "eval"},
    {"surah": 42, "ayah": 2, "code": "042002", "phonemes": ["E", "a", "y", "n", "s", "ii", "n", "q", "aa", "f"], "label": "AinSinQaf", "target_split": "eval"},
    {"surah": 101, "ayah": 1, "code": "101001", "phonemes": ["a", "l", "q", "aa", "r", "i", "E", "a"], "label": "AlQariah", "target_split": "eval"},
]

RECITERS = [
    "Abdul_Basit_Murattal_192kbps",
    "Alafasy_128kbps",
    "Hudhaify_128kbps",
    "Husary_128kbps",
    "Minshawy_Murattal_128kbps",
    "Saood_ash-Shuraym_128kbps",
]


def generate():
    train_sequences = set(tuple(v["phonemes"]) for v in ALL_VERSES if v["target_split"] == "train")
    eval_sequences = set(tuple(v["phonemes"]) for v in ALL_VERSES if v["target_split"] == "eval")

    # 1. Assert strict zero sequence overlap
    overlap = train_sequences & eval_sequences
    assert len(overlap) == 0, f"Sequence overlap violation! Overlapping: {overlap}"

    # 2. Assert 100% constituent phoneme coverage
    train_phonemes = set(p for seq in train_sequences for p in seq)
    eval_phonemes = set(p for seq in eval_sequences for p in seq)
    missing_phonemes = eval_phonemes - train_phonemes
    assert len(missing_phonemes) == 0, f"Missing phoneme violation! Eval has phonemes not in train: {missing_phonemes}"

    print(f"=== TEST 4 DATASET INTEGRITY CHECK ===")
    print(f"Train Sequences ({len(train_sequences)}):")
    for s in sorted(list(train_sequences)):
        print(f"  - {' '.join(s)}")
    print(f"Held-Out NOVEL Sequences ({len(eval_sequences)}):")
    for s in sorted(list(eval_sequences)):
        print(f"  - {' '.join(s)}")
    print(f"\nPhoneme Inventory: {len(train_phonemes)} phonemes (100% covered in train)")
    print(f"Sequence Overlap: 0.00% (Strictly Disjoint)")

    # Build dataset records across all reciters
    records = []
    for r in RECITERS:
        for v in ALL_VERSES:
            clip_id = f"{v['target_split']}_{r[:10]}_{v['code']}"
            audio_url = f"https://everyayah.com/data/{r}/{v['code']}.mp3"
            records.append({
                "audioClipId": clip_id,
                "id": clip_id,
                "audioUrl": audio_url,
                "phonemes": v["phonemes"],
                "qpsSequence": " ".join(v["phonemes"]),
                "split": v["target_split"],
                "reciter": r,
                "surah": v["surah"],
                "ayah": v["ayah"],
                "verseName": v["label"],
            })

    train_count = sum(1 for r in records if r["split"] == "train")
    eval_count = sum(1 for r in records if r["split"] == "eval")
    print(f"\nGenerated {len(records)} total records: {train_count} train clips, {eval_count} held-out novel clips.")

    out_paths = [
        "public/data/test4_sequence_generalization.jsonl",
        "test4_sequence_generalization.jsonl",
    ]
    for p in out_paths:
        os.makedirs(os.path.dirname(p) if os.path.dirname(p) else ".", exist_ok=True)
        with open(p, "w", encoding="utf-8") as f:
            for rec in records:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
        print(f"Saved: {p} ({os.path.getsize(p)} bytes)")


if __name__ == "__main__":
    generate()
