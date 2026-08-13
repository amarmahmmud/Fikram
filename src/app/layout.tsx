import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Model Factory — Fine-tune Any AI Model",
  description:
    "The smart platform to fine-tune any AI model for your specific business goal. No code required. Powered by an AI guide that walks you through every step.",
  keywords: ["fine-tuning", "AI", "LLM", "machine learning", "Hugging Face", "LoRA", "model training"],
  authors: [{ name: "Model Factory" }],
  openGraph: {
    title: "Model Factory — Fine-tune Any AI Model",
    description: "Fine-tune AI models for your business in minutes. No ML expertise needed.",
    type: "website",
    siteName: "Model Factory",
  },
  twitter: {
    card: "summary_large_image",
    title: "Model Factory — Fine-tune Any AI Model",
    description: "Fine-tune AI models for your business in minutes.",
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
