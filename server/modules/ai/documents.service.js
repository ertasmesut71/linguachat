const config = require("../../config");
const mediaService = require("../media/media.service");
const storage = require("../../utils/storage");

// ─── Lazy parsers so tests / non-doc routes don't pay startup cost ───
let _pdfParseMod = null;
let _mammothMod = null;
let _xlsxMod = null;

function pdfParser() {
  if (!_pdfParseMod) _pdfParseMod = require("pdf-parse");
  return _pdfParseMod;
}
function mammoth() {
  if (!_mammothMod) _mammothMod = require("mammoth");
  return _mammothMod;
}
function xlsx() {
  if (!_xlsxMod) _xlsxMod = require("xlsx");
  return _xlsxMod;
}

const LANG_NAMES = {
  en:"English",tr:"Turkish",es:"Spanish",fr:"French",de:"German",
  ja:"Japanese",zh:"Chinese",ar:"Arabic",ko:"Korean",pt:"Portuguese",
  ru:"Russian",hi:"Hindi",it:"Italian",nl:"Dutch",pl:"Polish",
};
function langName(code) { return LANG_NAMES[code] || code || "English"; }

// Max characters of extracted text we'll pass to Claude in a single prompt.
// Claude Sonnet handles 200K tokens; cap extraction to ~200K chars (~50K tokens)
// for reliability and cost control. Truncate long docs with a clear marker.
const MAX_EXTRACT_CHARS = 200_000;

function truncateForModel(text) {
  if (!text) return "";
  if (text.length <= MAX_EXTRACT_CHARS) return text;
  const head = text.slice(0, Math.floor(MAX_EXTRACT_CHARS * 0.8));
  const tail = text.slice(-Math.floor(MAX_EXTRACT_CHARS * 0.2));
  return `${head}\n\n[...document truncated, ${text.length - MAX_EXTRACT_CHARS} chars skipped...]\n\n${tail}`;
}

// ═══════════════════════════════════════════════
// EXTRACTORS
// ═══════════════════════════════════════════════

async function extractPdf(buffer) {
  try {
    const { PDFParse } = pdfParser();
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    const result = await parser.getText();
    const text = (result?.text || "").trim();
    const pages = result?.pages?.length || result?.total || null;
    return { text, pages, kind: "pdf" };
  } catch (err) {
    throw new Error(`PDF extraction failed: ${err.message}`);
  }
}

async function extractDocx(buffer) {
  try {
    const result = await mammoth().extractRawText({ buffer });
    return { text: (result.value || "").trim(), kind: "docx" };
  } catch (err) {
    throw new Error(`DOCX extraction failed: ${err.message}`);
  }
}

async function extractXlsx(buffer) {
  try {
    const XLSX = xlsx();
    const wb = XLSX.read(buffer, { type: "buffer" });
    const parts = [];
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const csv = XLSX.utils.sheet_to_csv(sheet);
      parts.push(`=== Sheet: ${sheetName} ===\n${csv}`);
    }
    return { text: parts.join("\n\n").trim(), sheets: wb.SheetNames, kind: "xlsx" };
  } catch (err) {
    throw new Error(`XLSX extraction failed: ${err.message}`);
  }
}

async function extractText(buffer) {
  return { text: buffer.toString("utf-8").trim(), kind: "text" };
}

/**
 * Route a buffer + MIME to the right extractor.
 * Returns { text, kind, pages?, sheets? }.
 */
async function extractByMime(buffer, mimeType, originalName = "") {
  const name = (originalName || "").toLowerCase();

  if (mimeType === "application/pdf" || name.endsWith(".pdf")) {
    return extractPdf(buffer);
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    return extractDocx(buffer);
  }
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel" ||
    name.endsWith(".xlsx") || name.endsWith(".xls")
  ) {
    return extractXlsx(buffer);
  }
  if (
    mimeType === "text/plain" || mimeType === "text/markdown" ||
    mimeType === "text/csv" || mimeType === "application/json" ||
    name.endsWith(".txt") || name.endsWith(".md") ||
    name.endsWith(".csv") || name.endsWith(".json") || name.endsWith(".rtf")
  ) {
    return extractText(buffer);
  }

  throw new Error(`Unsupported document type for extraction: ${mimeType}`);
}

// ═══════════════════════════════════════════════
// CLAUDE CALLERS
// ═══════════════════════════════════════════════

async function callClaudeText(prompt, maxTokens = 1500) {
  if (!config.anthropic.apiKey) {
    return null; // caller handles mock fallback
  }
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.anthropic.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.anthropic.model,
      max_tokens: maxTokens,
      messages: [{ role: "user", content: prompt }],
    }),
  });
  if (!resp.ok) throw new Error(`Claude API ${resp.status}`);
  const data = await resp.json();
  return data.content?.[0]?.text?.trim() || "";
}

async function callClaudeVision(prompt, imageBase64, mediaType, maxTokens = 1500) {
  if (!config.anthropic.apiKey) return null;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.anthropic.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: config.anthropic.model,
      max_tokens: maxTokens,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: imageBase64 } },
          { type: "text", text: prompt },
        ],
      }],
    }),
  });
  if (!resp.ok) throw new Error(`Claude API ${resp.status}`);
  const data = await resp.json();
  return data.content?.[0]?.text?.trim() || "";
}

// ═══════════════════════════════════════════════
// PUBLIC SERVICE
// ═══════════════════════════════════════════════

class DocumentsService {
  /**
   * Summarize a file stored in /api/media by fileId.
   * Returns { summary, kind, lang, originalName, pages?, sheets?, truncated }
   */
  async summarizeFile(fileId, targetLang = "en") {
    const file = await mediaService.get(fileId);
    if (!file) throw new Error("File not found");

    const extracted = await extractByMime(
      file.buffer,
      file.contentType,
      file.metadata?.originalName || "",
    );

    if (!extracted.text) {
      return {
        summary: "This document appears to be empty or contains only non-text content (e.g. scanned pages).",
        kind: extracted.kind,
        lang: targetLang,
        originalName: file.metadata?.originalName || "",
        empty: true,
      };
    }

    const truncated = extracted.text.length > MAX_EXTRACT_CHARS;
    const body = truncateForModel(extracted.text);

    const prompt = `You are summarizing a document for a chat user.

Write a concise summary in ${langName(targetLang)}. Structure:

1. A single-sentence headline describing what this document is.
2. 4–7 bullet points covering the most important points, decisions, figures, dates, or arguments.
3. One short line at the end labeled "Action items:" listing any tasks, deadlines, or follow-ups that are explicitly mentioned. Write "Action items: (none)" if there are no tasks.

Be specific, not generic. Quote important numbers/dates/names verbatim. Do not invent content that is not in the document.

Document contents:
${body}`;

    let summary;
    try {
      summary = await callClaudeText(prompt, 1500);
      if (!summary) summary = this._mockSummary(extracted, targetLang);
    } catch (err) {
      summary = `[Summary unavailable: ${err.message}]`;
    }

    return {
      summary,
      kind: extracted.kind,
      lang: targetLang,
      originalName: file.metadata?.originalName || "",
      pages: extracted.pages,
      sheets: extracted.sheets,
      truncated,
    };
  }

  /**
   * Answer a question about a document.
   * Always replies in targetLang so cross-lingual Q&A works.
   */
  async askFile(fileId, question, targetLang = "en") {
    if (!question?.trim()) throw new Error("Question is required");

    const file = await mediaService.get(fileId);
    if (!file) throw new Error("File not found");

    const extracted = await extractByMime(
      file.buffer,
      file.contentType,
      file.metadata?.originalName || "",
    );

    if (!extracted.text) {
      return {
        answer: "This document appears to be empty or contains only non-text content, so I cannot answer questions about it.",
        kind: extracted.kind,
        lang: targetLang,
      };
    }

    const body = truncateForModel(extracted.text);
    const prompt = `You are answering questions about a document on behalf of a chat user.

RULES:
- Use ONLY information that appears in the document. Do not invent facts.
- If the document does not contain the answer, say so clearly in ${langName(targetLang)}.
- Answer in ${langName(targetLang)} regardless of the document's original language.
- Keep answers focused and short. Quote or cite specific numbers/dates/names when relevant.

Document contents:
${body}

User's question:
${question}`;

    let answer;
    try {
      answer = await callClaudeText(prompt, 1200);
      if (!answer) answer = `[AI disabled. Question: ${question}]`;
    } catch (err) {
      answer = `[Unable to answer: ${err.message}]`;
    }

    return { answer, kind: extracted.kind, lang: targetLang };
  }

  /**
   * Run OCR + optional translation on an uploaded image.
   * Uses Claude's vision capability — no extra dependency.
   */
  async ocrImage(fileId, targetLang = "en") {
    const file = await mediaService.get(fileId);
    if (!file) throw new Error("File not found");
    if (!file.contentType?.startsWith("image/")) {
      throw new Error("OCR only supported for images");
    }

    const supportedMimes = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    const mediaType = supportedMimes.includes(file.contentType) ? file.contentType : "image/jpeg";

    const prompt = `Extract ALL visible text from this image exactly as it appears, preserving line breaks where meaningful.

Then, on a new section after a line of three dashes (---), translate the extracted text into ${langName(targetLang)}. If the original text is already in ${langName(targetLang)}, write "(already in ${langName(targetLang)})" in the translation section.

Output format:

EXTRACTED TEXT:
<verbatim text from image>

---

TRANSLATION (${langName(targetLang)}):
<translated text or marker>`;

    if (!config.anthropic.apiKey) {
      return {
        extracted: "[OCR disabled — set ANTHROPIC_API_KEY to enable]",
        translated: "",
        lang: targetLang,
      };
    }

    try {
      const base64 = file.buffer.toString("base64");
      const full = await callClaudeVision(prompt, base64, mediaType, 2000);
      const parts = (full || "").split(/\n-{3,}\n/);
      const extracted = (parts[0] || "").replace(/^EXTRACTED TEXT:\s*/i, "").trim();
      const translated = (parts[1] || "").replace(/^TRANSLATION[^:]*:\s*/i, "").trim();
      return {
        extracted: extracted || full || "",
        translated,
        lang: targetLang,
      };
    } catch (err) {
      return {
        extracted: `[OCR failed: ${err.message}]`,
        translated: "",
        lang: targetLang,
      };
    }
  }

  /**
   * Extract action items / tasks from a chat or from an arbitrary text block.
   * Returns an array: [{ task, owner?, dueDate?, priority? }, ...]
   */
  async extractTasksFromText(text, targetLang = "en") {
    if (!text?.trim()) return [];

    const prompt = `Extract a list of action items (tasks, to-dos, follow-ups) from the text below.

Return ONLY a JSON array. Each element must have:
  - task (string, in ${langName(targetLang)})
  - owner (string or null — who owns the task if mentioned)
  - dueDate (string or null — ISO date or natural-language date if mentioned)
  - priority ("high" | "medium" | "low" | null)

If there are no tasks, return [].

Do NOT include explanations, preamble, or markdown. JSON only.

Text:
${text}`;

    if (!config.anthropic.apiKey) return [];

    try {
      const raw = await callClaudeText(prompt, 1200);
      const cleaned = (raw || "").replace(/```json|```/g, "").trim();
      const parsed = JSON.parse(cleaned);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  _mockSummary(extracted, lang) {
    const n = extracted.text.length;
    return `[Mock summary, ${lang}]\nDocument kind: ${extracted.kind}\nText length: ${n} characters\n(Set ANTHROPIC_API_KEY for real AI summaries.)`;
  }

  // Helpers exposed for controller-level logic & tests
  extract(buffer, mime, name) { return extractByMime(buffer, mime, name); }
}

module.exports = new DocumentsService();
