"""
Generate synthetic toy audio clips + phoneme labels for CTC training validation.

Creates 20 short audio clips (1-3 seconds each) with simple sine-wave tones
at different frequencies to simulate distinct "phonemes". Each clip gets a
matching label file with a phoneme sequence.

This is NOT real Quranic audio — it's purely to validate that the training
loop mechanics work (data loading, tokenizer, loss computation, gradient flow).
Swap in real audio after confirming the pipeline runs.

Usage:
    python generate_toy_data.py

Output:
    test_ctc/toy_clips/
        clip_00.wav  clip_00.txt
        clip_01.wav  clip_01.txt
        ...
"""

import os
import numpy as np
import soundfile as sf

SAMPLE_RATE = 16000
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "toy_clips")

# Minimal QPS-inspired phoneme vocabulary for testing.
# These are real Arabic phoneme symbols from the obadx QPS set,
# but the audio is synthetic — we just need the tokenizer to work.
PHONEMES = ["b", "t", "d", "s", "k", "m", "n", "l", "r", "f",
            "a", "i", "u", "aː", "iː", "uː"]

# Each "clip" is a sequence of 2-5 phonemes.
# We generate a distinct tone for each phoneme so the model
# has a learnable signal (different frequencies = different labels).
PHONEME_FREQ = {p: 200 + i * 80 for i, p in enumerate(PHONEMES)}

# 20 hand-crafted label sequences (short, varied)
LABEL_SEQUENCES = [
    ["b", "a"],
    ["t", "i"],
    ["d", "u"],
    ["s", "a", "l"],
    ["k", "a", "m"],
    ["n", "u", "r"],
    ["l", "a", "m"],
    ["r", "a", "b"],
    ["f", "a", "t"],
    ["m", "i", "n"],
    ["b", "a", "s", "m"],
    ["k", "i", "t", "a", "b"],
    ["d", "a", "r", "s"],
    ["n", "u", "r", "aː"],
    ["s", "a", "l", "aː", "m"],
    ["t", "a", "b"],
    ["f", "i"],
    ["m", "u"],
    ["b", "aː", "b"],
    ["k", "u", "n"],
]


def generate_phoneme_audio(phoneme: str, duration_sec: float = 0.15) -> np.ndarray:
    """Generate a sine wave tone for a phoneme."""
    freq = PHONEME_FREQ.get(phoneme, 440)
    t = np.linspace(0, duration_sec, int(SAMPLE_RATE * duration_sec), endpoint=False)
    # Add a small fade in/out to avoid clicks
    signal = np.sin(2 * np.pi * freq * t)
    fade_len = min(int(0.01 * SAMPLE_RATE), len(signal) // 4)
    signal[:fade_len] *= np.linspace(0, 1, fade_len)
    signal[-fade_len:] *= np.linspace(1, 0, fade_len)
    return signal


def generate_clip(phonemes: list[str]) -> np.ndarray:
    """Generate a full clip by concatenating phoneme tones with short silence gaps."""
    segments = []
    silence = np.zeros(int(0.05 * SAMPLE_RATE))  # 50ms gap between phonemes
    for i, p in enumerate(phonemes):
        # Vary duration slightly so the model can't just rely on fixed timing
        dur = 0.12 + 0.06 * (hash(p) % 5) / 5
        segments.append(generate_phoneme_audio(p, dur))
        if i < len(phonemes) - 1:
            segments.append(silence)
    return np.concatenate(segments)


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print(f"Generating {len(LABEL_SEQUENCES)} toy clips in {OUTPUT_DIR}/")
    print(f"Phoneme vocabulary ({len(PHONEMES)}): {PHONEMES}")
    print()

    for idx, seq in enumerate(LABEL_SEQUENCES):
        clip_name = f"clip_{idx:02d}"

        # Generate audio
        audio = generate_clip(seq)
        wav_path = os.path.join(OUTPUT_DIR, f"{clip_name}.wav")
        sf.write(wav_path, audio, SAMPLE_RATE)

        # Write label file (space-separated phonemes)
        txt_path = os.path.join(OUTPUT_DIR, f"{clip_name}.txt")
        with open(txt_path, "w", encoding="utf-8") as f:
            f.write(" ".join(seq))

        dur_ms = len(audio) / SAMPLE_RATE * 1000
        print(f"  {clip_name}.wav  ({dur_ms:.0f}ms)  label: {' '.join(seq)}")

    # Write the vocabulary file
    vocab_path = os.path.join(OUTPUT_DIR, "vocab.json")
    import json
    # CTC vocab needs: each phoneme → integer ID, plus special tokens
    vocab = {"<pad>": 0, "<unk>": 1, "|": 2}  # | = word boundary / silence
    for i, p in enumerate(PHONEMES):
        vocab[p] = i + 3
    with open(vocab_path, "w", encoding="utf-8") as f:
        json.dump(vocab, f, ensure_ascii=False, indent=2)

    print(f"\n  vocab.json written ({len(vocab)} tokens)")
    print(f"\nDone! Run test_ctc_training.py next.")


if __name__ == "__main__":
    main()
