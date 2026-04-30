import { Document, Packer, Paragraph, TextRun } from "docx";
// @ts-expect-error No bundled types for html-to-docx
import HTMLtoDOCX from "html-to-docx";
import { CV_SOURCE_HTML } from "../profile/cv-extracted-html.gen";
import { applyDefaultCvStyles } from "../pipeline/cvHtmlDefaultStyles";
import { reapplyCvFormatting } from "../pipeline/cvHtmlEmphasis";

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export { DOCX_MIME };

function toArrayBuffer(data: unknown): ArrayBuffer {
  if (data instanceof ArrayBuffer) return data;
  if (ArrayBuffer.isView(data)) {
    const v = data as ArrayBufferView;
    const u8 = new Uint8Array(v.byteLength);
    u8.set(new Uint8Array(v.buffer, v.byteOffset, v.byteLength));
    return u8.buffer;
  }
  const u8 = new Uint8Array(data as ArrayLike<number>);
  return u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);
}

/** Wrap mammoth/model fragment in a minimal document for html-to-docx. */
function wrapHtmlForDocx(inner: string): string {
  const t = inner.trim();
  const head = t.slice(0, 32).toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html")) return inner;
  // Body font comes from html-to-docx documentOptions (matches Word theme body: Calibri for this CV).
  return `<!DOCTYPE html><html xmlns="http://www.w3.org/1999/xhtml"><head><meta charset="utf-8"/></head><body>${inner}</body></html>`;
}

/** Tailored CV HTML (from Word → mammoth → model) → .docx, preserving more layout than plain text. */
export async function htmlToDocxArrayBuffer(
  htmlFragmentOrDocument: string,
  referenceCvHtml: string = CV_SOURCE_HTML,
): Promise<ArrayBuffer> {
  const themed = htmlFragmentOrDocument.includes('data-cv-themed="1"')
    ? htmlFragmentOrDocument
    : applyDefaultCvStyles(reapplyCvFormatting(htmlFragmentOrDocument, referenceCvHtml));
  const html = wrapHtmlForDocx(themed);
  const out = await HTMLtoDOCX(html, null, {
    table: { row: { cantSplit: true } },
    // Office theme minor font for Oleg_Velikanov_CV.docx (see word/theme/theme1.xml).
    font: "Calibri",
    fontSize: 18,
  });
  return toArrayBuffer(out);
}

/** Plain / markdown-ish text → simple .docx (one paragraph per line). Fallback when cv_html is empty. */
export async function textToDocxArrayBuffer(body: string): Promise<ArrayBuffer> {
  const lines = body.replace(/\r\n/g, "\n").split("\n");
  const children = lines.map(
    (line) =>
      new Paragraph({
        children: [new TextRun({ text: line.length > 0 ? line : " " })],
      }),
  );
  const doc = new Document({
    sections: [{ children }],
  });
  const blob = await Packer.toBlob(doc);
  return blob.arrayBuffer();
}
