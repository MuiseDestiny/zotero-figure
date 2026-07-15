const BASE64_INPUT_CHUNK_SIZE = 24 * 1024;

export function bytesToDataURL(bytes: Uint8Array, mimeType: string): string {
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mimeType)) {
    throw new Error("Data URL has an invalid MIME type");
  }

  const encodedChunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; ) {
    const end = Math.min(offset + BASE64_INPUT_CHUNK_SIZE, bytes.byteLength);
    let binary = "";
    for (; offset < end; offset++) {
      binary += String.fromCharCode(bytes[offset]);
    }
    encodedChunks.push(btoa(binary));
  }
  return `data:${mimeType};base64,${encodedChunks.join("")}`;
}
