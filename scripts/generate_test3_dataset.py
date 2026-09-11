"""
Generate the Test 3 Quranic Phonetic Dataset for End-to-End Verification.
80 train clips across 5 reciters + 16 held-out clips from Saood ash-Shuraym.
All audio URLs point to EveryAyah standard MP3s.
"""

import json
import os

VERSES = [
    {"surah": 2, "ayah": 1, "code": "002001", "phonemes": ["a", "l", "i", "f", "l", "aa", "m", "m", "ii", "m"], "label": "AlifLamMim"},
    {"surah": 3, "ayah": 1, "code": "003001", "phonemes": ["a", "l", "i", "f", "l", "aa", "m", "m", "ii", "m"], "label": "AlifLamMim"},
    {"surah": 20, "ayah": 1, "code": "020001", "phonemes": ["T", "aa", "h", "aa"], "label": "TaHa"},
    {"surah": 26, "ayah": 1, "code": "026001", "phonemes": ["T", "aa", "s", "ii", "n", "m", "ii", "m"], "label": "TaSinMim"},
    {"surah": 28, "ayah": 1, "code": "028001", "phonemes": ["T", "aa", "s", "ii", "n", "m", "ii", "m"], "label": "TaSinMim"},
    {"surah": 36, "ayah": 1, "code": "036001", "phonemes": ["y", "aa", "s", "ii", "n"], "label": "YaSin"},
    {"surah": 40, "ayah": 1, "code": "040001", "phonemes": ["H", "aa", "m", "ii", "m"], "label": "HaMim"},
    {"surah": 42, "ayah": 2, "code": "042002", "phonemes": ["E", "a", "y", "n", "s", "ii", "n", "q", "aa", "f"], "label": "AinSinQaf"},
    {"surah": 43, "ayah": 1, "code": "043001", "phonemes": ["H", "aa", "m", "ii", "m"], "label": "HaMim"},
    {"surah": 46, "ayah": 1, "code": "046001", "phonemes": ["H", "aa", "m", "ii", "m"], "label": "HaMim"},
    {"surah": 55, "ayah": 1, "code": "055001", "phonemes": ["a", "r", "r", "a", "H", "m", "aa", "n"], "label": "ArRahman"},
    {"surah": 69, "ayah": 1, "code": "069001", "phonemes": ["a", "l", "H", "aa", "q", "q", "a"], "label": "AlHaqqah"},
    {"surah": 89, "ayah": 1, "code": "089001", "phonemes": ["w", "a", "l", "f", "a", "j", "r"], "label": "WalFajr"},
    {"surah": 93, "ayah": 1, "code": "093001", "phonemes": ["w", "a", "D", "D", "u", "H", "aa"], "label": "WadDuha"},
    {"surah": 101, "ayah": 1, "code": "101001", "phonemes": ["a", "l", "q", "aa", "r", "i", "E", "a"], "label": "AlQariah"},
    {"surah": 103, "ayah": 1, "code": "103001", "phonemes": ["w", "a", "l", "E", "a", "S", "r"], "label": "WalAsr"},
]

TRAIN_RECITERS = [
    "Abdul_Basit_Murattal_192kbps",
    "Alafasy_128kbps",
    "Hudhaify_128kbps",
    "Husary_128kbps",
    "Minshawy_Murattal_128kbps",
]

HELDOUT_RECITER = "Saood_ash-Shuraym_128kbps"


def build_dataset():
    records = []
    
    # 1. Training records (80 clips)
    for reciter in TRAIN_RECITERS:
        for v in VERSES:
            audio_url = f"https://everyayah.com/data/{reciter}/{v['code']}.mp3"
            clip_id = f"train_{reciter}_{v['code']}"
            records.append({
                "audioClipId": clip_id,
                "id": clip_id,
                "audioUrl": audio_url,
                "phonemes": v["phonemes"],
                "qpsSequence": " ".join(v["phonemes"]),
                "split": "train",
                "reciter": reciter,
                "surah": v["surah"],
                "ayah": v["ayah"],
                "verseName": v["label"],
            })
            
    # 2. Held-out records (16 clips)
    for v in VERSES:
        audio_url = f"https://everyayah.com/data/{HELDOUT_RECITER}/{v['code']}.mp3"
        clip_id = f"eval_{HELDOUT_RECITER}_{v['code']}"
        records.append({
            "audioClipId": clip_id,
            "id": clip_id,
            "audioUrl": audio_url,
            "phonemes": v["phonemes"],
            "qpsSequence": " ".join(v["phonemes"]),
            "split": "eval",
            "reciter": HELDOUT_RECITER,
            "surah": v["surah"],
            "ayah": v["ayah"],
            "verseName": v["label"],
        })
        
    return records


if __name__ == "__main__":
    records = build_dataset()
    print(f"Generated {len(records)} total records: {sum(1 for r in records if r['split'] == 'train')} train, {sum(1 for r in records if r['split'] == 'eval')} eval")
    
    os.makedirs("public/data", exist_ok=True)
    out_paths = [
        "public/data/test3_quran_dataset.jsonl",
        "test3_quran_dataset.jsonl",
    ]
    
    for path in out_paths:
        with open(path, "w", encoding="utf-8") as f:
            for r in records:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"Saved: {path} ({os.path.getsize(path)} bytes)")
