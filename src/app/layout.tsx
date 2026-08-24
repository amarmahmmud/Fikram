import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Fikram — Turn Your Expertise into AI",
  description:
    "The platform where experts create AI assistants powered by their own knowledge. Upload your content, get an intelligent assistant in seconds — or train a fully custom model.",
  keywords: ["AI assistant", "expert AI", "RAG", "fine-tuning", "knowledge base", "LLM", "content creators"],
  authors: [{ name: "Fikram" }],
  openGraph: {
    title: "Fikram — Turn Your Expertise into AI",
    description: "Create AI assistants from your own knowledge. Ready in seconds, no code required.",
    type: "website",
    siteName: "Fikram",
  },
  twitter: {
    card: "summary_large_image",
    title: "Fikram — Turn Your Expertise into AI",
    description: "Create AI assistants from your own knowledge. Ready in seconds.",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body>{children}</body>
    </html>
  );
}
