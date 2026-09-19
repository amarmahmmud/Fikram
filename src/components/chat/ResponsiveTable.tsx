"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import { Table, LayoutGrid, Check, Copy, ChevronRight, Sparkles } from "lucide-react";
import styles from "./ResponsiveTable.module.css";

interface ResponsiveTableProps {
  children?: React.ReactNode;
  [key: string]: any;
}

interface ParsedCell {
  text: string;
  node: React.ReactNode;
}

interface ParsedRow {
  isHeader?: boolean;
  isTotal?: boolean;
  cells: ParsedCell[];
}

/** Recursively extracts plain text from React nodes */
function extractText(node: any): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (React.isValidElement(node)) {
    return extractText((node.props as any)?.children);
  }
  return "";
}

/** Extract score numbers like "7 / 10", "7", "45 / 100" */
export function parseScoreValue(scoreStr: string): { score: number; max: number } | null {
  const match = scoreStr.match(/(\d+)\s*(?:\/\s*(\d+))?/);
  if (!match) return null;
  const score = parseInt(match[1], 10);
  const max = match[2] ? parseInt(match[2], 10) : 10;
  return { score, max };
}

/** Determines score badge color tier */
export function getScoreBadgeClass(score: number, max: number = 10): string {
  const ratio = max > 0 ? score / max : 0;
  if (ratio >= 0.7) return styles.scoreHigh;
  if (ratio >= 0.4) return styles.scoreMedium;
  return styles.scoreLow;
}

export function ResponsiveTable({ children, ...tableProps }: ResponsiveTableProps) {
  // Mobile check: default to cards on phone screens (< 640px)
  const [viewMode, setViewMode] = useState<"cards" | "table">("table");
  const [isMobileScreen, setIsMobileScreen] = useState(false);
  const [hasScrolled, setHasScrolled] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [copied, setCopied] = useState(false);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const checkViewport = () => {
      const isMobile = window.innerWidth <= 640;
      setIsMobileScreen(isMobile);
      // Auto-select cards on small screens for initial render
      setViewMode(isMobile ? "cards" : "table");
    };

    checkViewport();
    window.addEventListener("resize", checkViewport);
    return () => window.removeEventListener("resize", checkViewport);
  }, []);

  // Parse children into structured rows & headers
  const { headers, rows, isScorecard } = React.useMemo(() => {
    const headerList: ParsedCell[] = [];
    const rowList: ParsedRow[] = [];

    const recurseFindElements = (element: any) => {
      if (!element) return;
      if (Array.isArray(element)) {
        element.forEach(recurseFindElements);
        return;
      }
      if (!React.isValidElement(element)) return;

      const props = element.props as any;
      const type = (element.type as any)?.displayName || element.type;
      const typeStr = typeof type === "string" ? type.toLowerCase() : "";

      if (typeStr === "thead") {
        React.Children.forEach(props?.children, (tr: any) => {
          if (!React.isValidElement(tr)) return;
          const trProps = tr.props as any;
          React.Children.forEach(trProps?.children, (th: any) => {
            if (!th) return;
            const thProps = (th as any)?.props;
            headerList.push({
              text: extractText(th).trim(),
              node: thProps?.children ?? th,
            });
          });
        });
      } else if (typeStr === "tbody") {
        React.Children.forEach(props?.children, (tr: any) => {
          if (!React.isValidElement(tr)) return;
          const trProps = tr.props as any;
          const cells: ParsedCell[] = [];
          React.Children.forEach(trProps?.children, (td: any) => {
            if (!td) return;
            const tdProps = (td as any)?.props;
            cells.push({
              text: extractText(td).trim(),
              node: tdProps?.children ?? td,
            });
          });

          if (cells.length > 0) {
            const firstCellText = cells[0]?.text?.toLowerCase() || "";
            const isTotal =
              firstCellText.includes("total") ||
              firstCellText.includes("overall") ||
              firstCellText.includes("verdict");
            rowList.push({ isTotal, cells });
          }
        });
      } else if (props?.children) {
        recurseFindElements(props.children);
      }
    };

    recurseFindElements(children);

    // Detect if this table is a Scorecard (e.g. Dimension, Score, Reasoning)
    const headerTexts = headerList.map((h) => h.text.toLowerCase());
    const isScore =
      headerTexts.some((h) => h.includes("dimension") || h.includes("category") || h.includes("metric")) &&
      headerTexts.some((h) => h.includes("score") || h.includes("rating") || h.includes("points"));

    return { headers: headerList, rows: rowList, isScorecard: isScore };
  }, [children]);

  // Handle horizontal scroll indicators
  const updateScrollShadows = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const { scrollLeft, scrollWidth, clientWidth } = el;
    setCanScrollLeft(scrollLeft > 6);
    setCanScrollRight(scrollLeft + clientWidth < scrollWidth - 6);
    if (scrollLeft > 10) setHasScrolled(true);
  }, []);

  useEffect(() => {
    if (viewMode === "table") {
      updateScrollShadows();
      const el = scrollContainerRef.current;
      if (el) {
        el.addEventListener("scroll", updateScrollShadows, { passive: true });
        window.addEventListener("resize", updateScrollShadows);
        return () => {
          el.removeEventListener("scroll", updateScrollShadows);
          window.removeEventListener("resize", updateScrollShadows);
        };
      }
    }
  }, [viewMode, updateScrollShadows]);

  // Copy table text helper
  const handleCopyTable = useCallback(async () => {
    if (headers.length === 0 && rows.length === 0) return;
    try {
      const headerLine = headers.map((h) => h.text).join("\t");
      const rowLines = rows.map((r) => r.cells.map((c) => c.text.replace(/\n/g, " ")).join("\t"));
      const fullText = [headerLine, ...rowLines].join("\n");
      await navigator.clipboard.writeText(fullText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }, [headers, rows]);

  // If table has no parsed rows (fallback to standard table rendering)
  const canRenderCards = headers.length > 0 && rows.length > 0;

  return (
    <div className={styles.wrapper}>
      {/* ── Top View Switcher Toolbar ── */}
      {canRenderCards && (
        <div className={styles.tableToolbar}>
          <div className={styles.toolbarLeft}>
            {isScorecard && (
              <span className={styles.scorecardBadge}>
                <Sparkles size={12} />
                <span>Scorecard</span>
              </span>
            )}
            <span className={styles.rowCountText}>{rows.length} items</span>
          </div>

          <div className={styles.toolbarActions}>
            <button
              className={styles.copyBtn}
              onClick={handleCopyTable}
              title="Copy table content"
              aria-label="Copy table content"
            >
              {copied ? <Check size={12} color="var(--accent-primary)" /> : <Copy size={12} />}
              <span className={styles.btnLabelText}>{copied ? "Copied" : "Copy"}</span>
            </button>

            {/* View Mode Toggle */}
            <div className={styles.toggleGroup} role="group" aria-label="Table view mode">
              <button
                type="button"
                className={`${styles.toggleBtn} ${viewMode === "cards" ? styles.toggleActive : ""}`}
                onClick={() => setViewMode("cards")}
                title="Mobile Cards View"
                aria-pressed={viewMode === "cards"}
              >
                <LayoutGrid size={13} />
                <span>Cards</span>
              </button>
              <button
                type="button"
                className={`${styles.toggleBtn} ${viewMode === "table" ? styles.toggleActive : ""}`}
                onClick={() => setViewMode("table")}
                title="Traditional Table View"
                aria-pressed={viewMode === "table"}
              >
                <Table size={13} />
                <span>Table</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── View Mode: Mobile Cards ── */}
      {viewMode === "cards" && canRenderCards ? (
        <div className={styles.cardsContainer}>
          {rows.map((row, idx) => {
            if (row.isTotal) {
              // Standout Total Card
              const totalDim = row.cells[0]?.text || "Total Score";
              const totalScoreStr = row.cells[1]?.text || "";
              const totalVerdict = row.cells[2]?.text || "";

              return (
                <div key={idx} className={styles.totalCard}>
                  <div className={styles.totalCardHeader}>
                    <div className={styles.totalTitle}>{totalDim}</div>
                    {totalScoreStr && (
                      <div className={styles.totalScoreBadge}>{totalScoreStr}</div>
                    )}
                  </div>
                  {totalVerdict && (
                    <div className={styles.totalVerdictText}>{totalVerdict}</div>
                  )}
                </div>
              );
            }

            // Normal Row Card
            const titleCell = row.cells[0];
            const scoreCell = isScorecard && row.cells.length >= 2 ? row.cells[1] : null;
            const scoreInfo = scoreCell ? parseScoreValue(scoreCell.text) : null;
            const remainingCells = isScorecard ? row.cells.slice(2) : row.cells.slice(1);

            return (
              <div key={idx} className={styles.cardItem}>
                <div className={styles.cardHeader}>
                  <div className={styles.cardTitle}>{titleCell?.node}</div>
                  {scoreInfo && (
                    <span
                      className={`${styles.scorePill} ${getScoreBadgeClass(
                        scoreInfo.score,
                        scoreInfo.max
                      )}`}
                    >
                      {scoreCell?.text}
                    </span>
                  )}
                </div>

                {/* Score Progress Bar if available */}
                {scoreInfo && (
                  <div className={styles.progressTrack}>
                    <div
                      className={`${styles.progressBar} ${getScoreBadgeClass(
                        scoreInfo.score,
                        scoreInfo.max
                      )}`}
                      style={{
                        width: `${Math.min(
                          100,
                          Math.max(8, (scoreInfo.score / scoreInfo.max) * 100)
                        )}%`,
                      }}
                    />
                  </div>
                )}

                {/* Remaining Columns / Reasoning */}
                <div className={styles.cardBody}>
                  {remainingCells.map((cell, cIdx) => {
                    const colIndex = isScorecard ? cIdx + 2 : cIdx + 1;
                    const headerName = headers[colIndex]?.text || "";

                    return (
                      <div key={cIdx} className={styles.cardField}>
                        {!isScorecard && headerName && (
                          <div className={styles.fieldLabel}>{headerName}:</div>
                        )}
                        <div className={styles.fieldValue}>{cell.node}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── View Mode: Table ── */
        <div className={styles.tableScrollWrapper}>
          {/* Scroll fade masks */}
          {canScrollLeft && <div className={styles.scrollFadeLeft} />}
          {canScrollRight && <div className={styles.scrollFadeRight} />}

          {/* Swipe indicator hint for touch screens */}
          {canScrollRight && !hasScrolled && (
            <div className={styles.swipeHint}>
              <span>Swipe horizontally</span>
              <ChevronRight size={13} />
            </div>
          )}

          <div
            className={styles.scrollContainer}
            ref={scrollContainerRef}
            tabIndex={0}
            role="region"
            aria-label="Scrollable table"
          >
            <table className={styles.table} {...tableProps}>
              {children}
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
