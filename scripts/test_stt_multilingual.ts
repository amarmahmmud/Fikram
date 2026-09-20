import { generateWithModelFallback } from "../src/lib/gemini";
import { TextToSpeechClient } from "@google-cloud/text-to-speech";
import fs from "fs";
import path from "path";

async function testTranscription(lang, text, languageCode, voiceName) {
  console.log(`\n=== Testing ${lang} (${languageCode}) ===`);
  console.log(`Original spoken text: "${text}"`);

  // 1. Synthesize audio with GCP TTS
  const keyPath = path.resolve(process.cwd(), "gcp-key.json");
  const ttsClient = new TextToSpeechClient({ keyFilename: keyPath });

  const [ttsResponse] = await ttsClient.synthesizeSpeech({
    input: { text },
    voice: { languageCode, name: voiceName },
    audioConfig: { audioEncoding: "MP3" },
  });

  const audioBase64 = Buffer.from(ttsResponse.audioContent).toString("base64");
  console.log(`Generated audio size: ${ttsResponse.audioContent.length} bytes`);

  // 2. Transcribe with Gemini
  const prompt = `Transcribe the spoken audio verbatim in the original language spoken (${lang}). Output ONLY the transcribed text without quotes, commentary, markdown headings, or translation.`;

  const contents = [
    {
      role: "user",
      parts: [
        {
          inlineData: {
            data: audioBase64,
            mimeType: "audio/mp3",
          },
        },
        {
          text: prompt,
        },
      ],
    },
  ];

  const startTime = Date.now();
  const res = await generateWithModelFallback(contents, {
    generationConfig: { temperature: 0.0 },
  });
  const elapsed = Date.now() - startTime;

  const transcribed = res.text().trim();
  console.log(`Transcribed text: "${transcribed}" (${elapsed}ms)`);
}

async function main() {
  try {
    // English
    await testTranscription("English", "Hello, I am pitching an AI platform for legal discovery.", "en-US", "en-US-Journey-F");
    // Arabic
    await testTranscription("Arabic", "مرحبا، أريد تقييم هذا المشروع الاقتصادي.", "ar-XA", "ar-XA-Standard-A");
    // Amharic
    await testTranscription("Amharic", "ሰላም፣ ይህ አዲስ የንግድ ዕቅድ እንዴት ይታያል?", "am-ET", "am-ET-Standard-A");
  } catch (err) {
    console.error("Test failed:", err);
  }
}

main();
