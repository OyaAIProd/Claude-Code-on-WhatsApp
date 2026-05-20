const fs = require("fs");
const path = require("path");

let pdfParse = null, mammoth = null, xlsx = null, JSZip = null;
try { pdfParse = require("pdf-parse"); } catch {}
try { mammoth = require("mammoth"); } catch {}
try { xlsx = require("xlsx"); } catch {}
try { JSZip = require("jszip"); } catch {}

function getExt(filePath) {
  return path.extname(filePath || "").toLowerCase().replace(".", "");
}

async function extractPdf(buf) {
  if (!pdfParse) throw new Error("pdf-parse not installed");
  const data = await pdfParse(buf, { max: 200 });
  return { text: data.text || "", pages: data.numpages, info: data.info || {} };
}

async function extractDocx(buf) {
  if (!mammoth) throw new Error("mammoth not installed");
  const result = await mammoth.extractRawText({ buffer: buf });
  return { text: result.value || "", warnings: (result.messages || []).slice(0, 5).map(m => m.message) };
}

async function extractXlsx(buf) {
  if (!xlsx) throw new Error("xlsx not installed");
  const wb = xlsx.read(buf, { type: "buffer", cellDates: true });
  const sheets = [];
  let totalRows = 0;
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const csv = xlsx.utils.sheet_to_csv(ws, { strip: false });
    const rows = csv.split("\n").filter(l => l.trim()).length;
    totalRows += rows;
    sheets.push({ name, rows, csv: csv.slice(0, 8000) });
  }
  const text = sheets.map(s => `### Sheet: ${s.name} (${s.rows} rows)\n${s.csv}`).join("\n\n");
  return { text, sheets: wb.SheetNames, totalRows };
}

async function extractPptx(buf) {
  if (!JSZip) throw new Error("jszip not installed");
  const zip = await JSZip.loadAsync(buf);
  const slides = [];
  const slideFiles = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const an = parseInt(a.match(/slide(\d+)/)[1], 10);
      const bn = parseInt(b.match(/slide(\d+)/)[1], 10);
      return an - bn;
    });
  for (const sf of slideFiles) {
    const xml = await zip.file(sf).async("string");
    const texts = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map(m => m[1]);
    if (texts.length) slides.push({ num: slides.length + 1, text: texts.join(" ") });
  }
  const text = slides.map(s => `### Slide ${s.num}\n${s.text}`).join("\n\n");
  return { text, slideCount: slides.length };
}

async function extractTxt(buf) {
  return { text: buf.toString("utf8").slice(0, 80000) };
}

async function extractCsv(buf) {
  const text = buf.toString("utf8").slice(0, 80000);
  const lines = text.split("\n").length;
  return { text, lines };
}

async function extractJson(buf) {
  try {
    const obj = JSON.parse(buf.toString("utf8"));
    return { text: JSON.stringify(obj, null, 2).slice(0, 30000), valid: true };
  } catch {
    return { text: buf.toString("utf8").slice(0, 30000), valid: false };
  }
}

const EXTRACTORS = {
  pdf: extractPdf,
  docx: extractDocx,
  xlsx: extractXlsx,
  xlsm: extractXlsx,
  pptx: extractPptx,
  txt: extractTxt,
  md: extractTxt,
  log: extractTxt,
  csv: extractCsv,
  json: extractJson,
  js: extractTxt,
  ts: extractTxt,
  py: extractTxt,
  yaml: extractTxt,
  yml: extractTxt,
  xml: extractTxt,
  html: extractTxt,
  css: extractTxt
};

async function analyzeFile(filePath) {
  const ext = getExt(filePath);
  const extractor = EXTRACTORS[ext];
  if (!extractor) return { ok: false, error: `Format .${ext} belum support`, ext };
  try {
    const buf = fs.readFileSync(filePath);
    const sizeKb = (buf.length / 1024).toFixed(1);
    const result = await extractor(buf);
    const text = (result.text || "").trim();
    if (!text) return { ok: false, error: "Extracted text kosong", ext, sizeKb };
    const meta = {};
    if (result.pages) meta.pages = result.pages;
    if (result.sheets) meta.sheets = result.sheets;
    if (result.totalRows) meta.totalRows = result.totalRows;
    if (result.slideCount) meta.slideCount = result.slideCount;
    if (result.lines) meta.lines = result.lines;
    const cachePath = filePath + ".extracted.txt";
    try { fs.writeFileSync(cachePath, text); } catch {}
    return { ok: true, ext, sizeKb, text, length: text.length, preview: text.slice(0, 500), meta, cachePath };
  } catch (err) {
    return { ok: false, error: err.message, ext };
  }
}

function getCachedExtraction(filePath) {
  const cachePath = filePath + ".extracted.txt";
  if (fs.existsSync(cachePath)) {
    try {
      const text = fs.readFileSync(cachePath, "utf8");
      return { ok: true, text, cachePath, length: text.length };
    } catch {}
  }
  return null;
}

function isAnalyzable(filePathOrName) {
  const ext = getExt(filePathOrName);
  return !!EXTRACTORS[ext];
}

module.exports = { analyzeFile, getCachedExtraction, isAnalyzable, EXTRACTORS };
