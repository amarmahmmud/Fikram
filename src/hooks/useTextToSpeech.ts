"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { toast } from "sonner";

export type PlaybackRate = 1.0 | 1.5 | 2.0;

export interface DisabledState {
  reason: string;
  isPreview: boolean;
}

/**
 * Splits text into an initial fast-start sentence chunk (~80-220 chars)
 * and subsequent chunks so audio playback begins with near-zero latency.
 */
function splitSentenceChunks(text: string): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= 250) return [trimmed];

  const chunks: string[] = [];
  let remaining = trimmed;

  // 1. Grab first fast-start sentence (60 to 240 chars)
  const firstSentenceMatch = remaining.slice(60, 240).match(/([.!?])\s+/);
  if (firstSentenceMatch && firstSentenceMatch.index !== undefined) {
    const cut = 60 + firstSentenceMatch.index + 1;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  } else {
    const spaceMatch = remaining.slice(80, 220).match(/\s+/);
    if (spaceMatch && spaceMatch.index !== undefined) {
      const cut = 80 + spaceMatch.index;
      chunks.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    } else {
      chunks.push(remaining.slice(0, 180).trim());
      remaining = remaining.slice(180).trim();
    }
  }

  // 2. Remaining chunks (up to ~900 chars each)
  while (remaining.length > 0) {
    if (remaining.length <= 900) {
      chunks.push(remaining);
      break;
    }
    const match = remaining.slice(500, 900).match(/([.!?])\s+/);
    if (match && match.index !== undefined) {
      const cut = 500 + match.index + 1;
      chunks.push(remaining.slice(0, cut).trim());
      remaining = remaining.slice(cut).trim();
    } else {
      chunks.push(remaining.slice(0, 800).trim());
      remaining = remaining.slice(800).trim();
    }
  }

  return chunks.filter((c) => c.length > 0);
}

export function useTextToSpeech() {
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [loadingIndex, setLoadingIndex] = useState<number | null>(null);
  const [playbackRate, setPlaybackRateState] = useState<PlaybackRate>(1.0);
  const [disabledMap, setDisabledMap] = useState<Record<number, DisabledState>>({});

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeBlobUrlsRef = useRef<string[]>([]);
  const pendingPromisesRef = useRef<Promise<Blob>[]>([]);
  const abortControllerRef = useRef<AbortController | null>(null);
  const playbackRateRef = useRef<PlaybackRate>(1.0);
  const audioCacheRef = useRef<Map<string, Blob>>(new Map());

  /**
   * Stop active audio playback and abort any ongoing network requests.
   */
  const stopCurrentPlayback = useCallback((keepAudioInstance = false) => {
    // 1. Abort network fetch
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    // 2. Stop audio element
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      if (!keepAudioInstance) {
        audioRef.current.load();
        audioRef.current = null;
      }
    }

    // 3. Revoke active Blob Object URLs
    if (activeBlobUrlsRef.current.length > 0) {
      activeBlobUrlsRef.current.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {}
      });
      activeBlobUrlsRef.current = [];
    }

    // 4. Clear pending background chunks
    pendingPromisesRef.current = [];

    setPlayingIndex(null);
    setLoadingIndex(null);
  }, []);

  /**
   * Primes the audio element during a user gesture (e.g. clicking Send) to guarantee
   * seamless HTML5 audio playback across all browsers and devices without autoplay restrictions.
   */
  const primeAudio = useCallback(() => {
    try {
      if (!audioRef.current) {
        audioRef.current = new Audio();
      }
      audioRef.current.src = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
      const playPromise = audioRef.current.play();
      if (playPromise !== undefined) {
        playPromise
          .then(() => {
            if (audioRef.current) {
              audioRef.current.pause();
            }
          })
          .catch(() => {});
      }
    } catch {}
  }, []);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      stopCurrentPlayback(false);
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
   * Fetches an audio blob for a specific text chunk with in-memory caching.
   */
  const fetchAudioBlob = useCallback(
    async (chunkText: string, signal: AbortSignal): Promise<Blob> => {
      const cacheKey = `${chunkText}__${playbackRateRef.current}`;
      if (audioCacheRef.current.has(cacheKey)) {
        return audioCacheRef.current.get(cacheKey)!;
      }

      const response = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: chunkText,
          speakingRate: playbackRateRef.current,
        }),
        signal,
      });

      if (!response.ok) {
        let errJson: any = {};
        try {
          errJson = await response.json();
        } catch {}
        throw new Error(errJson.error || `TTS server error: ${response.status}`);
      }

      const blob = await response.blob();
      audioCacheRef.current.set(cacheKey, blob);
      return blob;
    },
    []
  );

  /**
   * Play or toggle TTS for a specific message with fast-start chunking.
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

      // Interrupt behavior: stop any other playing or loading message immediately (preserve primed audio)
      stopCurrentPlayback(true);

      // Check if this message was previously marked disabled
      if (disabledMap[index]) {
        toast.info(disabledMap[index].reason || "Audio not available for this language yet");
        return;
      }

      const chunks = splitSentenceChunks(text);
      if (chunks.length === 0) return;

      setLoadingIndex(index);
      const abortController = new AbortController();
      abortControllerRef.current = abortController;

      try {
        // Step 1: Fetch first chunk for instant start (~400-800ms)
        const firstBlob = await fetchAudioBlob(chunks[0], abortController.signal);

        // Step 2: Preload remaining chunks in background in parallel
        if (chunks.length > 1) {
          pendingPromisesRef.current = chunks
            .slice(1)
            .map((c) => fetchAudioBlob(c, abortController.signal));
        } else {
          pendingPromisesRef.current = [];
        }

        const audio = audioRef.current || new Audio();
        audioRef.current = audio;
        audio.playbackRate = playbackRateRef.current;

        const firstUrl = URL.createObjectURL(firstBlob);
        activeBlobUrlsRef.current.push(firstUrl);
        audio.src = firstUrl;

        // Step 3: Advance to next preloaded chunk seamlessly when current ends
        audio.onended = async () => {
          if (pendingPromisesRef.current.length > 0) {
            const nextPromise = pendingPromisesRef.current.shift()!;
            try {
              const nextBlob = await nextPromise;
              if (!audioRef.current || abortController.signal.aborted) return;
              const nextUrl = URL.createObjectURL(nextBlob);
              activeBlobUrlsRef.current.push(nextUrl);
              audio.src = nextUrl;
              audio.playbackRate = playbackRateRef.current;
              await audio.play();
            } catch (err: any) {
              if (err?.name !== "AbortError") {
                console.warn("[TTS next chunk error]:", err);
              }
              setPlayingIndex(null);
            }
          } else {
            setPlayingIndex(null);
          }
        };

        audio.onerror = (e) => {
          console.warn("[TTS Audio error]:", e);
          setPlayingIndex(null);
          setLoadingIndex(null);
        };

        // Audio starts playing immediately!
        setLoadingIndex(null);
        setPlayingIndex(index);
        await audio.play();
      } catch (err: any) {
        if (err?.name === "AbortError") {
          return;
        }
        console.error("[TTS play error]:", err);
        toast.error(err?.message || "Failed to generate speech audio.");
        setLoadingIndex(null);
        setPlayingIndex(null);
      }
    },
    [playingIndex, loadingIndex, disabledMap, stopCurrentPlayback, fetchAudioBlob]
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
    primeAudio,
  };
}
