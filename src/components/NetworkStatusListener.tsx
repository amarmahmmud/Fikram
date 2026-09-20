"use client";

import { useEffect, useState, useRef } from "react";
import styles from "./NetworkStatusListener.module.css";
import { toast } from "sonner";

export default function NetworkStatusListener() {
  const [isOffline, setIsOffline] = useState(false);
  const [showRestored, setShowRestored] = useState(false);
  const restoredTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Initial check
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setIsOffline(true);
    }

    const handleOffline = () => {
      setIsOffline(true);
      setShowRestored(false);
      if (restoredTimeoutRef.current) {
        clearTimeout(restoredTimeoutRef.current);
      }
      toast.error("Network connection lost", {
        description: "You appear to be offline. Reconnecting automatically when available.",
        id: "network-status",
        duration: 5000,
      });
    };

    const handleOnline = () => {
      setIsOffline(false);
      setShowRestored(true);
      toast.success("Back online", {
        description: "Your internet connection has been restored.",
        id: "network-status",
        duration: 3500,
      });

      if (restoredTimeoutRef.current) {
        clearTimeout(restoredTimeoutRef.current);
      }
      restoredTimeoutRef.current = setTimeout(() => {
        setShowRestored(false);
      }, 4000);
    };

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);

    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      if (restoredTimeoutRef.current) {
        clearTimeout(restoredTimeoutRef.current);
      }
    };
  }, []);

  if (!isOffline && !showRestored) {
    return null;
  }

  return (
    <div className={styles.pillContainer} role="status" aria-live="polite">
      {isOffline ? (
        <div className={`${styles.pill} ${styles.pillOffline}`}>
          <span className={styles.pulseDot} />
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55" />
            <path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39" />
            <path d="M10.71 5.05A16 16 0 0 1 22.58 9" />
            <path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
          <span>You are offline. Retrying connection...</span>
        </div>
      ) : (
        <div className={`${styles.pill} ${styles.pillRestored}`}>
          <span className={styles.pulseDot} />
          <svg
            width="15"
            height="15"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M5 12.55a11 11 0 0 1 14.08 0" />
            <path d="M1.42 9a16 16 0 0 1 21.16 0" />
            <path d="M8.53 16.11a6 6 0 0 1 6.95 0" />
            <line x1="12" y1="20" x2="12.01" y2="20" />
          </svg>
          <span>Connection restored</span>
        </div>
      )}
    </div>
  );
}
