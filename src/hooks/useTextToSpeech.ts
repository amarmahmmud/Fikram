"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";

export type PlaybackRate = 1.0 | 1.5 | 2.0;

export interface DisabledState {
  reason: string;
  isPreview: boolean;
}

export function useTextToSpeech() {
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  const [playbackRate, setPlaybackRateState] = useState<PlaybackRate>(1.0);
  const [disabledMap, setDisabledMap] = useState<Record<number, DisabledState>>({});

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const blobUrlRef = useRef<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const playbackRateRef = useRef<PlaybackRate>(1.0);

  /**
   * Stop active audio playback and abort any ongoing streaming network requests.
   */
  const stopCurrentPlayback = useCallback(() => {
    // 1. Abort network fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // 2. Stop audio element
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
      audioRef.current = null;
    }

    // 3. Revoke Blob Object URL if present
    if (blobUrlRef.current) {
      URL.revokeObjectURL(blobUrlRef.current);
      blobUrlRef.current = null;
    }

    setPlayingIndex(null);
    setLoadingIndex(null);
  }, []);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      stopCurrentPlayback();
    };
  }, [stopCurrentPlayback]);

  /**
   * Adjust playback speed in real-time.
   */
  const setPlaybackRate = useCallback((rate: PlaybackRate) => {
    playbackRateRef.current = rate;
    setPlaybackRateState(rate);
    if (audioRef.current) {
      audioRef.current.playbackRate = rate;
    }
  }, []);

  /**
   * Cycle playback speed: 1.0x -> 1.5x -> 2.0x -> 1.0x
   */
  const cyclePlaybackRate = useCallback(() => {
    const nextRate: PlaybackRate =
      playbackRateRef.current === 1.0 ? 1.5 : playbackRateRef.current === 1.5 ? 2.0 : 1.0;
    setPlaybackRate(nextRate);
  }, [setPlaybackRate]);



  /**
   * Play or toggle TTS for a specific message.
   */
  const togglePlayMessage = useCallback(
    async (text: string, index: number) => {
      // If user clicks on the currently playing message, pause and stop it
      if (playingIndex === index) {
        stopCurrentPlayback();
        return;
      }

      // If user clicks on the currently loading message, cancel loading
      if (loadingIndex === index) {
        stopCurrentPlayback();
        return;
      }

      // Interrupt behavior: stop any other playing or loading message immediately
      stopCurrentPlayback();

      // Check if this message was previously marked disabled (e.g. preview language unavailable)
      if (disabledMap[index]) {
        toast.info(disabledMap[index].reason || "Audio not available for this language yet");
        return;
      }

      setLoadingIndex(index);
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        const response = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            speakingRate: playbackRateRef.current,
          }),
          signal: abortController.signal,
        });

        // Handle error responses from API
        if (!response.ok) {
          let errorData: { error?: string; code?: string; isPreview?: boolean } = {};
          try {
            errorData = (await response.json()) as typeof errorData;
          } catch {
            errorData = { error: `Server returned status ${response.status}` };
          }

          const isPreview = Boolean(errorData.isPreview);
          const code = errorData.code;

          // If language is in preview and unavailable or unsupported
          if (code === "PREVIEW_UNAVAILABLE" || code === "LANGUAGE_NOT_SUPPORTED") {
            const reason =
              errorData.error || "Audio not available for this language yet";
            setDisabledMap((prev) => ({
              ...prev,
              [index]: { reason, isPreview },
            }));
            toast.info(reason, { duration: 4000 });
          } else if (code === "SERVICE_DISABLED") {
            toast.error("Cloud Text-to-Speech API is not enabled in your GCP project.", {
              description: "Please enable texttospeech.googleapis.com in Google Cloud Console.",
              duration: 5000,
            });
          } else if (code === "QUOTA_EXCEEDED") {
            toast.error("Character quota exceeded for this hour.", {
              description: errorData.error,
            });
          } else {
            toast.error(errorData.error || "Failed to generate speech audio.");
          }

          setLoadingIndex(null);
          return;
        }

        // Check content type
        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("audio") && !contentType.includes("mpeg")) {
          // If server returned JSON or unexpected content
          toast.error("Unexpected audio response format.");
          setLoadingIndex(null);
          return;
        }

        const audio = new Audio();
        audioRef.current = audio;
        audio.playbackRate = playbackRateRef.current;

        audio.onended = () => {
          setPlayingIndex(null);
        };

        audio.onerror = (e) => {
          console.warn("[TTS Audio error]:", e);
          setPlayingIndex(null);
          setLoadingIndex(null);
        };

        // Create Blob URL and play
        const blob = await response.blob();
        if (blobUrlRef.current) {
          URL.revokeObjectURL(blobUrlRef.current);
        }
        const blobUrl = URL.createObjectURL(blob);
        blobUrlRef.current = blobUrl;
        audio.src = blobUrl;
        setLoadingIndex(null);
        setPlayingIndex(index);
        await audio.play();
      } catch (err: unknown) {
        const error = err as { name?: string };
        if (error?.name === "AbortError") {
          // Playback intentionally aborted/interrupted by new message
          return;
        }
        console.error("[TTS play error]:", err);
        toast.error("Failed to play audio response.");
        setLoadingIndex(null);
        setPlayingIndex(null);
      }
    },
    [playingIndex, loadingIndex, disabledMap, stopCurrentPlayback]
  );

  return {
    playingIndex,
    loadingIndex,
    playbackRate,
    disabledMap,
    togglePlayMessage,
    stopCurrentPlayback,
    setPlaybackRate,
    cyclePlaybackRate,
  };
}
