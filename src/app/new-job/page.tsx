"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import styles from "./page.module.css";
import { MODELS } from "@/lib/models";


/* ── Types ── */
type Step = 1 | 2 | 3 | 4;

interface ChatMessage {
  role: "ai" | "user";
  content: string;
}

interface AiQuestion {
  id: string;
  text: string;
  options: string[];
  allowCustom: boolean;
  multiSelect: boolean;
}

interface TrainingConfig {
  baseModel: string;
  method: string;
  epochs: number;
  learningRate: number;
  batchSize: number;
  warmupSteps: number;
  estimatedCredits: number;
  estimatedTime: string;
}

const STEP_LABELS = ["Upload & Describe", "AI Questions", "Review Config", "Launch"];

export default function NewJobPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [goalText, setGoalText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    { role: "ai", content: "Hi! I'm your AI fine-tuning assistant 🧙 Tell me what you'd like your custom AI model to do, and I'll help you set everything up." },
  ]);
  const [currentQuestion, setCurrentQuestion] = useState<AiQuestion | null>(null);
  const [aiConfig, setAiConfig] = useState<TrainingConfig | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [selectedModel, setSelectedModel] = useState(MODELS[0].id);
  const [jobName, setJobName] = useState("");
  const [launching, setLaunching] = useState(false);
  const [generationStatus, setGenerationStatus] = useState("");
  const [launchedJobId, setLaunchedJobId] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  /* Use AI config or defaults */
  const config: TrainingConfig = aiConfig ?? {
    baseModel: MODELS.find((m) => m.id === selectedModel)?.name ?? "Llama 3.1 8B Instruct",
    method: "LoRA (auto-selected)",
    epochs: 3, learningRate: 0.00002, batchSize: 4, warmupSteps: 10,
    estimatedCredits: 28, estimatedTime: "12–18 min",
  };


  /* ── File drop ── */
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files[0];
    if (f) setFile(f);
  }

  /* ── Step 1 → AI ── */
  async function handleStep1Next() {
    if (!goalText.trim()) return;
    setAiLoading(true);
    const userMsg = goalText;
    setChatMessages((prev) => [...prev, { role: "user", content: userMsg }]);
    setGoalText("");
    try {
      const res = await fetch("/api/wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [
            { role: "user", content: userMsg },
          ],
        }),
      });
      const json = await res.json();
      if (json.ok && json.data?.type === "question") {
        setCurrentQuestion(json.data);
        setChatMessages((prev) => [...prev, { role: "ai", content: json.data.text }]);
        setStep(2);
      } else {
        setChatMessages((prev) => [...prev, { role: "ai", content: "I've got your goal! Let me ask a couple quick questions to configure the perfect model." }]);
        setStep(2);
      }
    } catch {
      setChatMessages((prev) => [...prev, { role: "ai", content: "Let me ask you a few quick questions to set up the perfect config!" }]);
      setStep(2);
    }
    setAiLoading(false);
  }


  /* ── Step 2 answer → next AI question ── */
  async function submitAnswer() {
    const chosen = customInput.trim() ? [...selectedOptions, customInput.trim()] : selectedOptions;
    if (!chosen.length) return;
    const answerText = chosen.join(", ");
    const newMessages: ChatMessage[] = [...chatMessages, { role: "user", content: answerText }];
    setChatMessages(newMessages);
    setSelectedOptions([]);
    setCustomInput("");
    setAiLoading(true);
    try {
      const res = await fetch("/api/wizard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: newMessages.map((m) => ({ role: m.role === "ai" ? "model" : "user", content: m.content })),
        }),
      });
      const json = await res.json();
      if (json.ok) {
        if (json.data?.type === "question") {
          setCurrentQuestion(json.data);
          setChatMessages((prev) => [...prev, { role: "ai", content: json.data.text }]);
        } else if (json.data?.type === "config") {
          const cfg = json.data;
          setAiConfig({
            baseModel: cfg.recommendedModel ?? MODELS[0].name,
            method:    cfg.method ?? "LoRA",
            epochs:    cfg.epochs ?? 3,
            learningRate:    cfg.learningRate ?? 0.00002,
            batchSize:       cfg.batchSize ?? 4,
            warmupSteps:     10,
            estimatedCredits: cfg.estimatedCredits ?? 28,
            estimatedTime:   cfg.estimatedTime ?? "12–18 min",
          });
          setChatMessages((prev) => [...prev, { role: "ai", content: cfg.reasoning ?? "Perfect! I've configured the optimal training setup. Review it below and launch when ready. 🚀" }]);
          setStep(3);
        } else {
          // No more questions → go to config
          setChatMessages((prev) => [...prev, { role: "ai", content: "Perfect! I've configured the optimal setup. Review it below 🚀" }]);
          setStep(3);
        }
      }
    } catch {
      setChatMessages((prev) => [...prev, { role: "ai", content: "Configuration complete! Review your settings below." }]);
      setStep(3);
    }
    setAiLoading(false);
  }


  /* ── Launch real job ── */
  async function handleLaunch() {
    setLaunching(true);
    setGenerationStatus("Preparing...");
    try {
      let finalDatasetUrl = null;

      if (file) {
        let fileToUpload = file;
        
        // If file is not jsonl, we auto-generate the dataset
        if (!file.name.toLowerCase().endsWith(".jsonl")) {
          setGenerationStatus("Extracting text...");
          let rawText = "";
          
          if (file.name.toLowerCase().endsWith(".pdf")) {
            const formData = new FormData();
            formData.append("file", file);
            const parseRes = await fetch("/api/parse-pdf", { method: "POST", body: formData });
            const parseData = await parseRes.json();
            if (!parseData.text) throw new Error("Failed to parse PDF");
            rawText = parseData.text;
          } else {
            rawText = await file.text();
          }

          setGenerationStatus("Synthesizing dataset with AI pipeline (this may take 30-60s for large documents)...");
          const genRes = await fetch("/api/generate-dataset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ text: rawText, goal: chatMessages[1]?.content || "" })
          });
          const genData = await genRes.json();
          if (!genData.ok) throw new Error(genData.error || "Dataset generation failed");

          const blob = new Blob([genData.jsonl], { type: "application/jsonl" });
          fileToUpload = new File([blob], `${file.name.replace(/\.[^/.]+$/, "")}_dataset.jsonl`, { type: "application/jsonl" });
        }

        setGenerationStatus("Uploading dataset...");
        // 1. Get presigned upload URL from our API
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: fileToUpload.name, contentType: fileToUpload.type }),
        });
        const uploadData = await uploadRes.json();
        
        if (!uploadData.ok) throw new Error(uploadData.error || "Failed to get upload URL");

        // 2. Upload directly to Cloudflare R2 securely from the browser
        const putRes = await fetch(uploadData.uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": fileToUpload.type || "application/octet-stream" },
          body: fileToUpload,
        });

        if (!putRes.ok) throw new Error("Failed to upload file to storage");

        // 3. Save the secure GET URL for Replicate to download
        finalDatasetUrl = uploadData.downloadUrl;
      }

      setGenerationStatus("Queueing training job...");
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name:             jobName || "Untitled Job",
          baseModel:        selectedModel,
          method:           "lora",
          config:           { epochs: config.epochs, learningRate: config.learningRate, batchSize: config.batchSize },
          datasetUrl:       finalDatasetUrl,
          estimatedCredits: config.estimatedCredits,
        }),
      });
      const json = await res.json();
      if (json.ok) {
        setLaunchedJobId(json.jobId);
        setStep(4);
      } else {
        alert(json.error ?? "Failed to launch job");
      }
    } catch (err: any) {
      alert(err.message || "Network error — please try again");
    }
    setLaunching(false);
  }


  return (
    <>
      {/* Topbar */}
      <div className="topbar">
        <Link href="/dashboard" className="btn btn-ghost btn-sm">← Back</Link>
        <span className="topbar-title" style={{ textAlign: "center", flex: 1 }}>
          New Fine-Tuning Job
        </span>
        <div style={{ width: 80 }} />
      </div>

      <div className="page-content" style={{ maxWidth: 800 }}>
        {/* Steps indicator */}
        <div className="steps" style={{ marginBottom: 40 }}>
          {STEP_LABELS.map((label, i) => (
            <div
              key={label}
              className={`step ${step === i + 1 ? "active" : ""} ${step > i + 1 ? "completed" : ""}`}
            >
              <div className="step-number">
                {step > i + 1 ? "✓" : i + 1}
              </div>
              <span className="step-label">{label}</span>
            </div>
          ))}
        </div>

        {/* ── Step 1: Upload + Describe ── */}
        {step === 1 && (
          <div className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Upload your data & describe your goal</h2>
            <p className={styles.stepDesc}>
              Start by uploading your training dataset and telling us what you want your model to do.
              You can also just describe your goal and we&apos;ll guide you from there.
            </p>

            {/* Upload zone */}
            <div
              className={`upload-zone ${dragOver ? "drag-over" : ""} ${file ? styles.uploadDone : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.jsonl,.txt,.json"
                style={{ display: "none" }}
                onChange={(e) => e.target.files?.[0] && setFile(e.target.files[0])}
              />
              {file ? (
                <>
                  <div className="upload-icon" style={{ background: "var(--success-bg)", borderColor: "rgba(16,185,129,0.2)", color: "var(--success)" }}>✓</div>
                  <p style={{ color: "var(--success)", fontWeight: 600 }}>{file.name}</p>
                  <p className="text-muted" style={{ fontSize: "0.8125rem", marginTop: 4 }}>
                    {(file.size / 1024).toFixed(1)} KB · Click to change
                  </p>
                </>
              ) : (
                <>
                  <div className="upload-icon">↑</div>
                  <p style={{ fontWeight: 600, color: "var(--text-primary)" }}>Drop your dataset here</p>
                  <p className="text-muted" style={{ fontSize: "0.8125rem", marginTop: 4 }}>
                    Supports CSV, JSONL, TXT, JSON · Up to 50 MB
                  </p>
                  <button className="btn btn-secondary btn-sm" style={{ marginTop: 12 }} onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}>
                    Browse Files
                  </button>
                </>
              )}
            </div>

            {/* AI chat */}
            <div className={styles.chatSection}>
              <div className={styles.chatHeader}>
                <div className={styles.aiAvatarWrap}>
                  <div className="chat-avatar ai">AI</div>
                  <div>
                    <div style={{ fontSize: "0.8125rem", fontWeight: 600, color: "var(--text-primary)" }}>Model Factory AI</div>
                    <div style={{ fontSize: "0.75rem", color: "var(--success)" }}>● Online</div>
                  </div>
                </div>
              </div>
              <div className={styles.aiPromptBox}>
                <p style={{ fontSize: "0.875rem", color: "var(--text-secondary)", lineHeight: 1.7 }}>
                  Hi! I&apos;m your AI fine-tuning assistant 🧙 Tell me what you&apos;d like your custom AI model to do, and I&apos;ll help you set everything up.
                </p>
              </div>
              <textarea
                id="goal-textarea"
                className={`input ${styles.goalTextarea}`}
                placeholder="Example: I want to build a customer support chatbot for my e-commerce store that answers questions about orders, returns, and shipping in a friendly tone..."
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                rows={4}
              />
            </div>

            <div className={styles.stepActions}>
              <button
                id="step1-next-btn"
                className="btn btn-primary btn-lg"
                onClick={handleStep1Next}
                disabled={!goalText.trim() || aiLoading}
              >
                {aiLoading
                  ? <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className="animate-spin" style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", display: "inline-block" }} />
                      AI is analyzing your goal...
                    </span>
                  : "Continue → Let the AI Configure"
                }
              </button>
              {!file && (
                <p style={{ fontSize: "0.75rem", color: "var(--text-muted)" }}>
                  Dataset upload is optional — the AI can help you create training data from your description.
                </p>
              )}
            </div>
          </div>
        )}

        {/* ── Step 2: AI Questions ── */}
        {step === 2 && (
          <div className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Quick clarifying questions</h2>
            <p className={styles.stepDesc}>
              Our AI needs a few more details to configure the perfect model for your use case.
            </p>

            {/* Chat history */}
            <div className={styles.chatHistory}>
              {chatMessages.slice(1).map((msg, i) => (
                <div
                  key={i}
                  className={styles.msgWrap}
                  style={{ justifyContent: msg.role === "user" ? "flex-end" : "flex-start" }}
                >
                  {msg.role === "ai" && <div className="chat-avatar ai" style={{ flexShrink: 0 }}>AI</div>}
                  <div className={`chat-bubble ${msg.role}`}>{msg.content}</div>
                  {msg.role === "user" && <div className="chat-avatar user" style={{ flexShrink: 0 }}>JS</div>}
                </div>
              ))}
            </div>

            {/* Current question or loading */}
            {aiLoading ? (
              <div style={{ textAlign: "center", padding: "32px", color: "var(--text-muted)" }}>
                <span className="animate-spin" style={{ width: 24, height: 24, border: "2px solid rgba(255,255,255,0.1)", borderTopColor: "var(--accent-indigo)", borderRadius: "50%", display: "inline-block" }} />
                <p style={{ marginTop: 12, fontSize: "0.875rem" }}>AI is thinking...</p>
              </div>
            ) : currentQuestion ? (
              <div className={styles.questionCard}>
                <div className={styles.questionHeader}>
                  <div className="chat-avatar ai">AI</div>
                  <div className="chat-bubble ai" style={{ flex: 1 }}>
                    {currentQuestion.text}
                  </div>
                </div>

                <div className="choice-grid" style={{ marginTop: 16 }}>
                  {currentQuestion.options.map((opt: string) => (
                    <div
                      key={opt}
                      className={`choice-card ${selectedOptions.includes(opt) ? "selected" : ""}`}
                      onClick={() => {
                        if (currentQuestion.multiSelect) {
                          setSelectedOptions((prev) =>
                            prev.includes(opt) ? prev.filter((o) => o !== opt) : [...prev, opt]
                          );
                        } else {
                          setSelectedOptions([opt]);
                        }
                      }}
                    >
                      <span className="choice-card-label">{opt}</span>
                    </div>
                  ))}
                </div>

                {currentQuestion.allowCustom && (
                  <div style={{ marginTop: 12 }}>
                    <input
                      className="input"
                      placeholder="Or type your own answer..."
                      value={customInput}
                      onChange={(e) => setCustomInput(e.target.value)}
                    />
                  </div>
                )}

                {currentQuestion.multiSelect && (
                  <p style={{ fontSize: "0.75rem", color: "var(--text-muted)", marginTop: 8 }}>
                    You can select multiple options
                  </p>
                )}

                <div className={styles.stepActions} style={{ marginTop: 20 }}>
                  <button
                    id="submit-answer-btn"
                    className="btn btn-primary"
                    onClick={submitAnswer}
                    disabled={!selectedOptions.length && !customInput.trim()}
                  >
                    Submit Answer →
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}


        {/* ── Step 3: Review Config ── */}
        {step === 3 && (
          <div className={styles.stepPanel}>
            <h2 className={styles.stepTitle}>Review your training configuration</h2>
            <p className={styles.stepDesc}>
              Our AI has auto-selected the optimal settings based on your answers. You can adjust before launching.
            </p>

            <div className={styles.configSection}>
              {/* Model selector */}
              <div className={styles.configGroup}>
                <div className={styles.configLabel}>Base Model</div>
                <div className={styles.modelPicker}>
                  {MODELS.map((m) => (
                    <div
                      key={m.id}
                      className={`${styles.modelOption} ${selectedModel === m.id ? styles.modelOptionSelected : ""}`}
                      onClick={() => setSelectedModel(m.id)}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                        <span className={styles.modelOptionName}>{m.name}</span>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <span className="badge badge-default" style={{ fontSize: "0.575rem", textTransform: "capitalize" }}>{m.category}</span>
                          {m.recommended && <span className="badge badge-success" style={{ fontSize: "0.575rem" }}>⭐ Best Pick</span>}
                        </div>
                      </div>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
                        <div className={styles.modelOptionCredits}>~{m.credits.min}–{m.credits.max} credits · {m.size} · Quality {m.quality}/10</div>
                      </div>
                      {selectedModel === m.id && (
                        <div style={{ marginTop: 6, fontSize: "0.7rem", color: "var(--text-muted)", lineHeight: 1.4 }}>
                          <strong>Best for:</strong> {m.bestFor.slice(0, 3).join(", ")}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Non-recommended model warning */}
              {(() => {
                const sel = MODELS.find((m) => m.id === selectedModel);
                if (!sel) {
                  return (
                    <div style={{
                      background: "rgba(239, 68, 68, 0.08)",
                      border: "1px solid rgba(239, 68, 68, 0.2)",
                      borderRadius: 8, padding: "10px 14px", marginTop: 8,
                      fontSize: "0.75rem", color: "#ef4444",
                    }}>
                      ⚠️ <strong>Community model selected.</strong> This model is not verified on our platform. Training results and accuracy may be unpredictable. For best results, use a ⭐ verified model.
                    </div>
                  );
                } else if (!sel.recommended && sel.quality < 7) {
                  return (
                    <div style={{
                      background: "rgba(234, 179, 8, 0.08)",
                      border: "1px solid rgba(234, 179, 8, 0.2)",
                      borderRadius: 8, padding: "10px 14px", marginTop: 8,
                      fontSize: "0.75rem", color: "#d97706",
                    }}>
                      💡 <strong>{sel.name}</strong> has a quality rating of {sel.quality}/10. For higher accuracy, consider a ⭐ recommended model like Llama 3.1 8B.
                    </div>
                  );
                }
                return null;
              })()}
              <div className={styles.configGroup}>
                <div className={styles.configLabel}>Training Parameters</div>
                <div className={styles.configGrid}>
                  {[
                    { label: "Method", value: config.method },
                    { label: "Epochs", value: config.epochs },
                    { label: "Learning Rate", value: config.learningRate },
                    { label: "Batch Size", value: config.batchSize },
                    { label: "Warmup Steps", value: config.warmupSteps },
                    { label: "Dataset", value: file ? file.name : "From description" },
                  ].map(({ label, value }) => (
                    <div key={label} className={styles.configParam}>
                      <div className={styles.configParamLabel}>{label}</div>
                      <div className={styles.configParamValue}>{String(value)}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Job name */}
              <div className={styles.configGroup}>
                <div className="input-group">
                  <label htmlFor="job-name-input" className="input-label">Job Name (optional)</label>
                  <input
                    id="job-name-input"
                    className="input"
                    placeholder="My Customer Support Bot"
                    value={jobName}
                    onChange={(e) => setJobName(e.target.value)}
                  />
                </div>
              </div>

              {/* Cost estimate */}
              <div className={styles.estimateCard}>
                <div className={styles.estimateRow}>
                  <span className={styles.estimateLabel}>Estimated credits</span>
                  <span className={styles.estimateValue}>~{config.estimatedCredits} credits</span>
                </div>
                <div className={styles.estimateRow}>
                  <span className={styles.estimateLabel}>Estimated time</span>
                  <span className={styles.estimateValue}>{config.estimatedTime}</span>
                </div>
                <div className={styles.estimateRow}>
                  <span className={styles.estimateLabel}>Your balance after</span>
                  <span className={styles.estimateValue} style={{ color: "var(--success)" }}>
                    {100 - config.estimatedCredits} credits remaining
                  </span>
                </div>
              </div>
            </div>

            <div className={styles.stepActions}>
              <button
                id="launch-job-btn"
                className="btn btn-primary btn-lg"
                onClick={handleLaunch}
                disabled={launching}
              >
                {launching ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="animate-spin" style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "white", borderRadius: "50%", display: "inline-block" }} />
                    {generationStatus || "Launching job..."}
                  </span>
                ) : "🚀 Launch Fine-Tuning Job"}
              </button>
              <button className="btn btn-ghost" onClick={() => setStep(2)}>← Back</button>
            </div>
          </div>
        )}

        {/* ── Step 4: Launched! ── */}
        {step === 4 && (
          <div className={styles.successPanel}>
            <div className={styles.successIcon}>🚀</div>
            <h2 className={styles.successTitle}>Job Launched Successfully!</h2>
            <p className={styles.successDesc}>
              Your fine-tuning job is now queued and will start shortly.
              We&apos;ll notify you when it completes.
            </p>
            <div className={styles.successActions}>
              {launchedJobId && (
                <Link href={`/jobs/${launchedJobId}`} className="btn btn-primary btn-lg">
                  View Job Status →
                </Link>
              )}
              <Link href="/jobs" className="btn btn-secondary">
                All Jobs
              </Link>
              <Link href="/dashboard" className="btn btn-ghost">
                Back to Dashboard
              </Link>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
