/**
 * Robust Client-Side File Upload Utility
 *
 * Implements resilient multi-layer upload:
 * 1. Attempts direct signed URL to R2 (fast, high bandwidth).
 * 2. If direct browser-to-R2 upload is blocked by CORS preflight or network restrictions,
 *    seamlessly and automatically falls back to Next.js server-side upload (/api/upload/file).
 * 3. Never falsely reports network disconnection when CORS or presigned PUT fails.
 */

export async function uploadFileToStorage(file: File): Promise<{ downloadUrl: string; fileKey?: string }> {
  // Layer 1: Attempt Direct-to-R2 via presigned URL
  try {
    const uploadRes = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type || "application/octet-stream",
      }),
    });

    if (uploadRes.ok) {
      const { uploadUrl, downloadUrl, fileKey } = await uploadRes.json();
      if (uploadUrl && downloadUrl) {
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          body: file,
          headers: file.type ? { "Content-Type": file.type } : undefined,
        });

        if (putRes.ok) {
          return { downloadUrl, fileKey };
        }
      }
    }
  } catch (directErr) {
    console.warn("[Upload] Direct browser upload failed, falling back to server-side upload:", directErr);
  }

  // Layer 2: Server-side upload fallback (Bypasses all CORS and browser restrictions)
  try {
    const formData = new FormData();
    formData.append("file", file);

    const fallbackRes = await fetch("/api/upload/file", {
      method: "POST",
      body: formData,
    });

    if (fallbackRes.ok) {
      const data = await fallbackRes.json();
      if (data.downloadUrl) {
        return { downloadUrl: data.downloadUrl, fileKey: data.fileKey };
      }
    }

    const errData = await fallbackRes.json().catch(() => ({}));
    throw new Error(errData.error || `Upload failed with status ${fallbackRes.status}`);
  } catch (fallbackErr: any) {
    console.error("[Upload] Server fallback upload failed:", fallbackErr);
    throw fallbackErr;
  }
}

/**
 * Convert file to base64 Data URL as ultimate fallback for multimodal chat
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
