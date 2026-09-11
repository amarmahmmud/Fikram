"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import styles from "./page.module.css";
import { MODELS, getRecommendedModel, getRecommendationReason, ASRModelInfo, ASRModelCategory, ASR_MODEL_CATEGORIES } from "@/lib/models";
import { apiClient } from "@/lib/apiClient";
import { ASRWizardContext, EMPTY_ASR_WIZARD_CONTEXT, SCOPE_PRESETS, TajweedScope, validateASRWizardContext } from "@/lib/asr-wizard-types";
import { MAX_TRAINING_CLIPS, MAX_UPLOAD_DURATION_MS, MAX_UPLOAD_SIZE_BYTES, isSupportedAudioFormat, CostEstimate } from "@/lib/training-config";
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

  // ── Step 1: Audio Upload ──
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string>("");
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
      // TODO: Fetch existing job config
      console.log("Retraining job", retrainId);
    }
  }, [searchParams]);


  // ────────────────────────────────────────────────────────
  // UI Handlers
  // ────────────────────────────────────────────────────────

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const file = e.target.files[0];
      if (!isSupportedAudioFormat(file.name)) {
        setError(`Unsupported audio format. Use WAV, MP3, FLAC, M4A, OGG.`);
        return;
      }
      if (file.size > MAX_UPLOAD_SIZE_BYTES) {
        setError(`File is too large (max ${MAX_UPLOAD_SIZE_BYTES / (1024 * 1024)} MB)`);
        return;
      }
      setAudioFile(file);
      setError(null);
    }
  };

  const nextStep = () => {
    setError(null);
    
    if (step === 1) {
      if (!audioFile && !audioUrl) {
        setError("Please upload an audio file or provide a URL");
        return;
      }
      setStep(2);
    } else if (step === 2) {
      const warnings = validateASRWizardContext(wizardCtx);
      if (warnings.length > 0) {
        setError(warnings[0].reason);
        return;
      }
      
      // Auto-select recommended model based on context
      const rec = getRecommendedModel({ needsRealtime: wizardCtx.optimizeForRealtime });
      setSelectedModelId(rec.id);
      
      setStep(3);
    } else if (step === 3) {
      // Transition to Review & Correct
      loadPreviewPairs();
      setStep(4);
    } else if (step === 4) {
      setStep(5);
    }
  };

  const loadPreviewPairs = async () => {
    try {
      // In a real app, this would upload the file and start bootstrap-transcription
      // for the first few clips to show in the preview.
      // For now, we mock some preview data.
      setPreviewPairs([
        {
          audioClipId: "clip_1",
          audioR2Key: "dummy_key",
          phonemeLabels: [
            { phoneme: "a", startMs: 0, endMs: 500, confidence: 0.9, humanVerified: false },
            { phoneme: "b", startMs: 500, endMs: 800, confidence: 0.5, humanVerified: false },
          ],
          qpsSequence: "a b",
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

      // In the real system, this would upload the full audio file to R2,
      // and kick off the SSE dataset generation pipeline.
      setShowPipelineOverlay(true);
      
      setPipelineEvent({
        type: "progress",
        stage: "segmenting",
        message: "Starting dataset generation...",
      });
      
      // Simulate pipeline
      setTimeout(() => {
        setPipelineEvent({ type: "progress", stage: "transcribing", message: "Transcribing clips..." });
      }, 2000);
      
      setTimeout(() => {
        setPipelineEvent({ type: "complete" });
        setLaunchedJobId("job_" + Date.now());
      }, 5000);
      
    } catch (e: any) {
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
              Upload recitation audio for your dataset. We'll automatically split it into clips and process it.
            </p>
            
            <div className={styles.uploadArea} onClick={() => fileRef.current?.click()}>
              <input 
                type="file" 
                ref={fileRef} 
                className="hidden" 
                accept={SUPPORTED_AUDIO_EXTENSIONS.join(",")} 
                onChange={handleFileChange}
              />
              <div className="text-center">
                {audioFile ? (
                  <div className="text-xl font-medium">{audioFile.name}</div>
                ) : (
                  <>
                    <div className="text-2xl mb-4">🎵</div>
                    <div className="font-medium">Click to upload or drag & drop</div>
                    <div className="text-sm text-gray-400 mt-2">WAV, MP3, FLAC (Max 15 min)</div>
                  </>
                )}
              </div>
            </div>
            
            <div className="mt-8 flex justify-end">
              <button className="btn btn-primary" onClick={nextStep} disabled={!audioFile && !audioUrl}>
                Next: Scope & Level
              </button>
            </div>
          </div>
        )}

        {/* ── Step 2: Scope & Level ── */}
        {step === 2 && (
          <div className={styles.stepContent}>
            <h1 className={styles.stepTitle}>Scope & Level</h1>
            <p className={styles.stepDescription}>
              Define what this training job targets.
            </p>
            
            <div className="form-group mb-8">
              <label className="font-medium block mb-4">Noorani Qaida Presets</label>
              <div className="grid grid-cols-2 gap-4">
                {SCOPE_PRESETS.map((preset, idx) => (
                  <div 
                    key={idx}
                    className={`p-4 border rounded cursor-pointer ${selectedPresetIndex === idx ? 'border-primary bg-primary/10' : 'border-border'}`}
                    onClick={() => {
                      setSelectedPresetIndex(idx);
                      setWizardCtx(prev => ({
                        ...prev,
                        targetScope: { ...EMPTY_ASR_WIZARD_CONTEXT.targetScope, ...preset.scope }
                      }));
                    }}
                  >
                    <div className="font-medium">{preset.label}</div>
                    <div className="text-sm text-gray-400 font-arabic" dir="rtl">{preset.labelAr}</div>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-8 mb-8">
              <div className="form-group">
                <label className="font-medium block mb-2">Recitation Style</label>
                <select 
                  className="input w-full"
                  value={wizardCtx.recitationStyle}
                  onChange={(e) => setWizardCtx(prev => ({ ...prev, recitationStyle: e.target.value as any }))}
                >
                  <option value="correct_reference">Correct Reference (Ideal)</option>
                  <option value="deliberate_error">Deliberate Error (Mispronunciation)</option>
                  <option value="mixed">Mixed</option>
                </select>
              </div>
              
              <div className="form-group">
                <label className="font-medium block mb-2">Learner Level Focus</label>
                <select 
                  className="input w-full"
                  value={wizardCtx.learnerLevel}
                  onChange={(e) => setWizardCtx(prev => ({ ...prev, learnerLevel: e.target.value as any }))}
                >
                  <option value="beginner">Beginner</option>
                  <option value="intermediate">Intermediate</option>
                  <option value="advanced">Advanced</option>
                </select>
              </div>
            </div>
            
            <div className="mt-8 flex justify-between">
              <button className="btn btn-default" onClick={() => setStep(1)}>Back</button>
              <button className="btn btn-primary" onClick={nextStep}>Next: Training Config</button>
            </div>
          </div>
        )}

        {/* ── Step 3: Training Config ── */}
        {step === 3 && (
          <div className={styles.stepContent}>
            <h1 className={styles.stepTitle}>Training Config</h1>
            <p className={styles.stepDescription}>
              Select the ASR base model and hyperparameters.
            </p>
            
            <div className="flex justify-between items-center mb-6">
              <div className="flex items-center gap-2">
                <input 
                  type="checkbox" 
                  id="realtimeToggle"
                  checked={wizardCtx.optimizeForRealtime}
                  onChange={(e) => setWizardCtx(prev => ({ ...prev, optimizeForRealtime: e.target.checked }))}
                />
                <label htmlFor="realtimeToggle" className="font-medium">Optimize for live feedback (real-time <span className="text-sm text-gray-400">{'<200ms'}</span>)</label>
              </div>
              
              <select 
                className="input"
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value as any)}
              >
                {ASR_MODEL_CATEGORIES.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            </div>
            
            <div className="grid grid-cols-1 gap-4 mb-8 max-h-[400px] overflow-y-auto pr-2">
              {MODELS.filter(m => selectedCategory === "all" || m.category === selectedCategory)
                .filter(m => !wizardCtx.optimizeForRealtime || m.realtimeCapable)
                .map((model) => (
                <div 
                  key={model.id}
                  className={`p-4 border rounded cursor-pointer ${selectedModelId === model.id ? 'border-primary bg-primary/5' : 'border-border'} ${model.id === recommendedModel.id ? 'relative' : ''}`}
                  onClick={() => setSelectedModelId(model.id)}
                >
                  {model.id === recommendedModel.id && (
                    <div className="absolute top-0 right-0 bg-primary text-white text-xs px-2 py-1 rounded-bl-lg rounded-tr">Recommended</div>
                  )}
                  <div className="flex justify-between">
                    <div className="font-medium">{model.name}</div>
                    <div className="text-sm text-gray-400">{model.size} • {model.phonemeVocabType}</div>
                  </div>
                  <div className="text-sm text-gray-500 mt-2">{model.strengths.join(", ")}</div>
                </div>
              ))}
            </div>
            
            <div className="mt-8 flex justify-between">
              <button className="btn btn-default" onClick={() => setStep(2)}>Back</button>
              <button className="btn btn-primary" onClick={nextStep}>Next: Review & Correct</button>
            </div>
          </div>
        )}

        {/* ── Step 4: Review & Correct ── */}
        {step === 4 && (
          <div className={styles.stepContent}>
            <h1 className={styles.stepTitle}>Review & Correct (Preview)</h1>
            <p className={styles.stepDescription}>
              Review the bootstrap phonetic transcriptions for a sample of the clips.
            </p>
            
            {previewPairs.length > 0 ? (
              <div className="mb-8">
                <WaveformCorrector 
                  clipUrl="/api/placeholder-audio" // placeholder 
                  labels={previewPairs[activePreviewIndex].phonemeLabels}
                  onLabelsChange={(labels) => {
                    const newPairs = [...previewPairs];
                    newPairs[activePreviewIndex].phonemeLabels = labels;
                    setPreviewPairs(newPairs);
                  }}
                  onConfirm={() => {
                    // move to next
                    if (activePreviewIndex < previewPairs.length - 1) setActivePreviewIndex(activePreviewIndex + 1);
                  }}
                  onReject={() => {
                    // move to next
                    if (activePreviewIndex < previewPairs.length - 1) setActivePreviewIndex(activePreviewIndex + 1);
                  }}
                />
              </div>
            ) : (
              <div className="p-8 text-center text-gray-400 border border-dashed rounded-lg mb-8">
                Loading preview clips...
              </div>
            )}
            
            <div className="mt-8 flex justify-between">
              <button className="btn btn-default" onClick={() => setStep(3)}>Back</button>
              <button className="btn btn-primary" onClick={nextStep}>Next: Launch</button>
            </div>
          </div>
        )}

        {/* ── Step 5: Launch ── */}
        {step === 5 && (
          <div className={styles.stepContent}>
            {launchedJobId ? (
              <div className="text-center py-16">
                <div className="text-4xl mb-4">🚀</div>
                <h1 className="text-2xl font-bold mb-4">Job Launched!</h1>
                <p className="text-gray-400 mb-8">Your ASR fine-tuning job is now running on the cluster.</p>
                <Link href={`/jobs/${launchedJobId}`} className="btn btn-primary">
                  View Job Progress
                </Link>
              </div>
            ) : (
              <>
                <h1 className={styles.stepTitle}>Review & Launch</h1>
                <p className={styles.stepDescription}>
                  Name your job and confirm training.
                </p>
                
                <div className="form-group mb-8">
                  <label className="font-medium block mb-2">Job Name</label>
                  <input 
                    type="text" 
                    className="input w-full"
                    placeholder="e.g., Noorani Qaida L1-3"
                    value={jobName}
                    onChange={(e) => setJobName(e.target.value)}
                  />
                </div>
                
                <div className="bg-body p-6 rounded-lg border border-border mb-8">
                  <h3 className="font-medium mb-4">Summary</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-gray-500">Base Model</div>
                      <div>{selectedModel.name}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Script Type</div>
                      <div>{wizardCtx.scriptType}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Lessons</div>
                      <div>{wizardCtx.targetScope.lessons.length > 0 ? wizardCtx.targetScope.lessons.join(", ") : "None"}</div>
                    </div>
                    <div>
                      <div className="text-gray-500">Recitation Style</div>
                      <div>{wizardCtx.recitationStyle}</div>
                    </div>
                  </div>
                </div>
                
                <div className="mt-8 flex justify-between items-center">
                  <button className="btn btn-default" onClick={() => setStep(4)} disabled={launching}>Back</button>
                  <button className="btn btn-primary" onClick={handleLaunch} disabled={launching}>
                    {launching ? "Launching..." : "Start Training"}
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
