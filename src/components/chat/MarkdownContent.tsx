"use client";

import React, { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ResponsiveTable } from "./ResponsiveTable";
import { Check, Copy } from "lucide-react";
import { cleanRepetitionLoop } from "@/lib/text-cleaner";
import styles from "./MarkdownContent.module.css";

interface MarkdownContentProps {
  content: string;
}

/** Code block with copy button and language badge */
function CodeBlockWrapper({
  language,
  children,
}: {
  language?: string;
  children: React.ReactNode;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const codeText = typeof children === "string" ? children : String(children);
      await navigator.clipboard.writeText(codeText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  return (
    <div className={styles.codeBlockContainer}>
      <div className={styles.codeBlockHeader}>
        <span className={styles.codeLanguage}>
          {language ? language.toUpperCase() : "CODE"}
        </span>
        <button
          type="button"
          className={styles.copyCodeBtn}
          onClick={handleCopy}
          title="Copy code to clipboard"
          aria-label="Copy code"
        >
          {copied ? <Check size={13} color="var(--accent-primary)" /> : <Copy size={13} />}
          <span>{copied ? "Copied" : "Copy"}</span>
        </button>
      </div>
      <pre className={styles.codeBlock}>
        <code>{children}</code>
      </pre>
    </div>
  );
}

export function MarkdownContent({ content }: MarkdownContentProps) {
  const safeContent = cleanRepetitionLoop(content || "");

  return (
    <div className={styles.markdownBody}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          table: ({ node, ...props }) => <ResponsiveTable {...props} />,
          th: ({ node, ...props }) => <th className={styles.th} {...props} />,
          td: ({ node, ...props }) => <td className={styles.td} {...props} />,
          h1: ({ node, ...props }) => <h1 className={styles.h1} {...props} />,
          h2: ({ node, ...props }) => <h2 className={styles.h2} {...props} />,
          h3: ({ node, ...props }) => <h3 className={styles.h3} {...props} />,
          h4: ({ node, ...props }) => <h4 className={styles.h4} {...props} />,
          hr: () => <hr className={styles.divider} />,
          ul: ({ node, ...props }) => <ul className={styles.bulletList} {...props} />,
          ol: ({ node, ...props }) => <ol className={styles.orderedList} {...props} />,
          blockquote: ({ node, ...props }) => (
            <blockquote className={styles.blockquote} {...props} />
          ),
          strong: ({ node, ...props }) => <strong className={styles.strong} {...props} />,
          a: ({ node, href, children, ...props }: any) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className={styles.link}
              {...props}
            >
              {children}
            </a>
          ),
          code: ({ node, inline, className, children, ...props }: any) => {
            if (inline) {
              return (
                <code className={styles.inlineCode} {...props}>
                  {children}
                </code>
              );
            }
            const match = /language-(\w+)/.exec(className || "");
            const lang = match ? match[1] : undefined;
            return (
              <CodeBlockWrapper language={lang}>
                {children}
              </CodeBlockWrapper>
            );
          },
        }}
      >
        {safeContent}
      </ReactMarkdown>
    </div>
  );
}
