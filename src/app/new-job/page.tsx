"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import styles from "./page.module.css";
import { MODELS, getRecommendedModel, getRecommendationReason, ASRModelInfo, ASRModelCategory, ASR_MODEL_CATEGORIES } from "@/lib/models";
import { apiClient } from "@/lib/apiClient";
import { ASRWizardContext, EMPTY_ASR_WIZARD_CONTEXT, SCOPE_PRESETS, TajweedScope, validateASRWizardContext } from "@/lib/asr-wizard-types";
import { MAX_TRAINING_CLIPS, MAX_UPLOAD_DURATION_MS, MAX_UPLOAD_SIZE_BYTES, SUPPORTED_AUDIO_EXTENSIONS, isSupportedAudioFormat, CostEstimate } from "@/lib/training-config";
import PipelineProgressOverlay, { PipelineEvent } from "@/components/PipelineProgressOverlay";
import WaveformCorrector from "@/components/WaveformCorrector";
import type { ASRDatasetPair, PhonemeLabel } from "@/lib/qps-types";

type Step = 1 | 2 | 3 | 4 | 5;

const STEP_LABELS = [
  "Audio Upload",
  "Scope & Level",
  "Training Config",
  "Review & Correct",
  "Launch",
];

export default function NewJobPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>(1);

  // ── Step 1: Audio Upload / Dataset ──
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>("");
  const [datasetItems, setDatasetItems] = useState<any[] | null>(null);
  const [datasetName, setDatasetName] = useState<string>("");
  const fileRef = useRef<HTMLInputElement>(null);
  
  // ── Step 2: Scope & Level ──
  const [wizardCtx, setWizardCtx] = useState<ASRWizardContext>(EMPTY_ASR_WIZARD_CONTEXT);
  const [selectedPresetIndex, setSelectedPresetIndex] = useState<number | null>(null);

  // ── Step 3: Training Config ──
  const [selectedModelId, setSelectedModelId] = useState<string>(MODELS[0].id);
  const [selectedCategory, setSelectedCategory] = useState<ASRModelCategory | "all">("all");
  
  // ── Step 4: Review & Correct ──
  const [previewPairs, setPreviewPairs] = useState<ASRDatasetPair[]>([]);
  const [activePreviewIndex, setActivePreviewIndex] = useState<number>(0);
  
  // ── Step 5: Launch ──
  const [jobName, setJobName] = useState("");
  const [costEstimate, setCostEstimate] = useState<CostEstimate | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchedJobId, setLaunchedJobId] = useState<string | null>(null);

  // ── Pipeline Progress Overlay ──
  const [showPipelineOverlay, setShowPipelineOverlay] = useState(false);
  const [pipelineEvent, setPipelineEvent] = useState<PipelineEvent | null>(null);
  
  const [error, setError] = useState<string | null>(null);

  const selectedModel = MODELS.find((m) => m.id === selectedModelId) || MODELS[0];
  const recommendedModel = getRecommendedModel({
    needsRealtime: wizardCtx.optimizeForRealtime,
  });

  // Handle Retrain
  useEffect(() => {
    const retrainId = searchParams.get("retrain");
    if (retrainId) {
      console.log("Retraining job", retrainId);
    }
  }, [searchParams]);

  // ────────────────────────────────────────────────────────
  // UI Handlers
  // ────────────────────────────────────────────────────────

  const handleLoadBenchmarkDataset = async (type: "test3" | "test4" = "test4") => {
    try {
      setError(null);
      const filename = type === "test4" ? "test4_sequence_generalization.jsonl" : "test3_quran_dataset.jsonl";
      const res = await fetch(`/data/${filename}`);
      if (!res.ok) throw new Error("Could not fetch benchmark dataset");
      const text = await res.text();
      const lines = text.trim().split("\n").filter(Boolean);
      const items = lines.map(l => JSON.parse(l));
      setDatasetItems(items);
      setDatasetName(filename);
      setAudioUrl(filename);
      setJobName(type === "test4" ? "Quran CTC Sequence Generalization" : "Quran CTC E2E Verification");
      
      setSelectedPresetIndex(0);
      setWizardCtx(prev => ({
        ...prev,
        targetScope: { ...EMPTY_ASR_WIZARD_CONTEXT.targetScope, lessons: [1, 2, 3] },
        recitationStyle: "correct_reference",
      }));
    } catch (e: any) {
      setError(e.message || "Failed to load benchmark dataset");
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      const isJsonl = file.name.endsWith(".jsonl") || file.name.endsWith(".json");
      
      if (!isSupportedAudioFormat(file.name) && !isJsonl) {
        setError(`Unsupported format. Use WAV, MP3, FLAC, M4A, OGG, or JSONL.`);
        return;
      }
      if (file.size > MAX_UPLOAD_SIZE_BYTES) {
        setError(`File is too large (max ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)} MB)`);
        return;
      }

      if (isJsonl) {
        try {
          const text = await file.text();
          const lines = text.trim().split("\n").filter(Boolean);
          const items = lines.map(l => JSON.parse(l));
          setDatasetItems(items);
          setDatasetName(file.name);
          setAudioUrl(file.name);
        } catch (err: any) {
          setError(`Failed to parse JSONL file: ${err.message}`);
          return;
        }
      } else {
        setAudioFile(file);
      }
      setError(null);
    }
  };

  const nextStep = () => {
    setError(null);
    
    if (step === 1) {
      if (!audioFile && !audioUrl && (!datasetItems || datasetItems.length === 0)) {
        setError("Please upload an audio/dataset file or load the benchmark dataset");
        return;
      }
      setStep(2);
    } else if (step === 2) {
      const warnings = validateASRWizardContext(wizardCtx);
      if (warnings.length > 0) {
        setError(warnings[0].reason);
        return;
      }
      
      const rec = getRecommendedModel({ needsRealtime: wizardCtx.optimizeForRealtime });
      setSelectedModelId(rec.id);
      
      setStep(3);
    } else if (step === 3) {
      loadPreviewPairs();
      setStep(4);
    } else if (step === 4) {
      setStep(5);
    }
  };

  const loadPreviewPairs = async () => {
    try {
      if (datasetItems && datasetItems.length > 0) {
        const preview: ASRDatasetPair[] = datasetItems.slice(0, 5).map((item, idx) => {
          const phonemes: string[] = item.phonemes || (item.qpsSequence ? item.qpsSequence.split(" ") : []);
          const totalDuration = 3000;
          const phonemeDuration = phonemes.length > 0 ? totalDuration / phonemes.length : 500;
          
          const labels: PhonemeLabel[] = phonemes.map((p, pIdx) => ({
            phoneme: p,
            startMs: Math.round(pIdx * phonemeDuration),
            endMs: Math.round((pIdx + 1) * phonemeDuration),
            confidence: 0.95,
            humanVerified: false,
          }));

          return {
            audioClipId: item.audioClipId || item.id || `clip_${idx}`,
            audioR2Key: item.audioR2Key || `preview_${idx}`,
            audioUrl: item.audioUrl || "https://everyayah.com/data/Alafasy_128kbps/002001.mp3",
            phonemeLabels: labels,
            qpsSequence: item.qpsSequence || phonemes.join(" "),
            isDeliberateError: false,
          };
        });
        setPreviewPairs(preview);
        return;
      }

      setPreviewPairs([
        {
          audioClipId: "clip_1",
          audioR2Key: "dummy_key",
          audioUrl: "https://everyayah.com/data/Alafasy_128kbps/002001.mp3",
          phonemeLabels: [
            { phoneme: "a", startMs: 0, endMs: 250, confidence: 0.95, humanVerified: false },
            { phoneme: "l", startMs: 250, endMs: 500, confidence: 0.95, humanVerified: false },
            { phoneme: "i", startMs: 500, endMs: 750, confidence: 0.90, humanVerified: false },
            { phoneme: "f", startMs: 750, endMs: 1000, confidence: 0.90, humanVerified: false },
            { phoneme: "l", startMs: 1000, endMs: 1300, confidence: 0.95, humanVerified: false },
            { phoneme: "aa", startMs: 1300, endMs: 1700, confidence: 0.95, humanVerified: false },
            { phoneme: "m", startMs: 1700, endMs: 2000, confidence: 0.95, humanVerified: false },
            { phoneme: "m", startMs: 2000, endMs: 2300, confidence: 0.95, humanVerified: false },
            { phoneme: "ii", startMs: 2300, endMs: 2700, confidence: 0.95, humanVerified: false },
            { phoneme: "m", startMs: 2700, endMs: 3000, confidence: 0.95, humanVerified: false },
          ],
          qpsSequence: "a l i f l aa m m ii m",
          isDeliberateError: false
        }
      ]);
    } catch (e: any) {
      setError(e.message);
    }
  };

  const handleLaunch = async () => {
    if (!jobName) {
      setError("Please enter a job name.");
      return;
    }

    try {
      setLaunching(true);
      setError(null);
      setShowPipelineOverlay(true);

      setPipelineEvent({
        type: "progress",
        stage: "segmenting",
        message: "Packaging and uploading dataset to Cloudflare R2...",
      });

      // 1. Prepare JSONL content
      let jsonlContent = "";
      if (datasetItems && datasetItems.length > 0) {
        jsonlContent = datasetItems.map(item => JSON.stringify(item)).join("\n");
      } else if (audioFile) {
        jsonlContent = JSON.stringify({
          audioClipId: "uploaded_0",
          audioUrl: "",
          phonemes: ["a", "l", "i", "f"],
          split: "train"
        });
      } else {
        throw new Error("No dataset items or audio file to launch");
      }

      // 2. Request presigned upload URL from R2
      const filename = `dataset_${Date.now()}.jsonl`;
      const uploadInit = await apiClient.post<any>("/api/upload", {
        filename,
        contentType: "application/x-ndjson",
      });

      if (!uploadInit?.uploadUrl || !uploadInit?.fileKey) {
        throw new Error(uploadInit?.error || "Failed to obtain upload URL for R2");
      }

      // 3. PUT the JSONL content directly to R2
      const blob = new Blob([jsonlContent], { type: "application/x-ndjson" });
      const putRes = await fetch(uploadInit.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/x-ndjson" },
        body: blob,
      });

      if (!putRes.ok) {
        throw new Error(`Cloudflare R2 upload failed: HTTP ${putRes.status}`);
      }

      // 4. Trigger training job via /api/jobs
      setPipelineEvent({
        type: "progress",
        stage: "validating",
        message: "Confirming credit hold & launching Modal GPU worker...",
      });

      const jobRes = await apiClient.post<any>("/api/jobs", {
        name: jobName,
        baseModel: selectedModelId,
        method: "ctc",
        datasetUrl: uploadInit.fileKey,
        datasetSize: datasetItems ? datasetItems.length : 10,
        config: {
          learningRate: 0.0001,
          epochs: 250,
          batchSize: 4,
          loraR: 16,
          maxSeqLength: 2048,
        },
      });

      if (!jobRes.ok || !jobRes.jobId) {
        throw new Error(jobRes.error || jobRes.message || "Failed to launch training job");
      }

      setPipelineEvent({
        type: "complete",
        message: "Job successfully launched on Modal GPU! Redirecting to live dashboard...",
      });

      setLaunchedJobId(jobRes.jobId);
    } catch (e: any) {
      console.error("Launch error:", e);
      setError(e.message || "Failed to launch job");
      setLaunching(false);
      setShowPipelineOverlay(false);
    }
  };

  return (
    <div className={styles.container}>
      {/* Sidebar / Stepper */}
      <div className={styles.sidebar}>
        <div className={styles.stepper}>
          {STEP_LABELS.map((label, idx) => {
            const num = idx + 1;
            let statusClass = styles.stepPending;
            if (step === num) statusClass = styles.stepActive;
            else if (step > num) statusClass = styles.stepCompleted;

            return (
              <div key={num} className={`${styles.stepItem} ${statusClass}`}>
                <div className={styles.stepCircle}>{num}</div>
                <div className={styles.stepLabel}>{label}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <div className={styles.main}>
        {error && (
          <div className="alert alert-error mb-16">
            {error}
          </div>
        )}

        {/* ── Step 1: Audio Upload ── */}
        {step === 1 && (
          <div className={styles.stepContent}>
            <h1 className={styles.stepTitle}>Upload Audio Data</h1>
            <p className={styles.stepDescription}>
              Upload recitation audio for your dataset, or load a pre-configured phonetic benchmark dataset to get started instantly.
            </p>
            
            {/* Benchmark Quick-Load Banner */}
            <div className={styles.benchmarkCard}>
              <div className={styles.benchmarkInfo}>
                <div className={styles.benchmarkTitle}>
                  <span>⚡</span>
                  <span>Test 3 Quranic Phonetic Benchmark (96 clips)</span>
                </div>
                <div className={styles.benchmarkDesc}>
                  80 train clips (5 reciters) + 16 held-out test clips (Saood ash-Shuraym) with verified Arabic phoneme labels.
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {datasetItems && datasetItems.length > 0 ? (
                  <span className={styles.benchmarkBadge}>
                    <span>✓</span>
                    <span>{datasetName} ({datasetItems.length} clips)</span>
                  </span>
                ) : (
                  <>
                    <button 
                      type="button" 
                      id="load-test4-benchmark-btn"
                      className={styles.benchmarkBtn}
                      onClick={() => handleLoadBenchmarkDataset("test4")}
                      title="Test 4: Disjoint phoneme sequences (novel unseen labels in eval)"
                    >
                      Load Test 4 (Sequence Split)
                    </button>
                    <button 
                      type="button" 
                      id="load-test3-benchmark-btn"
                      className={styles.btnSecondary}
                      onClick={() => handleLoadBenchmarkDataset("test3")}
                      title="Test 3: Cross-speaker generalization (unseen reciter)"
                      style={{ padding: "0.4rem 0.8rem", fontSize: "0.8rem" }}
                    >
                      Load Test 3 (Speaker Split)
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className={styles.uploadArea} onClick={() => fileRef.current?.click()}>
              <input 
                type="file" 
                ref={fileRef} 
                className="hidden" 
                accept={`${SUPPORTED_AUDIO_EXTENSIONS.join(",")},.jsonl,.json`} 
                onChange={handleFileChange}
              />
              <div className={styles.uploadIcon}>🎧</div>
              {audioFile ? (
                <div className={styles.uploadLoadedBadge}>✓ {audioFile.name}</div>
              ) : datasetItems ? (
                <div className={styles.uploadLoadedBadge}>✓ {datasetName} ({datasetItems.length} clips)</div>
              ) : (
                <>
                  <div className={styles.uploadPrompt}>Click to upload audio or dataset JSONL</div>
                  <div className={styles.uploadFormats}>Supported: WAV, MP3, FLAC, M4A, OGG, JSONL (Max 15 min / 15 MB)</div>
                </>
              )}
            </div>
            
            <div className={styles.navRow}>
              <div />
              <button 
                id="next-step-btn"
                className={styles.btnPrimary} 
                onClick={nextStep} 
                disabled={!audioFile && !audioUrl && (!datasetItems || datasetItems.length === 0)}
              >
                <span>Next: Scope & Level</span>
                <span>→</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Scope & Level ── */}
        {step === 2 && (
          <div className={styles.stepContent}>
            <h1 className={styles.stepTitle}>Scope & Level</h1>
            <p className={styles.stepDescription}>
              Define the curriculum scope and recitation target for this model fine-tuning run.
            </p>
            
            <div className="mb-6">
              <label className={styles.formLabel} style={{ marginBottom: 12, display: "block" }}>
                Noorani Qaida Curriculum Presets
              </label>
              <div className={styles.presetsGrid}>
                {SCOPE_PRESETS.map((preset, idx) => (
                  <div 
                    key={idx}
                    className={`${styles.presetCard} ${selectedPresetIndex === idx ? styles.presetCardActive : ''}`}
                    onClick={() => {
                      setSelectedPresetIndex(idx);
                      setWizardCtx(prev => ({
                        ...prev,
                        targetScope: { ...EMPTY_ASR_WIZARD_CONTEXT.targetScope, ...preset.scope }
                      }));
                    }}
                  >
                    <div className={styles.presetLabel}>{preset.label}</div>
                    <div className={styles.presetLabelAr}>{preset.labelAr}</div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Recitation Style</label>
                <select 
                  className={styles.formSelect}
                  value={wizardCtx.recitationStyle}
                  onChange={(e) => setWizardCtx(prev => ({ ...prev, recitationStyle: e.target.value as any }))}
                >
                  <option value="correct_reference">Correct Reference (Ideal Pronunciation)</option>
                  <option value="deliberate_error">Deliberate Error (Mispronunciations)</option>
                  <option value="mixed">Mixed (Reference + Errors)</option>
                </select>
              </div>
              
              <div className={styles.formGroup}>
                <label className={styles.formLabel}>Learner Level Focus</label>
                <select 
                  className={styles.formSelect}
                  value={wizardCtx.learnerLevel}
                  onChange={(e) => setWizardCtx(prev => ({ ...prev, learnerLevel: e.target.value as any }))}
                >
                  <option value="beginner">Beginner (Slow, clear articulation)</option>
                  <option value="intermediate">Intermediate (Standard murattal tempo)</option>
                  <option value="advanced">Advanced (Fast / hafiz revision)</option>
                </select>
              </div>
            </div>
            
            <div className={styles.navRow}>
              <button className={styles.btnDefault} onClick={() => setStep(1)}>← Back</button>
              <button className={styles.btnPrimary} onClick={nextStep}>
                <span>Next: Training Config</span>
                <span>→</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Training Config ── */}
        {step === 3 && (
          <div className={styles.stepContent}>
            <h1 className={styles.stepTitle}>Training Config</h1>
            <p className={styles.stepDescription}>
              Select the ASR base model architecture and fine-tuning hyperparameters.
            </p>
            
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="realtimeToggle"
                  checked={wizardCtx.optimizeForRealtime}
                  onChange={(e) => setWizardCtx(prev => ({ ...prev, optimizeForRealtime: e.target.checked }))}
                />
                <label htmlFor="realtimeToggle" className="font-medium text-sm text-gray-300">
                  Optimize for live feedback (real-time <span className="text-cyan-400">{'<200ms'}</span>)
                </label>
              </div>
              
              <select 
                className={styles.formSelect}
                style={{ width: "auto" }}
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value as any)}
              >
                {ASR_MODEL_CATEGORIES.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>
            
            <div className={styles.modelsList}>
              {MODELS.filter(m => selectedCategory === "all" || m.category === selectedCategory)
                .filter(m => !wizardCtx.optimizeForRealtime || m.realtimeCapable)
                .map((model) => (
                <div 
                  key={model.id}
                  className={`${styles.modelCard} ${selectedModelId === model.id ? styles.modelCardActive : ''}`}
                  onClick={() => setSelectedModelId(model.id)}
                >
                  {model.id === recommendedModel.id && (
                    <div className={styles.modelRecommendedPill}>Recommended</div>
                  )}
                  <div className={styles.modelCardHeader}>
                    <div className={styles.modelCardTitle}>{model.name}</div>
                  </div>
                  <div className={styles.modelCardMeta}>
                    <span>{model.size}</span>
                    <span>•</span>
                    <span>Vocab: {model.phonemeVocabType}</span>
                    <span>•</span>
                    <span>Latency: {model.speed}</span>
                  </div>
                  <div className={styles.modelCardStrengths}>{model.strengths.join(", ")}</div>
                </div>
              ))}
            </div>
            
            <div className={styles.navRow}>
              <button className={styles.btnDefault} onClick={() => setStep(2)}>← Back</button>
              <button className={styles.btnPrimary} onClick={nextStep}>
                <span>Next: Review & Correct</span>
                <span>→</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Step 4: Review & Correct ── */}
        {step === 4 && (
          <div className={styles.stepContent}>
            <h1 className={styles.stepTitle}>Review & Correct (Preview)</h1>
            <p className={styles.stepDescription}>
              Interactive phonetic inspection. Review alignment waveforms and fine-tune phoneme boundary labels.
            </p>
            
            {previewPairs.length > 0 ? (
              <div className="mb-8">
                <WaveformCorrector 
                  clipUrl={previewPairs[activePreviewIndex]?.audioUrl || "https://everyayah.com/data/Alafasy_128kbps/002001.mp3"} 
                  labels={previewPairs[activePreviewIndex]?.phonemeLabels || []}
                  onLabelsChange={(labels) => {
                    const newPairs = [...previewPairs];
                    newPairs[activePreviewIndex].phonemeLabels = labels;
                    setPreviewPairs(newPairs);
                  }}
                  onConfirm={() => {
                    if (activePreviewIndex < previewPairs.length - 1) setActivePreviewIndex(activePreviewIndex + 1);
                  }}
                  onReject={() => {
                    if (activePreviewIndex < previewPairs.length - 1) setActivePreviewIndex(activePreviewIndex + 1);
                  }}
                />
              </div>
            ) : (
              <div className="p-8 text-center text-gray-400 border border-dashed rounded-lg mb-8">
                Loading preview clips...
              </div>
            )}
            
            <div className={styles.navRow}>
              <button className={styles.btnDefault} onClick={() => setStep(3)}>← Back</button>
              <button className={styles.btnPrimary} onClick={nextStep}>
                <span>Next: Launch</span>
                <span>→</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Step 5: Launch ── */}
        {step === 5 && (
          <div className={styles.stepContent}>
            {launchedJobId ? (
              <div className={styles.successBox}>
                <div className={styles.successIcon}>🚀</div>
                <h1 className={styles.successTitle}>Job Launched!</h1>
                <p className={styles.successDesc}>Your ASR fine-tuning job is running on Modal NVIDIA A10G GPU cluster.</p>
                <Link href={`/jobs/${launchedJobId}`} className={styles.btnPrimary}>
                  View Job Progress →
                </Link>
              </div>
            ) : (
              <>
                <h1 className={styles.stepTitle}>Review & Launch</h1>
                <p className={styles.stepDescription}>
                  Name your fine-tuning run and confirm deployment to the GPU cluster.
                </p>
                
                <div className={styles.formGroup} style={{ marginBottom: 28 }}>
                  <label className={styles.formLabel}>Job Name</label>
                  <input 
                    type="text" 
                    className={styles.formInput}
                    placeholder="e.g., Quran CTC E2E Verification"
                    value={jobName}
                    onChange={(e) => setJobName(e.target.value)}
                  />
                </div>
                
                <div className={styles.summaryBox}>
                  <div className={styles.summaryTitle}>Run Configuration Summary</div>
                  <div className={styles.summaryGrid}>
                    <div>
                      <div className={styles.summaryItemLabel}>Base Model</div>
                      <div className={styles.summaryItemValue}>{selectedModel.name}</div>
                    </div>
                    <div>
                      <div className={styles.summaryItemLabel}>Dataset Size</div>
                      <div className={styles.summaryItemValue}>{datasetItems ? `${datasetItems.length} clips` : "Audio file"}</div>
                    </div>
                    <div>
                      <div className={styles.summaryItemLabel}>Target Scope</div>
                      <div className={styles.summaryItemValue}>
                        {wizardCtx.targetScope.lessons.length > 0 ? `Lessons ${wizardCtx.targetScope.lessons.join(", ")}` : "All Lessons"}
                      </div>
                    </div>
                    <div>
                      <div className={styles.summaryItemLabel}>GPU Allocation</div>
                      <div className={styles.summaryItemValue} style={{ color: "#00e5c8" }}>NVIDIA A10G (24GB VRAM)</div>
                    </div>
                  </div>
                </div>
                
                <div className={styles.navRow}>
                  <button className={styles.btnDefault} onClick={() => setStep(4)} disabled={launching}>← Back</button>
                  <button className={styles.btnPrimary} onClick={handleLaunch} disabled={launching}>
                    {launching ? (
                      <>
                        <span className="animate-spin" style={{ width: 16, height: 16, border: "2px solid rgba(0,0,0,0.2)", borderTopColor: "#000", borderRadius: "50%", display: "inline-block" }} />
                        <span>Launching...</span>
                      </>
                    ) : (
                      <>
                        <span>🚀 Start Training</span>
                      </>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {showPipelineOverlay && (
        <PipelineProgressOverlay 
          event={pipelineEvent} 
          onClose={() => setShowPipelineOverlay(false)} 
        />
      )}
    </div>
  );
}
