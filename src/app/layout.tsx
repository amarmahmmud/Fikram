import type { Metadata } from "next";
import { Toaster } from "sonner";
import NetworkStatusListener from "@/components/NetworkStatusListener";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://fikram.live"),
  title: "Fikram — Turn Your Expertise into AI",
  description:
    "The platform where experts create RAG AI Experts powered by their own knowledge. Upload your content, get a grounded RAG AI Expert in seconds — or train a fully custom model.",
  keywords: ["RAG AI Expert", "expert AI", "RAG", "custom training", "knowledge base", "LLM", "content creators"],
  authors: [{ name: "Fikram" }],
  verification: {
    google: "TUKKxxwZin4BaShtya74CG8GpoiF0Ush3Ac5zAhKwxE", // ← paste only the content="..." value from Google Search Console
  },
  openGraph: {
    title: "Fikram — Turn Your Expertise into AI",
    description: "Create RAG AI Experts from your own knowledge. Ready in seconds, no code required.",
    type: "website",
    siteName: "Fikram",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fikram — Turn Your Expertise into AI",
    description: "Create RAG AI Experts from your own knowledge. Ready in seconds.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800;900&family=Inter:ital,opsz,wght@0,14..32,300;0,14..32,400;0,14..32,500;0,14..32,600;0,14..32,700;0,14..32,800;1,14..32,400&family=JetBrains+Mono:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <NetworkStatusListener />
        {children}
        <Toaster theme="dark" position="bottom-right" />
      </body>
    </html>
  );
}
