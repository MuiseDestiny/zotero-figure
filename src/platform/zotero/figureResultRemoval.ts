import { getString } from "../../utils/locale";

export async function getDocumentPdfAttachments(
  libraryID: number,
  documentItemID: number,
): Promise<Zotero.Item[]> {
  const item = await Zotero.Items.getAsync(documentItemID);
  if (!item || item.libraryID !== libraryID || item.deleted) return [];
  if (item.isPDFAttachment()) return [item];
  if (!item.isRegularItem()) return [];
  const attachments = await Zotero.Items.getAsync(item.getAttachments());
  return attachments.filter(
    (attachment) =>
      attachment.libraryID === libraryID &&
      !attachment.deleted &&
      attachment.isPDFAttachment(),
  );
}

/** Native confirmation keeps the checkbox and cancel behavior consistent. */
export function confirmFigureResultRemoval(
  owner: Window,
  documentTitle: string,
  attachmentCount: number,
  count: number,
  wholeDocument: boolean,
): { removeAnnotations: boolean } | undefined {
  const prompt = Services.prompt;
  const checked = { value: false };
  const result = prompt.confirmEx(
    owner as unknown as mozIDOMWindowProxy,
    getString("gallery-delete-title"),
    getString(
      wholeDocument ? "gallery-confirm-clear" : "gallery-confirm-delete",
      { args: { title: documentTitle, attachments: attachmentCount, count } },
    ),
    prompt.BUTTON_POS_0 * prompt.BUTTON_TITLE_IS_STRING +
      prompt.BUTTON_POS_1 * prompt.BUTTON_TITLE_CANCEL +
      prompt.BUTTON_POS_1_DEFAULT,
    getString(
      wholeDocument ? "gallery-clear-document" : "gallery-delete-result",
    ),
    "",
    "",
    getString("gallery-delete-annotations"),
    checked,
  );
  return result === 0 ? { removeAnnotations: checked.value } : undefined;
}
