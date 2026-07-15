import {
  OperationCancelledError,
  throwIfAborted,
} from "../../utils/cancellation";

export async function readAttachmentBytes(
  attachment: Zotero.Item,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const path = await getAttachmentFilePath(attachment, signal);
  const bytes = await IOUtils.read(path);
  throwIfAborted(signal);
  if (bytes.byteLength < 5) {
    throw new Error("The PDF attachment is empty or unavailable");
  }
  if (
    bytes.byteOffset === 0 &&
    bytes.byteLength === bytes.buffer.byteLength &&
    bytes.buffer instanceof ArrayBuffer
  ) {
    return bytes.buffer;
  }
  return bytes.slice().buffer;
}

export async function getAttachmentFilePath(
  attachment: Zotero.Item,
  signal?: AbortSignal,
): Promise<string> {
  throwIfAborted(signal);
  const getFilePath = (
    attachment as Zotero.Item & {
      getFilePathAsync?: () => Promise<false | string>;
    }
  ).getFilePathAsync;
  if (!getFilePath) {
    throw new Error("The selected item is not a file attachment");
  }
  try {
    const path = await getFilePath.call(attachment);
    throwIfAborted(signal);
    if (!path) throw new Error("The PDF attachment file is unavailable");
    return path;
  } catch (error) {
    if (signal?.aborted) throw new OperationCancelledError();
    throw error;
  }
}
