"use client";

import { useState, useRef, useEffect, use, useCallback } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import styles from "./page.module.css";
import type { Database } from "@/lib/supabase/types";
import { apiClient } from "@/lib/apiClient";
import {
  Mic,
  Square,
  UploadCloud,
  Play,
  Pause,
  RotateCcw,
  Sparkles,
  Info,
  CheckCircle2,
  AlertTriangle,
  FileAudio,
  Cpu,
  ArrowRight,
  HelpCircle,
  Clock,
  History,
  Check,
} from "lucide-react";

type Job = Database["public"]["Tables"]["jobs"]["Row"];

interface AlignmentItem {
  expected: string | null;
  predicted: string | null;
  status: "match" | "substitution" | "deletion" | "insertion";
}

interface InferenceResult {
  job_id: string;
  duration_seconds: number;
  phonemes: string[];
  phoneme_string: string;
  token_count: number;
  evaluation?: {
    expected_phonemes: string[];
    expected_string: string;
    per: number;
    cer: number;
    exact_match: boolean;
    count_match: boolean;
    alignment: AlignmentItem[];
  };
}

interface BenchmarkItem {
  id: string;
  surah: number;
  ayah: number;
  verseName: string;
  arabic: string;
  reciter: string;
  audioUrl: string;
  phonemes: string[];
  qpsSequence: string;
}

const BENCHMARKS: BenchmarkItem[] = [
  {
    id: "alif-lam-mim",
    surah: 2,
    ayah: 1,
    verseName: "Alif-Lam-Mim",
    arabic: "الۤمۤ",
    reciter: "Abdul Basit (Murattal)",
    audioUrl: "https://everyayah.com/data/Abdul_Basit_Murattal_192kbps/002001.mp3",
    phonemes: ["a", "l", "i", "f", "l", "aa", "m", "m", "ii", "m"],
    qpsSequence: "a l i f l aa m m ii m",
  },
  {
    id: "ta-ha",
    surah: 20,
    ayah: 1,
    verseName: "Ta-Ha",
    arabic: "طه",
    reciter: "Abdul Basit (Murattal)",
    audioUrl: "https://everyayah.com/data/Abdul_Basit_Murattal_192kbps/020001.mp3",
    phonemes: ["T", "aa", "h", "aa"],
    qpsSequence: "T aa h aa",
  },
  {
    id: "ya-sin",
    surah: 36,
    ayah: 1,
    verseName: "Ya-Sin",
    arabic: "يسۤ",
    reciter: "Abdul Basit (Murattal)",
    audioUrl: "https://everyayah.com/data/Abdul_Basit_Murattal_192kbps/036001.mp3",
    phonemes: ["y", "aa", "s", "ii", "n"],
    qpsSequence: "y aa s ii n",
  },
  {
    id: "ha-mim",
    surah: 40,
    ayah: 1,
    verseName: "Ha-Mim",
    arabic: "حمۤ",
    reciter: "Abdul Basit (Murattal)",
    audioUrl: "https://everyayah.com/data/Abdul_Basit_Murattal_192kbps/040001.mp3",
    phonemes: ["H", "aa", "m", "ii", "m"],
    qpsSequence: "H aa m ii m",
  },
  {
    id: "ta-sin-mim",
    surah: 26,
    ayah: 1,
    verseName: "Ta-Sin-Mim",
    arabic: "طسۤمۤ",
    reciter: "Abdul Basit (Murattal)",
    audioUrl: "https://everyayah.com/data/Abdul_Basit_Murattal_192kbps/026001.mp3",
    phonemes: ["T", "aa", "s", "ii", "n", "m", "ii", "m"],
    qpsSequence: "T aa s ii n m ii m",
  },
  {
    id: "al-ikhlas-1",
    surah: 112,
    ayah: 1,
    verseName: "Al-Ikhlas (Ayah 1)",
    arabic: "قُلْ هُوَ اللَّهُ أَحَدٌ",
    reciter: "Abdul Basit (Murattal)",
    audioUrl: "https://everyayah.com/data/Abdul_Basit_Murattal_192kbps/112001.mp3",
    phonemes: ["q", "u", "l", "h", "u", "w", "a", "l", "l", "aa", "h", "u", "a", "H", "a", "d"],
    qpsSequence: "q u l h u w a l l aa h u a H a d",
  },
];

export default function ASRPlaygroundPage({ params }: { params: Promise<{ id: string }> }) {
  const resolvedParams = use(params);
  const supabase = createClient();

  const [job, setJob] = useState<Job | null>(null);
  const [loadingJob, setLoadingJob] = useState(true);

  // Input mode: "mic" | "upload" | "benchmark"
  const [activeTab, setActiveTab] = useState<"mic" | "upload" | "benchmark">("benchmark");

  // Selected or recorded audio state
  const [audioUrl, setAudioUrl] = useState<string>(BENCHMARKS[0].audioUrl);
  const [audioBase64, setAudioBase64] = useState<string>("");
  const [audioBlobUrl, setAudioBlobUrl] = useState<string>("");
  const [selectedBenchmarkId, setSelectedBenchmarkId] = useState<string>(BENCHMARKS[0].id);
  const [expectedPhonemes, setExpectedPhonemes] = useState<string>(BENCHMARKS[0].qpsSequence);

  // Microphone recording states
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>([10, 15, 8, 20, 12]);
  const animFrameRef = useRef<number | null>(null);

  // Audio player state
  const [isPlayingPreview, setIsPlayingPreview] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);

  // Testing & Inference execution state
  const [isInferring, setIsInferring] = useState(false);
  const [inferError, setInferError] = useState<string | null>(null);
  const [latestResult, setLatestResult] = useState<InferenceResult | null>(null);
  const [historyList, setHistoryList] = useState<Array<{ id: string; label: string; per: number; exact: boolean; time: string }>>([]);

  // Fetch job metadata
  const fetchJob = useCallback(async () => {
    try {
      const resData = await apiClient.get<any>(`/api/jobs/sync?id=${resolvedParams.id}`);
      const jobData = resData.ok && resData.job ? resData.job : null;

      const data =
        jobData ||
        (
          await supabase
            .from("jobs")
            .select("*")
            .eq("id", resolvedParams.id)
            .single()
        ).data;

      if (data) setJob(data);
    } catch (err) {
      console.error("Failed to load job:", err);
    } finally {
      setLoadingJob(false);
    }
  }, [resolvedParams.id, supabase]);

  useEffect(() => {
    fetchJob();
  }, [fetchJob]);

  // Handle Benchmark Card Selection
  const handleSelectBenchmark = (bench: BenchmarkItem) => {
    setSelectedBenchmarkId(bench.id);
    setAudioUrl(bench.audioUrl);
    setAudioBase64("");
    setAudioBlobUrl("");
    setExpectedPhonemes(bench.qpsSequence);
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      setIsPlayingPreview(false);
    }
  };

  // Handle File Upload
  const handleFileUpload = (file: File) => {
    if (!file) return;
    const blobUrl = URL.createObjectURL(file);
    setAudioBlobUrl(blobUrl);
    setAudioUrl("");
    setSelectedBenchmarkId("");

    const reader = new FileReader();
    reader.onload = (e) => {
      const b64 = e.target?.result as string;
      setAudioBase64(b64);
    };
    reader.readAsDataURL(file);
  };

  // Start Mic Recording
  const startRecording = async () => {
    try {
      setInferError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      // Web Audio API for animated volume bars
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 32;
      source.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);

      const updateLevels = () => {
        analyser.getByteFrequencyData(dataArray);
        const bars: number[] = [];
        for (let i = 0; i < 7; i++) {
          const val = Math.max(6, Math.round((dataArray[i * 2] / 255) * 32));
          bars.push(val);
        }
        setAudioLevels(bars);
        animFrameRef.current = requestAnimationFrame(updateLevels);
      };
      updateLevels();

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
        stream.getTracks().forEach((track) => track.stop());

        const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        const blobUrl = URL.createObjectURL(blob);
        setAudioBlobUrl(blobUrl);
        setAudioUrl("");
        setSelectedBenchmarkId("");

        const reader = new FileReader();
        reader.onload = (e) => {
          const b64 = e.target?.result as string;
          setAudioBase64(b64);
        };
        reader.readAsDataURL(blob);
      };

      mediaRecorder.start(250);
      setIsRecording(true);
      setRecordSeconds(0);

      timerIntervalRef.current = setInterval(() => {
        setRecordSeconds((s) => s + 1);
      }, 1000);
    } catch (err: any) {
      console.error("Mic access denied or error:", err);
      setInferError("Microphone access failed: " + (err.message || "Permission denied"));
    }
  };

  // Stop Mic Recording
  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      if (timerIntervalRef.current) {
        clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    }
  };

  // Preview Playback toggle
  const togglePreviewPlayback = () => {
    const activeSrc = audioBlobUrl || audioUrl;
    if (!activeSrc) return;

    if (!previewAudioRef.current) {
      const audio = new Audio(activeSrc);
      previewAudioRef.current = audio;
      audio.onended = () => setIsPlayingPreview(false);
      audio.play();
      setIsPlayingPreview(true);
    } else {
      if (isPlayingPreview) {
        previewAudioRef.current.pause();
        setIsPlayingPreview(false);
      } else {
        if (previewAudioRef.current.src !== activeSrc) {
          previewAudioRef.current.src = activeSrc;
        }
        previewAudioRef.current.play();
        setIsPlayingPreview(true);
      }
    }
  };

  // Execute Model Test / Inference
  const handleRunInference = async () => {
    setInferError(null);
    if (!audioUrl && !audioBase64) {
      setInferError("Please record microphone audio, upload an audio file, or select a Quranic benchmark.");
      return;
    }

    setIsInferring(true);
    try {
      const payload: any = {
        audio_url: audioUrl || undefined,
        audio_base64: audioBase64 || undefined,
        expected_phonemes: expectedPhonemes.trim() ? expectedPhonemes.trim() : undefined,
      };

      const res = await fetch(`/api/jobs/${resolvedParams.id}/infer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || "Inference failed on Modal GPU");
      }

      const result: InferenceResult = json.data;
      setLatestResult(result);

      // Add to session history
      const bench = BENCHMARKS.find((b) => b.id === selectedBenchmarkId);
      const label = bench
        ? bench.verseName
        : activeTab === "mic"
        ? `Mic Recording (${recordSeconds}s)`
        : "Uploaded Clip";

      setHistoryList((prev) => [
        {
          id: String(Date.now()),
          label,
          per: result.evaluation?.per !== undefined ? result.evaluation.per : 0,
          exact: result.evaluation?.exact_match || false,
          time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        },
        ...prev.slice(0, 9),
      ]);
    } catch (err: any) {
      console.error("Inference execution error:", err);
      setInferError(err.message || "Failed to execute model inference");
    } finally {
      setIsInferring(false);
    }
  };

  if (loadingJob) {
    return (
      <div className="page-content" style={{ textAlign: "center", padding: "100px 0" }}>
        <div className="spinner" style={{ margin: "0 auto 16px" }} />
        <p style={{ color: "var(--text-muted)" }}>Loading Model Playground...</p>
      </div>
    );
  }

  const activeAudioSource = audioBlobUrl || audioUrl;

  return (
    <div className={styles.playgroundLayout}>
      {/* ── LEFT COLUMN: TESTING INSTRUCTIONS & GUIDELINES ── */}
      <aside className={styles.instructionPanel}>
        <div className={styles.panelHeader}>
          <span className={styles.panelTitle}>
            <HelpCircle size={17} style={{ color: "var(--accent-primary)" }} />
            How to Test Your Model
          </span>
          <span className="badge badge-default" style={{ fontSize: "0.68rem" }}>
            v2.4 CTC
          </span>
        </div>

        {/* Step 1 */}
        <div className={styles.stepCard}>
          <div className={styles.stepHeader}>
            <div className={styles.stepBadge}>1</div>
            <div className={styles.stepTitle}>Select Audio Input</div>
          </div>
          <div className={styles.stepBody}>
            Choose between <strong>Live Microphone</strong>, <strong>Audio Upload</strong>, or use our
            pre-indexed <strong>Quranic Benchmarks</strong> (Abdul Basit) for instant 1-click verification.
          </div>
        </div>

        {/* Step 2 */}
        <div className={styles.stepCard}>
          <div className={styles.stepHeader}>
            <div className={styles.stepBadge}>2</div>
            <div className={styles.stepTitle}>Acoustic Quality Guidelines</div>
          </div>
          <div className={styles.stepBody}>
            • Keep clips between <strong>1.0s and 8.0s</strong> (single ayah or word).
            <br />• Recite with standard Tajweed pronunciation (madd, ghunnah).
            <br />• Keep background noise low for maximum acoustic clarity.
          </div>
        </div>

        {/* Step 3 */}
        <div className={styles.stepCard}>
          <div className={styles.stepHeader}>
            <div className={styles.stepBadge}>3</div>
            <div className={styles.stepTitle}>Phoneme Sequence Target</div>
          </div>
          <div className={styles.stepBody}>
            Enter the target phonemes (e.g. <code>a l i f l aa m m ii m</code>) to calculate real-time{" "}
            <strong>PER (Phoneme Error Rate)</strong> and view token-by-token alignment diffs.
          </div>
        </div>

        {/* Step 4 */}
        <div className={styles.stepCard}>
          <div className={styles.stepHeader}>
            <div className={styles.stepBadge}>4</div>
            <div className={styles.stepTitle}>Greedy CTC Decoding</div>
          </div>
          <div className={styles.stepBody}>
            The fine-tuned Wav2Vec2 model outputs acoustic logits at 50Hz. CTC collapses consecutive repeated
            tokens and strips <code>&lt;pad&gt;</code> blanks to yield the final phonetic transcription.
          </div>
        </div>

        {/* Tajweed Cheat Sheet Tip */}
        <div className={styles.tipBox}>
          <div className={styles.tipTitle}>
            <Sparkles size={14} /> Phonetic Notation Key
          </div>
          <div>
            • <code>aa, ii, uu</code>: Long vowels (Madd Tabee&apos;i)
            <br />• <code>T, D, S, H, E</code>: Emphatic/Pharyngeal consonants (ط, ض, ص, ح, ع)
            <br />• <code>q</code>: Emphatic Qaf (ق)
          </div>
        </div>

        {/* Session Test History */}
        {historyList.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
            <span style={{ fontSize: "0.78rem", fontWeight: 700, color: "var(--text-secondary)", display: "flex", alignItems: "center", gap: 6 }}>
              <History size={14} /> Session History
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {historyList.map((item) => (
                <div
                  key={item.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "6px 10px",
                    background: "var(--bg-elevated)",
                    borderRadius: "var(--radius-sm)",
                    fontSize: "0.75rem",
                    border: "1px solid var(--border)",
                  }}
                >
                  <span style={{ color: "var(--text-primary)", fontWeight: 500 }}>{item.label}</span>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span
                      style={{
                        color: item.exact ? "#10b981" : item.per < 0.2 ? "#f59e0b" : "#ef4444",
                        fontFamily: "var(--font-mono)",
                        fontWeight: 700,
                      }}
                    >
                      {item.exact ? "100% MATCH" : `${(item.per * 100).toFixed(1)}% PER`}
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: "0.68rem" }}>{item.time}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>

      {/* ── RIGHT COLUMN: INTERACTIVE TEST ARENA ── */}
      <main className={styles.testArena}>
        {/* Model Meta Header */}
        <div className={styles.modelHeader}>
          <div className={styles.modelInfo}>
            <div className={styles.modelName}>
              <span>{job?.name || "Fine-Tuned CTC Model"}</span>
              <span className="badge badge-success" style={{ gap: 4 }}>
                <Check size={12} /> Active Checkpoint
              </span>
            </div>
            <div className={styles.modelMeta}>
              <span className={styles.metaItem}>
                <Cpu size={12} /> {job?.base_model || "facebook/wav2vec2-base"}
              </span>
              <span>·</span>
              <span className={styles.metaItem}>
                Job <span className="font-mono">#{resolvedParams.id.substring(0, 8)}</span>
              </span>
              <span>·</span>
              <span className={styles.metaItem}>Greedy CTC Decoder</span>
            </div>
          </div>

          <div style={{ display: "flex", gap: 8 }}>
            <Link href={`/jobs/${resolvedParams.id}`} className="btn btn-secondary btn-sm" style={{ gap: 6 }}>
              <ArrowRight size={14} style={{ transform: "rotate(180deg)" }} /> Back to Job Details
            </Link>
          </div>
        </div>

        {/* Audio Input Card */}
        <div className={styles.inputCard}>
          {/* Mode Switcher Tabs */}
          <div className={styles.tabRow}>
            <button
              className={`${styles.tabBtn} ${activeTab === "benchmark" ? styles.tabBtnActive : ""}`}
              onClick={() => setActiveTab("benchmark")}
            >
              <Sparkles size={14} /> 1-Click Quranic Benchmarks
            </button>
            <button
              className={`${styles.tabBtn} ${activeTab === "mic" ? styles.tabBtnActive : ""}`}
              onClick={() => setActiveTab("mic")}
            >
              <Mic size={14} /> Microphone Recording
            </button>
            <button
              className={`${styles.tabBtn} ${activeTab === "upload" ? styles.tabBtnActive : ""}`}
              onClick={() => setActiveTab("upload")}
            >
              <UploadCloud size={14} /> Audio File Upload
            </button>
          </div>

          {/* TAB 1: BENCHMARK PRESETS */}
          {activeTab === "benchmark" && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <span style={{ fontSize: "0.8rem", color: "var(--text-secondary)" }}>
                Select a reference Quranic clip recorded by Qari Abdul Basit to benchmark speech recognition:
              </span>
              <div className={styles.benchmarkGrid}>
                {BENCHMARKS.map((bench) => {
                  const isSelected = selectedBenchmarkId === bench.id;
                  return (
                    <div
                      key={bench.id}
                      className={`${styles.benchmarkCard} ${isSelected ? styles.benchmarkCardSelected : ""}`}
                      onClick={() => handleSelectBenchmark(bench)}
                    >
                      <div className={styles.benchmarkCardHead}>
                        <span className={styles.benchmarkTitle}>{bench.verseName}</span>
                        <span className={styles.benchmarkVerseBadge}>
                          {bench.surah}:{bench.ayah}
                        </span>
                      </div>
                      <div className={styles.benchmarkArabic}>{bench.arabic}</div>
                      <div className={styles.benchmarkPhonemes}>{bench.qpsSequence}</div>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingTop: 4 }}>
                        <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>{bench.reciter}</span>
                        {isSelected && (
                          <span style={{ fontSize: "0.72rem", color: "var(--accent-primary)", fontWeight: 700 }}>
                            Selected ✓
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: MICROPHONE RECORDER */}
          {activeTab === "mic" && (
            <div className={styles.micContainer}>
              {!isRecording ? (
                <>
                  <button
                    className={styles.micButton}
                    onClick={startRecording}
                    title="Click to start recording"
                  >
                    <Mic size={30} />
                  </button>
                  <span style={{ fontSize: "0.85rem", color: "var(--text-secondary)", fontWeight: 600 }}>
                    Click microphone to start recording your recitation
                  </span>
                  <span style={{ fontSize: "0.74rem", color: "var(--text-muted)" }}>
                    Speak clearly at normal tempo (1 to 8 seconds)
                  </span>
                </>
              ) : (
                <>
                  <button
                    className={`${styles.micButton} ${styles.micButtonRecording}`}
                    onClick={stopRecording}
                    title="Click to stop recording"
                  >
                    <Square size={24} />
                  </button>
                  <div className={styles.timerText}>
                    00:{recordSeconds < 10 ? `0${recordSeconds}` : recordSeconds}
                  </div>
                  <div className={styles.visualizerBarContainer}>
                    {audioLevels.map((lvl, i) => (
                      <div
                        key={i}
                        className={styles.visualizerBar}
                        style={{ height: `${lvl}px` }}
                      />
                    ))}
                  </div>
                  <span style={{ fontSize: "0.78rem", color: "#ef4444", fontWeight: 600 }}>
                    Recording in progress... Click the red button to finish
                  </span>
                </>
              )}
            </div>
          )}

          {/* TAB 3: FILE UPLOAD */}
          {activeTab === "upload" && (
            <label className={styles.uploadDropzone}>
              <input
                type="file"
                accept="audio/*,.wav,.mp3,.m4a,.webm"
                style={{ display: "none" }}
                onChange={(e) => {
                  if (e.target.files?.[0]) handleFileUpload(e.target.files[0]);
                }}
              />
              <FileAudio size={36} style={{ color: "var(--accent-primary)" }} />
              <div>
                <span style={{ fontSize: "0.85rem", fontWeight: 600, color: "var(--text-primary)" }}>
                  Drop an audio recording here, or browse files
                </span>
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 4 }}>
                  Supports WAV, MP3, M4A, OGG, or WEBM (16kHz recommended)
                </p>
              </div>
            </label>
          )}

          {/* Audio Preview Strip (if audio is loaded/selected) */}
          {activeAudioSource && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "10px 14px",
                background: "var(--bg-elevated)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={togglePreviewPlayback}
                  style={{
                    width: 32,
                    height: 32,
                    padding: 0,
                    borderRadius: "50%",
                    background: "rgba(0, 229, 200, 0.15)",
                    color: "var(--accent-primary)",
                  }}
                >
                  {isPlayingPreview ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: 2 }} />}
                </button>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: "0.8rem", fontWeight: 600, color: "var(--text-primary)" }}>
                    {selectedBenchmarkId
                      ? BENCHMARKS.find((b) => b.id === selectedBenchmarkId)?.verseName
                      : activeTab === "mic"
                      ? "Microphone Recording"
                      : "Uploaded Audio"}
                  </span>
                  <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                    Ready for ASR acoustic model inference
                  </span>
                </div>
              </div>

              {activeTab === "mic" && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setAudioBlobUrl("");
                    setAudioBase64("");
                  }}
                  style={{ gap: 4, fontSize: "0.75rem" }}
                >
                  <RotateCcw size={13} /> Re-record
                </button>
              )}
            </div>
          )}

          {/* Expected Phonemes Setup Strip */}
          <div className={styles.setupSection}>
            <div className={styles.sectionLabel}>
              <span>Expected Phonemes (Optional for real-time PER scoring):</span>
              <span style={{ fontSize: "0.72rem", color: "var(--text-muted)" }}>
                Space-separated (e.g. <code>a l i f l aa m m ii m</code>)
              </span>
            </div>
            <input
              type="text"
              className={styles.phonemeInput}
              value={expectedPhonemes}
              onChange={(e) => setExpectedPhonemes(e.target.value)}
              placeholder="e.g. a l i f l aa m m ii m"
            />
          </div>

          {/* Error Banner */}
          {inferError && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 14px",
                background: "rgba(239, 68, 68, 0.1)",
                border: "1px solid rgba(239, 68, 68, 0.3)",
                borderRadius: "var(--radius-md)",
                color: "#ef4444",
                fontSize: "0.8rem",
              }}
            >
              <AlertTriangle size={16} style={{ flexShrink: 0 }} />
              <span>{inferError}</span>
            </div>
          )}

          {/* Action Row */}
          <div className={styles.actionRow}>
            <div className={styles.gpuTag}>
              <Cpu size={14} style={{ color: "var(--accent-primary)" }} />
              <span>Modal Cloud A10G · ~200ms inference</span>
            </div>

            <button
              className="btn btn-primary"
              disabled={isInferring || (!audioUrl && !audioBase64)}
              onClick={handleRunInference}
              style={{
                gap: 8,
                padding: "10px 24px",
                fontSize: "0.88rem",
                boxShadow: "0 0 20px rgba(0, 229, 200, 0.25)",
              }}
            >
              {isInferring ? (
                <>
                  <div className="spinner" style={{ width: 15, height: 15 }} />
                  <span>Decoding Acoustic Features...</span>
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  <span>Run Model Test</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* ── RESULTS CARD (APPEARS AFTER INFERENCE) ── */}
        {latestResult && (
          <div className={styles.resultsCard}>
            <div className={styles.resultsHead}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <h3 style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text-primary)" }}>
                  Acoustic Inference Output
                </h3>
                {latestResult.evaluation?.exact_match ? (
                  <span className="badge badge-success" style={{ gap: 4, fontWeight: 700 }}>
                    <CheckCircle2 size={13} /> 100% EXACT MATCH
                  </span>
                ) : latestResult.evaluation && latestResult.evaluation.per <= 0.2 ? (
                  <span className="badge badge-warning" style={{ gap: 4, fontWeight: 700 }}>
                    HIGH ACCURACY ({(latestResult.evaluation.per * 100).toFixed(1)}% PER)
                  </span>
                ) : (
                  <span className="badge badge-default" style={{ gap: 4 }}>
                    DECODED {latestResult.token_count} PHONEMES
                  </span>
                )}
              </div>

              <span style={{ fontSize: "0.78rem", color: "var(--text-muted)", fontFamily: "var(--font-mono)" }}>
                Audio Duration: {latestResult.duration_seconds}s
              </span>
            </div>

            {/* Metrics summary tiles */}
            {latestResult.evaluation && (
              <div className={styles.resultsMetricsGrid}>
                <div className={styles.metricTile}>
                  <div
                    className={styles.metricValue}
                    style={{
                      color:
                        latestResult.evaluation.per === 0
                          ? "#10b981"
                          : latestResult.evaluation.per < 0.2
                          ? "#f59e0b"
                          : "#ef4444",
                    }}
                  >
                    {(latestResult.evaluation.per * 100).toFixed(1)}%
                  </div>
                  <div className={styles.metricLabel}>Phoneme Error Rate (PER)</div>
                </div>

                <div className={styles.metricTile}>
                  <div
                    className={styles.metricValue}
                    style={{ color: latestResult.evaluation.exact_match ? "#10b981" : "#f59e0b" }}
                  >
                    {latestResult.evaluation.exact_match ? "YES" : "NO"}
                  </div>
                  <div className={styles.metricLabel}>Exact Match</div>
                </div>

                <div className={styles.metricTile}>
                  <div
                    className={styles.metricValue}
                    style={{ color: latestResult.evaluation.count_match ? "#10b981" : "#ef4444" }}
                  >
                    {latestResult.token_count} / {latestResult.evaluation.expected_phonemes.length}
                  </div>
                  <div className={styles.metricLabel}>Phoneme Count</div>
                </div>

                <div className={styles.metricTile}>
                  <div className={styles.metricValue} style={{ color: "var(--accent-primary)" }}>
                    {(latestResult.evaluation.cer * 100).toFixed(1)}%
                  </div>
                  <div className={styles.metricLabel}>Character Error Rate</div>
                </div>
              </div>
            )}

            {/* Decoded Phoneme Stream */}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                Decoded Phonetic Sequence:
              </span>
              <div className={styles.phonemeChipRow}>
                {latestResult.phonemes.map((ph, idx) => (
                  <span key={idx} className={styles.phonemeChip}>
                    {ph}
                  </span>
                ))}
              </div>
            </div>

            {/* Phonetic Alignment Comparison Diff */}
            {latestResult.evaluation?.alignment && (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <span style={{ fontSize: "0.8rem", fontWeight: 700, color: "var(--text-secondary)" }}>
                  Phonetic Alignment Diff (Expected vs Decoded):
                </span>
                <div style={{ overflowX: "auto" }}>
                  <table className={styles.diffTable}>
                    <thead>
                      <tr>
                        <th>Index</th>
                        <th>Reference Phoneme</th>
                        <th>Model Prediction</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {latestResult.evaluation.alignment.map((item, i) => (
                        <tr key={i}>
                          <td style={{ color: "var(--text-muted)" }}>#{i + 1}</td>
                          <td>
                            <strong>{item.expected || "—"}</strong>
                          </td>
                          <td>
                            <strong>{item.predicted || "—"}</strong>
                          </td>
                          <td>
                            {item.status === "match" ? (
                              <span className={styles.statusMatch}>MATCH</span>
                            ) : item.status === "substitution" ? (
                              <span className={styles.statusSub}>SUBSTITUTION</span>
                            ) : item.status === "deletion" ? (
                              <span className={styles.statusDel}>DELETION</span>
                            ) : (
                              <span className={styles.statusIns}>INSERTION</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
