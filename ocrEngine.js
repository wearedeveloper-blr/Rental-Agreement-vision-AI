/**
 * ocrEngine.js — Tesseract.js OCR + PDF.js text extraction
 *
 * Loads Tesseract / PDF.js from CDN only when needed.
 * Returns the extracted text string.
 */

let tesseractLoaded = false;
let Tesseract = null;

let pdfJsLoaded = false;
let pdfjsLib = null;

const PDFJS_CDN = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/legacy/build/pdf.min.mjs";
const PDFJS_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/legacy/build/pdf.worker.min.mjs";

async function loadPDFJS() {
  if (pdfJsLoaded) return true;
  try {
    const mod = await import(PDFJS_CDN);
    pdfjsLib = mod;
    pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
    pdfJsLoaded = true;
    return true;
  } catch (err) {
    console.warn("PDF.js failed to load:", err);
    return false;
  }
}

export async function loadTesseract() {
  if (tesseractLoaded) return true;
  return new Promise((resolve) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
    script.onload = () => {
      Tesseract = window.Tesseract;
      tesseractLoaded = true;
      resolve(true);
    };
    script.onerror = () => resolve(false);
    document.head.appendChild(script);
  });
}

/**
 * Extracts text from an image File object using Tesseract.js.
 * Falls back gracefully if OCR library fails to load.
 *
 * @param {File} file - image file
 * @param {function} onProgress - progress callback (0–100)
 * @returns {Promise<{text: string, confidence: number, fallback: boolean}>}
 */
export async function extractTextFromImage(file, onProgress = () => {}) {
  const loaded = await loadTesseract();
  if (!loaded || !Tesseract) {
    return { text: "", confidence: 0, fallback: true };
  }

  try {
    const result = await Tesseract.recognize(file, "eng", {
      logger: (m) => {
        if (m.status === "recognizing text") {
          onProgress(Math.round(m.progress * 100));
        }
      },
    });

    const text = result.data.text || "";
    const confidence = result.data.confidence || 0;
    return { text: text.trim(), confidence: Math.round(confidence), fallback: false };
  } catch (err) {
    console.warn("OCR failed:", err);
    return { text: "", confidence: 0, fallback: true };
  }
}

/**
 * Renders a single PDF page to an offscreen canvas and returns a Blob for OCR.
 */
async function renderPageToBlob(page, scale = 2) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

/**
 * Reads a PDF and returns the concatenated text from all pages.
 *
 * Strategy:
 *   1. Try to extract the native text layer (fast, works for digital PDFs).
 *   2. If a page has no text (scanned/image-based), render it to a canvas and
 *      run Tesseract OCR on the resulting image.
 *
 * @param {File} file
 * @param {function} onProgress - progress callback (0–100)
 * @returns {Promise<{text: string, pageCount: number, fallback: boolean}>}
 */
export async function extractTextFromPDF(file, onProgress = () => {}) {
  const loaded = await loadPDFJS();
  if (!loaded || !pdfjsLib) {
    return { text: "", pageCount: 0, fallback: true };
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer, useSystemFonts: true }).promise;
    const pageCount = pdf.numPages;
    const pageTexts = [];

    for (let p = 1; p <= pageCount; p++) {
      const page = await pdf.getPage(p);

      // Try native text layer first
      const content = await page.getTextContent();
      let pageText = content.items.map((item) => item.str).join(" ").trim();

      // If the text layer is empty (scanned page), fall back to OCR
      if (!pageText) {
        const tesseractReady = await loadTesseract();
        if (tesseractReady && Tesseract) {
          const blob = await renderPageToBlob(page);
          const ocrResult = await Tesseract.recognize(blob, "eng", {
            logger: (m) => {
              if (m.status === "recognizing text") {
                // Map inner OCR progress within this page's share of the total
                const baseProgress = Math.round(((p - 1) / pageCount) * 100);
                const pageShare = Math.round((1 / pageCount) * m.progress * 100);
                onProgress(Math.min(99, baseProgress + pageShare));
              }
            },
          });
          pageText = (ocrResult.data.text || "").trim();
        }
      }

      pageTexts.push(pageText);
      onProgress(Math.round((p / pageCount) * 100));
    }

    const text = pageTexts.filter(Boolean).join("\n\n--- Page ---\n\n");
    return { text, pageCount, fallback: false };
  } catch (err) {
    console.warn("PDF extraction failed:", err);
    return { text: "", pageCount: 0, fallback: true };
  }
}

/**
 * Checks if a File is an image type we can OCR.
 */
export function isImageFile(file) {
  return /^image\/(jpeg|jpg|png|webp|gif|bmp|tiff?)$/i.test(file.type);
}

/**
 * Checks if a file is a PDF.
 */
export function isPDFFile(file) {
  return file.type === "application/pdf";
}
