/**
 * File-format converter — turns common student file formats into one of
 * several target formats so students who pick the "wrong" format don't get
 * bounced. Pure JS, no native deps (uses pdf-lib + mammoth).
 *
 * Supported INPUTS:
 *   • Images: .jpg, .jpeg, .png
 *   • Text:   .txt, .md, .csv
 *   • Word:   .docx
 *
 * Supported TARGETS (per input):
 *   • image-jpg / image-png  → pdf
 *   • text (.txt/.md/.csv)   → pdf, txt
 *   • docx                   → pdf, txt, html
 *
 * NOT supported (would need LibreOffice / Office headless):
 *   • .doc (legacy binary Word), .ppt/.pptx, .xls/.xlsx, .pages/.key/.numbers, .rtf
 */

import * as fs from "fs/promises";
import * as path from "path";
import { PDFDocument, StandardFonts, rgb, PageSizes } from "pdf-lib";
import mammoth from "mammoth";
import {
  Document as DocxDocument,
  Packer as DocxPacker,
  Paragraph as DocxParagraph,
  TextRun as DocxTextRun,
  ImageRun as DocxImageRun,
  HeadingLevel,
} from "docx";
import ExcelJS from "exceljs";
// pptxgenjs ships its constructor as `module.exports = fn` (CJS). Under tsx
// the various ESM import shapes don't reliably surface a callable, so we
// pull it via createRequire which gives us the constructor directly.
import { createRequire } from "module";
const _require = createRequire(import.meta.url);
const PptxGenJS: any = _require("pptxgenjs");

const CONVERTIBLE_EXTS = new Set([".jpg", ".jpeg", ".png", ".txt", ".md", ".csv", ".docx"]);

export type ConvertibleKind = "image-jpg" | "image-png" | "text" | "docx";
export type ConvertTarget = "pdf" | "txt" | "html" | "docx" | "xlsx" | "pptx";

export interface ConvertTargetSpec {
  /** Short identifier the API accepts. */
  target: ConvertTarget;
  /** File extension produced (no leading dot). */
  ext: string;
  /** MIME type produced — used to check against admin's allowed-mime list. */
  mime: string;
  /** Friendly label for buttons in the UI. */
  label: string;
}

const TARGET_SPECS: Record<ConvertTarget, Omit<ConvertTargetSpec, "target">> = {
  pdf:  { ext: "pdf",  mime: "application/pdf", label: "PDF" },
  txt:  { ext: "txt",  mime: "text/plain",      label: "TXT (plain text)" },
  html: { ext: "html", mime: "text/html",       label: "HTML" },
  docx: { ext: "docx", mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", label: "Word (DOCX)" },
  xlsx: { ext: "xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",       label: "Excel (XLSX)" },
  pptx: { ext: "pptx", mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation", label: "PowerPoint (PPTX)" },
};

export function detectConvertibleKind(filename: string, mimeType?: string): ConvertibleKind | null {
  const ext = path.extname(filename).toLowerCase();
  if (!CONVERTIBLE_EXTS.has(ext)) return null;
  if (ext === ".jpg" || ext === ".jpeg") return "image-jpg";
  if (ext === ".png") return "image-png";
  if (ext === ".docx") return "docx";
  if (ext === ".txt" || ext === ".md" || ext === ".csv") return "text";
  if (mimeType?.startsWith("image/jpeg")) return "image-jpg";
  if (mimeType?.startsWith("image/png")) return "image-png";
  if (mimeType?.startsWith("text/")) return "text";
  return null;
}

export function describeConvertibleKind(kind: ConvertibleKind): string {
  switch (kind) {
    case "image-jpg": return "JPG image";
    case "image-png": return "PNG image";
    case "text": return "text file";
    case "docx": return "Word document";
  }
}

/** Which targets can we technically produce for a given input kind? */
export function getAvailableTargetsForKind(kind: ConvertibleKind): ConvertTargetSpec[] {
  const spec = (t: ConvertTarget): ConvertTargetSpec => ({ target: t, ...TARGET_SPECS[t] });
  switch (kind) {
    case "image-jpg":
    case "image-png":
      return [spec("pdf"), spec("docx"), spec("pptx")];
    case "text":
      return [spec("pdf"), spec("txt"), spec("docx"), spec("xlsx"), spec("pptx")];
    case "docx":
      return [spec("pdf"), spec("txt"), spec("html"), spec("xlsx"), spec("pptx")];
  }
}

// ─── Image → PDF ───────────────────────────────────────────────────────────
async function convertImageToPdf(bytes: Uint8Array, kind: "image-jpg" | "image-png"): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const img = kind === "image-jpg" ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
  const [pageW, pageH] = PageSizes.A4;
  const page = pdf.addPage(PageSizes.A4);
  const margin = 36;
  const maxW = pageW - margin * 2;
  const maxH = pageH - margin * 2;
  const ratio = Math.min(maxW / img.width, maxH / img.height, 1);
  const w = img.width * ratio;
  const h = img.height * ratio;
  page.drawImage(img, { x: (pageW - w) / 2, y: (pageH - h) / 2, width: w, height: h });
  return pdf.save();
}

// ─── Text → PDF (with word-wrap and pagination) ───────────────────────────
async function renderTextToPdf(text: string, title?: string): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const [pageW, pageH] = PageSizes.A4;
  const margin = 50;
  const maxW = pageW - margin * 2;
  const fontSize = 11;
  const lineHeight = fontSize * 1.4;

  function wrapLine(line: string): string[] {
    if (!line.trim()) return [""];
    const words = line.split(/\s+/);
    const out: string[] = [];
    let cur = "";
    for (const word of words) {
      const tryLine = cur ? cur + " " + word : word;
      if (font.widthOfTextAtSize(tryLine, fontSize) <= maxW) cur = tryLine;
      else {
        if (cur) out.push(cur);
        if (font.widthOfTextAtSize(word, fontSize) > maxW) {
          let chunk = "";
          for (const ch of word) {
            if (font.widthOfTextAtSize(chunk + ch, fontSize) > maxW) { out.push(chunk); chunk = ch; }
            else chunk += ch;
          }
          cur = chunk;
        } else cur = word;
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  const allLines: string[] = [];
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) allLines.push(...wrapLine(raw));

  let page = pdf.addPage(PageSizes.A4);
  let y = pageH - margin;
  if (title) {
    page.drawText(title, { x: margin, y: y - 14, size: 14, font: fontBold, color: rgb(0, 0, 0) });
    y -= 14 + lineHeight;
  }
  for (const line of allLines) {
    if (y < margin + lineHeight) { page = pdf.addPage(PageSizes.A4); y = pageH - margin; }
    const safe = line.replace(/[^\x00-\xff]/g, "?");
    page.drawText(safe, { x: margin, y: y - fontSize, size: fontSize, font, color: rgb(0.1, 0.1, 0.1) });
    y -= lineHeight;
  }
  return pdf.save();
}

// ─── Helpers for non-PDF targets ───────────────────────────────────────────
async function extractDocxText(bytes: Uint8Array): Promise<string> {
  const buf = Buffer.from(bytes);
  const result = await mammoth.extractRawText({ buffer: buf });
  return (result.value || "").trim();
}

async function extractDocxHtml(bytes: Uint8Array): Promise<string> {
  const buf = Buffer.from(bytes);
  const result = await mammoth.convertToHtml({ buffer: buf });
  return result.value || "";
}

/**
 * Sanitize HTML produced by mammoth. Mammoth output is generally safe
 * structural markup (p, h1-h6, strong, em, ul/ol/li, a, img, table…), but
 * we still defend in depth: drop any <script>/<style>/<iframe>/<object>
 * tags wholesale, and strip every `on*=` event-handler attribute and any
 * `javascript:` URL. The resulting file is downloaded by the student and
 * may be opened in a browser, so we cannot trust the input docx.
 */
function sanitizeHtmlFragment(html: string): string {
  let out = html;
  // Remove dangerous element blocks (with their content).
  out = out.replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "");
  // Self-closing variants of the same.
  out = out.replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select)\b[^>]*\/?>/gi, "");
  // Strip any on* event handler attributes (onclick, onerror, onload, …).
  out = out.replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  // Neutralize javascript:/vbscript:/data: URLs in href/src/srcset/formaction.
  out = out.replace(/\b(href|src|srcset|formaction|action|background|poster)\s*=\s*(["'])\s*(?:javascript|vbscript|data)\s*:[^"']*\2/gi, '$1="#"');
  out = out.replace(/\b(href|src|srcset|formaction|action|background|poster)\s*=\s*(?:javascript|vbscript|data)\s*:[^\s>]*/gi, '$1="#"');
  return out;
}

/** Wrap a body fragment into a tiny standalone HTML document. */
function wrapHtmlDoc(title: string, bodyHtml: string): string {
  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const safeBody = sanitizeHtmlFragment(bodyHtml);
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${safeTitle}</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:800px;margin:24px auto;padding:0 16px;line-height:1.55;color:#1f2937}h1,h2,h3{color:#111827}p{margin:.6em 0}</style>
</head><body>${safeBody}</body></html>`;
}

// ─── Office targets (DOCX / XLSX / PPTX) ───────────────────────────────────

/** Wrap arbitrary text into a real .docx Word document. */
async function textToDocx(text: string, title?: string): Promise<Uint8Array> {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const children: DocxParagraph[] = [];
  if (title) children.push(new DocxParagraph({ text: title, heading: HeadingLevel.HEADING_1 }));
  for (const line of lines) children.push(new DocxParagraph({ children: [new DocxTextRun(line)] }));
  const doc = new DocxDocument({ sections: [{ properties: {}, children }] });
  const buf = await DocxPacker.toBuffer(doc);
  return new Uint8Array(buf);
}

/** Embed an image into a brand new .docx as a single page. */
async function imageToDocx(bytes: Uint8Array, kind: "image-jpg" | "image-png", title?: string): Promise<Uint8Array> {
  // docx requires us to size the image. 600x450 EMU keeps it inside an A4 page.
  const children: any[] = [];
  if (title) children.push(new DocxParagraph({ text: title, heading: HeadingLevel.HEADING_2 }));
  children.push(new DocxParagraph({
    children: [new DocxImageRun({
      data: Buffer.from(bytes),
      transformation: { width: 500, height: 500 },
      type: kind === "image-png" ? "png" : "jpg",
    } as any)],
  }));
  const doc = new DocxDocument({ sections: [{ properties: {}, children }] });
  const buf = await DocxPacker.toBuffer(doc);
  return new Uint8Array(buf);
}

/** Naive CSV row parser (handles quoted fields with embedded commas / quotes). */
function parseCsvRow(line: string): string[] {
  const out: string[] = [];
  let cur = ""; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else {
      if (c === ",") { out.push(cur); cur = ""; }
      else if (c === '"' && cur === "") inQ = true;
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

/** Convert text to xlsx. CSV becomes a real grid; other text goes into one column. */
async function textToXlsx(text: string, isCsv: boolean, sheetName = "Sheet1"): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName.slice(0, 31) || "Sheet1");
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  for (const line of lines) {
    if (isCsv) ws.addRow(parseCsvRow(line));
    else ws.addRow([line]);
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Uint8Array(buf as ArrayBuffer);
}

/** Convert text into a .pptx — chunks become slides (~10 lines per slide). */
async function textToPptx(text: string, title?: string): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  if (title) {
    const slide = pptx.addSlide();
    slide.addText(title, { x: 0.5, y: 2.5, w: 12, h: 1.5, fontSize: 36, bold: true, align: "center" });
  }
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter(l => l.length > 0);
  const PER_SLIDE = 10;
  for (let i = 0; i < lines.length; i += PER_SLIDE) {
    const chunk = lines.slice(i, i + PER_SLIDE).join("\n");
    const slide = pptx.addSlide();
    slide.addText(chunk, { x: 0.5, y: 0.5, w: 12, h: 6.5, fontSize: 18, valign: "top" });
  }
  if (lines.length === 0 && !title) {
    pptx.addSlide().addText("(empty)", { x: 0.5, y: 3, w: 12, h: 1.5, fontSize: 24, align: "center" });
  }
  const buf = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
  return new Uint8Array(buf);
}

/** Embed an image into a single .pptx slide. */
async function imageToPptx(bytes: Uint8Array, kind: "image-jpg" | "image-png", title?: string): Promise<Uint8Array> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";
  const slide = pptx.addSlide();
  if (title) slide.addText(title, { x: 0.5, y: 0.2, w: 12, h: 0.6, fontSize: 20, bold: true });
  const ext = kind === "image-png" ? "png" : "jpeg";
  const dataUri = `data:image/${ext};base64,${Buffer.from(bytes).toString("base64")}`;
  slide.addImage({ data: dataUri, x: 1, y: 1, w: 11, h: 6 });
  const buf = await pptx.write({ outputType: "nodebuffer" }) as Buffer;
  return new Uint8Array(buf);
}

// ─── Public entry-point ────────────────────────────────────────────────────
export interface ConvertResult {
  bytes: Uint8Array;
  outputName: string;
  mimeType: string;
}

/**
 * Converts a file on disk to the requested target format. The caller is
 * responsible for cleaning up the input file. Returns the raw bytes plus the
 * suggested output filename and produced MIME type. Throws if the requested
 * target is not available for this input kind.
 */
export async function convertFile(
  inputPath: string,
  originalName: string,
  target: ConvertTarget,
  mimeType?: string,
): Promise<ConvertResult> {
  const kind = detectConvertibleKind(originalName, mimeType);
  if (!kind) throw new Error("Cannot convert this file type. Supported inputs: JPG, PNG, TXT, MD, CSV, DOCX.");

  const available = getAvailableTargetsForKind(kind);
  if (!available.find(t => t.target === target)) {
    throw new Error(`Cannot convert ${describeConvertibleKind(kind)} to ${target.toUpperCase()}. Available: ${available.map(t => t.target.toUpperCase()).join(", ")}.`);
  }

  const bytes = await fs.readFile(inputPath);
  const stem = path.basename(originalName, path.extname(originalName));
  const spec = TARGET_SPECS[target];

  let outBytes: Uint8Array;

  if (target === "pdf") {
    switch (kind) {
      case "image-jpg":
      case "image-png":
        outBytes = await convertImageToPdf(bytes, kind);
        break;
      case "text":
        outBytes = await renderTextToPdf(bytes.toString("utf8"), stem);
        break;
      case "docx": {
        const text = await extractDocxText(bytes);
        outBytes = await renderTextToPdf(text || "(This Word document had no extractable text.)", stem);
        break;
      }
    }
  } else if (target === "txt") {
    let plain: string;
    if (kind === "docx") plain = await extractDocxText(bytes) || "(This Word document had no extractable text.)";
    else if (kind === "text") plain = bytes.toString("utf8");
    else throw new Error(`Cannot convert ${describeConvertibleKind(kind)} to TXT.`);
    outBytes = new TextEncoder().encode(plain);
  } else if (target === "html") {
    let html: string;
    if (kind === "docx") html = wrapHtmlDoc(stem, await extractDocxHtml(bytes) || "<p><i>No extractable content.</i></p>");
    else throw new Error(`Cannot convert ${describeConvertibleKind(kind)} to HTML.`);
    outBytes = new TextEncoder().encode(html);
  } else if (target === "docx") {
    if (kind === "image-jpg" || kind === "image-png") outBytes = await imageToDocx(bytes, kind, stem);
    else if (kind === "text") outBytes = await textToDocx(bytes.toString("utf8"), stem);
    else if (kind === "docx") {
      // DOCX → DOCX: just hand back the original bytes (already a real .docx).
      outBytes = bytes;
    } else throw new Error(`Cannot convert ${describeConvertibleKind(kind)} to DOCX.`);
  } else if (target === "xlsx") {
    if (kind === "text") {
      const ext = path.extname(originalName).toLowerCase();
      outBytes = await textToXlsx(bytes.toString("utf8"), ext === ".csv", stem);
    } else if (kind === "docx") {
      const txt = await extractDocxText(bytes) || "(empty document)";
      outBytes = await textToXlsx(txt, false, stem);
    } else throw new Error(`Cannot convert ${describeConvertibleKind(kind)} to XLSX.`);
  } else if (target === "pptx") {
    if (kind === "image-jpg" || kind === "image-png") outBytes = await imageToPptx(bytes, kind, stem);
    else if (kind === "text") outBytes = await textToPptx(bytes.toString("utf8"), stem);
    else if (kind === "docx") {
      const txt = await extractDocxText(bytes) || "(empty document)";
      outBytes = await textToPptx(txt, stem);
    } else throw new Error(`Cannot convert ${describeConvertibleKind(kind)} to PPTX.`);
  } else {
    throw new Error(`Unknown target: ${target}`);
  }

  return { bytes: outBytes!, outputName: `${stem}.${spec.ext}`, mimeType: spec.mime };
}

/** Back-compat: existing callers expecting a PDF-only API. */
export async function convertFileToPdf(
  inputPath: string,
  originalName: string,
  mimeType?: string,
): Promise<{ pdfBytes: Uint8Array; outputName: string }> {
  const r = await convertFile(inputPath, originalName, "pdf", mimeType);
  return { pdfBytes: r.bytes, outputName: r.outputName };
}
