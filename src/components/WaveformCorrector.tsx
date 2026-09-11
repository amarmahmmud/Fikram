"use client";

import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin from "wavesurfer.js/dist/plugins/regions.esm.js";
import styles from "./WaveformCorrector.module.css";
import type { ASRDatasetPair, PhonemeLabel } from "@/lib/qps-types";

interface WaveformCorrectorProps {
  clipUrl: string;
  labels: PhonemeLabel[];
  onLabelsChange: (newLabels: PhonemeLabel[]) => void;
  onConfirm: () => void;
  onReject: () => void;
}

export default function WaveformCorrector({
  clipUrl,
  labels,
  onLabelsChange,
  onConfirm,
  onReject,
}: WaveformCorrectorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const wsRegionsRef = useRef<any>(null);

  const [activeLabelIndex, setActiveLabelIndex] = useState<number | null>(null);
  const [editingPhoneme, setEditingPhoneme] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);

  // Initialize wavesurfer
  useEffect(() => {
    if (!containerRef.current) return;

    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: "rgba(100, 100, 100, 0.5)",
      progressColor: "rgba(0, 150, 255, 0.5)",
      height: 100,
      normalize: true,
      cursorWidth: 2,
    });

    const wsRegions = ws.registerPlugin(RegionsPlugin.create());

    ws.on("play", () => setIsPlaying(true));
    ws.on("pause", () => setIsPlaying(false));

    // When clicking a region, seek to it and make it active
    wsRegions.on("region-clicked", (region: any, e: Event) => {
      e.stopPropagation();
      const idx = labels.findIndex((l) => l.startMs / 1000 === region.start);
      if (idx !== -1) {
        handleLabelSelect(idx);
        region.play();
      }
    });

    ws.load(clipUrl).catch((err: any) => {
      // Gracefully ignore unmounted aborts
      if (err?.name !== "AbortError" && !err?.message?.includes("aborted")) {
        console.warn("WaveSurfer load warning:", err);
      }
    });

    wavesurferRef.current = ws;
    wsRegionsRef.current = wsRegions;

    return () => {
      try {
        ws.destroy();
      } catch (err: any) {
        // Ignore cleanup abort errors
      }
    };
  }, [clipUrl]);

  // Sync labels with regions
  useEffect(() => {
    const wsRegions = wsRegionsRef.current;
    if (!wsRegions) return;

    wsRegions.clearRegions();

    labels.forEach((label, idx) => {
      let color = "rgba(100, 100, 100, 0.2)";
      if (label.humanVerified) {
        color = "rgba(40, 200, 100, 0.3)"; // green
      } else if (label.confidence < 0.6) {
        color = "rgba(255, 180, 0, 0.3)"; // yellow
      }

      wsRegions.addRegion({
        start: label.startMs / 1000,
        end: label.endMs / 1000,
        content: label.phoneme,
        color,
        drag: false,
        resize: true,
      });
    });
  }, [labels]);

  const handleLabelSelect = (idx: number) => {
    setActiveLabelIndex(idx);
    setEditingPhoneme(labels[idx].phoneme);
    
    // Play the segment
    const ws = wavesurferRef.current;
    if (ws) {
      ws.setTime(labels[idx].startMs / 1000);
      // Let's just play a bit
      setTimeout(() => {
        ws.pause();
      }, labels[idx].endMs - labels[idx].startMs);
      ws.play();
    }
  };

  const handleEditChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingPhoneme(e.target.value);
  };

  const handleEditSubmit = (e?: React.KeyboardEvent) => {
    if (e && e.key !== "Enter") return;
    
    if (activeLabelIndex === null) return;

    const newLabels = [...labels];
    newLabels[activeLabelIndex] = {
      ...newLabels[activeLabelIndex],
      phoneme: editingPhoneme,
      humanVerified: true,
    };
    
    onLabelsChange(newLabels);
    
    // Auto-advance
    if (activeLabelIndex < labels.length - 1) {
      handleLabelSelect(activeLabelIndex + 1);
    } else {
      setActiveLabelIndex(null);
    }
  };

  const togglePlay = () => {
    if (wavesurferRef.current) {
      wavesurferRef.current.playPause();
    }
  };

  const markAllVerified = () => {
    const newLabels = labels.map(l => ({ ...l, humanVerified: true }));
    onLabelsChange(newLabels);
  };

  return (
    <div className={styles.correctorContainer}>
      <div className={styles.header}>
        <div className={styles.title}>Review Segment</div>
        <div className={styles.stats}>
          {labels.filter(l => l.humanVerified).length} / {labels.length} verified
        </div>
      </div>

      <div className={styles.waveformContainer} ref={containerRef} onClick={togglePlay}>
        {/* wavesurfer renders here */}
      </div>

      <div className={styles.editorSection}>
        <div className={styles.segmentList}>
          {labels.map((label, idx) => (
            <div
              key={idx}
              className={`${styles.segmentLabel} ${
                activeLabelIndex === idx ? styles.active : ""
              } ${!label.humanVerified && label.confidence < 0.6 ? styles.lowConfidence : ""} ${
                label.humanVerified ? styles.verified : ""
              }`}
              onClick={() => handleLabelSelect(idx)}
            >
              <div className={styles.phonemeSymbol}>{label.phoneme}</div>
              {label.sifat && <div className={styles.sifatLabel}>{label.sifat}</div>}
            </div>
          ))}
        </div>

        <div className={styles.controls}>
          {activeLabelIndex !== null ? (
            <>
              <input
                type="text"
                className={styles.editInput}
                value={editingPhoneme}
                onChange={handleEditChange}
                onKeyDown={handleEditSubmit}
                autoFocus
              />
              <button className="btn btn-primary" onClick={() => handleEditSubmit()}>Save</button>
            </>
          ) : (
            <p>Select a segment to edit, or use <kbd>Space</kbd> to play/pause.</p>
          )}

          <div style={{ flex: 1 }} />
          
          <button className="btn btn-default" onClick={markAllVerified}>Mark All OK</button>
          <button className="btn btn-error" onClick={onReject}>Reject Clip</button>
          <button className="btn btn-primary" onClick={onConfirm}>Confirm Clip</button>
        </div>
      </div>
    </div>
  );
}
