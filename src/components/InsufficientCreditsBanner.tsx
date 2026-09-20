"use client";

import { AlertTriangle, Zap, Coins } from "lucide-react";
import styles from "./InsufficientCreditsBanner.module.css";

interface InsufficientCreditsBannerProps {
  balance: number;
  required?: number;
  actionText?: string;
  onTopUpClick: () => void;
  className?: string;
}

export function InsufficientCreditsBanner({
  balance,
  required,
  actionText = "proceed with this action",
  onTopUpClick,
  className,
}: InsufficientCreditsBannerProps) {
  const needed = required !== undefined ? Math.max(0, required - balance) : 0;

  return (
    <div className={`${styles.banner} ${className || ""}`}>
      <div className={styles.left}>
        <div className={styles.iconWrap}>
          <AlertTriangle size={18} />
        </div>
        <div className={styles.content}>
          <div className={styles.title}>
            <span>Insufficient Credit Balance</span>
          </div>
          <div className={styles.subtitle}>
            {required !== undefined ? (
              <>
                Requires <span className={styles.statsHighlight}>{required} credits</span> to {actionText}. You have{" "}
                <span className={styles.statsHighlight}>{balance} credits</span> ({needed} more needed).
              </>
            ) : (
              <>
                You have <span className={styles.statsHighlight}>{balance} credits</span> remaining. Top up to {actionText}.
              </>
            )}
          </div>
        </div>
      </div>

      <button type="button" className={styles.actionBtn} onClick={onTopUpClick}>
        <Zap size={14} />
        <span>Top Up Credits</span>
      </button>
    </div>
  );
}
