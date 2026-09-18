"use client";

import { useState, type ReactNode, type CSSProperties, type MouseEvent } from "react";
import ComingSoonModal, { type ComingSoonFeature } from "./ComingSoonModal";

/**
 * Drop-in replacement for <button> or <Link> that intercepts clicks
 * and shows the Coming Soon modal instead of navigating/executing.
 *
 * Renders as a <button> by default but accepts the same visual styling.
 */
export default function ComingSoonButton({
  feature,
  children,
  className,
  style,
  disabled,
  "aria-label": ariaLabel,
}: {
  feature: ComingSoonFeature;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  "aria-label"?: string;
}) {
  const [showModal, setShowModal] = useState(false);

  function handleClick(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setShowModal(true);
  }

  return (
    <>
      <button
        className={className}
        style={style}
        onClick={handleClick}
        disabled={disabled}
        aria-label={ariaLabel}
        type="button"
      >
        {children}
      </button>
      {showModal && (
        <ComingSoonModal
          feature={feature}
          onClose={() => setShowModal(false)}
        />
      )}
    </>
  );
}
