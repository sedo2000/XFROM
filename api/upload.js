// api/upload.js
// وحدة مساعدة (ليست نقطة نهاية Vercel) — تتعامل مع رفع/تنزيل الملفات من تلجرام
// وتنفّذ عمليات المعالجة الفعلية على ملفات PDF والصور باستخدام pdf-lib و JSZip.
// يتم استيراد هذه الدوال داخل api/index.js فقط.

const { PDFDocument, degrees, rgb, StandardFonts } = require('pdf-lib');
const JSZip = require('jszip');

const BOT_TOKEN = process.env.BOT_TOKEN;
const TG_API = `https://api.telegram.org/bot${BOT_TOKEN}`;
const TG_FILE = `https://api.telegram.org/file/bot${BOT_TOKEN}`;

/* ================= Telegram I/O ================= */

async function tgCall(method, payload) {
  const res = await fetch(`${TG_API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    console.error(`Telegram API error [${method}]:`, data.description);
  }
  return data;
}

function sendMessage(chatId, text, keyboard) {
  return tgCall('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

function editMessage(chatId, messageId, text, keyboard) {
  return tgCall('editMessageText', {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
    reply_markup: keyboard ? { inline_keyboard: keyboard } : undefined,
  });
}

function answerCallback(callbackId, text) {
  return tgCall('answerCallbackQuery', {
    callback_query_id: callbackId,
    text: text || undefined,
    show_alert: false,
  });
}

async function getFileBuffer(fileId) {
  const info = await tgCall('getFile', { file_id: fileId });
  if (!info.ok) throw new Error('تعذّر جلب معلومات الملف من تلجرام');
  const filePath = info.result.file_path;
  const res = await fetch(`${TG_FILE}/${filePath}`);
  const arrayBuf = await res.arrayBuffer();
  return Buffer.from(arrayBuf);
}

async function sendDocumentBuffer(chatId, buffer, filename, caption) {
  const form = new FormData();
  form.append('chat_id', String(chatId));
  if (caption) form.append('caption', caption);
  form.append('document', new Blob([buffer]), filename);
  const res = await fetch(`${TG_API}/sendDocument`, { method: 'POST', body: form });
  return res.json();
}

function humanSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
}

function parsePageRanges(str, maxPage) {
  const out = new Set();
  str.split(',').forEach(part => {
    part = part.trim();
    if (!part) return;
    if (part.includes('-')) {
      const [a, b] = part.split('-').map(n => parseInt(n.trim(), 10));
      if (Number.isFinite(a) && Number.isFinite(b)) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
          if (i >= 1 && i <= maxPage) out.add(i);
        }
      }
    } else {
      const n = parseInt(part, 10);
      if (Number.isFinite(n) && n >= 1 && n <= maxPage) out.add(n);
    }
  });
  return [...out].sort((a, b) => a - b);
}

/* ================= PDF / image processing ================= */

async function mergePdfs(buffers) {
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach(p => out.addPage(p));
  }
  const bytes = await out.save();
  return { buffer: Buffer.from(bytes), filename: 'merged.pdf', note: `تم دمج ${buffers.length} ملف في ملف واحد` };
}

async function splitPdf(buf) {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const n = src.getPageCount();
  const zip = new JSZip();
  for (let i = 0; i < n; i++) {
    const doc = await PDFDocument.create();
    const [p] = await doc.copyPages(src, [i]);
    doc.addPage(p);
    zip.file(`page-${i + 1}.pdf`, await doc.save());
  }
  const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
  return { buffer: zipBuf, filename: 'split-pages.zip', note: `تم تقسيم الملف إلى ${n} صفحة منفصلة` };
}

async function compressPdf(buf) {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true, updateMetadata: false });
  const out = await src.save({ useObjectStreams: true });
  const before = buf.length, after = out.byteLength;
  const pct = before > 0 ? Math.max(0, Math.round((1 - after / before) * 100)) : 0;
  return {
    buffer: Buffer.from(out),
    filename: 'compressed.pdf',
    note: `الحجم الأصلي ${humanSize(before)} ← بعد الضغط ${humanSize(after)} (${pct}% أقل تقريبًا)`,
  };
}

async function rotatePdf(buf, angle) {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  doc.getPages().forEach(p => {
    const cur = p.getRotation().angle;
    p.setRotation(degrees((cur + angle) % 360));
  });
  const out = await doc.save();
  return { buffer: Buffer.from(out), filename: 'rotated.pdf', note: `تم تدوير جميع الصفحات ${angle}°` };
}

async function repairPdf(buf) {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true, throwOnInvalidObject: false });
  const out = await doc.save();
  return { buffer: Buffer.from(out), filename: 'repaired.pdf', note: 'تمت إعادة بناء الملف بنجاح' };
}

async function insertPages(baseBuf, insertBuf, insertAt) {
  const base = await PDFDocument.load(baseBuf, { ignoreEncryption: true });
  const insertDoc = await PDFDocument.load(insertBuf, { ignoreEncryption: true });
  const insertedPages = await base.copyPages(insertDoc, insertDoc.getPageIndices());
  const idx = Math.min(Math.max(insertAt, 0), base.getPageCount());
  insertedPages.forEach((p, i) => base.insertPage(idx + i, p));
  const out = await base.save();
  return { buffer: Buffer.from(out), filename: 'inserted.pdf', note: `تم إدراج ${insertedPages.length} صفحة بعد الصفحة ${insertAt}` };
}

async function watermarkPdf(buf, text, size = 48) {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.HelveticaBold);
  doc.getPages().forEach(p => {
    const { width, height } = p.getSize();
    p.drawText(text, {
      x: width / 2 - (text.length * size) / 4,
      y: height / 2,
      size, font,
      color: rgb(0.6, 0.6, 0.6),
      opacity: 0.3,
      rotate: degrees(45),
    });
  });
  const out = await doc.save();
  return { buffer: Buffer.from(out), filename: 'watermarked.pdf', note: 'تمت إضافة العلامة المائية لجميع الصفحات' };
}

async function pageNumbersPdf(buf, pos) {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const { width } = p.getSize();
    const label = `${i + 1} / ${pages.length}`;
    let x = width / 2 - 15;
    if (pos === 'bottom-right') x = width - 60;
    if (pos === 'bottom-left') x = 30;
    p.drawText(label, { x, y: 20, size: 11, font, color: rgb(0.2, 0.2, 0.2) });
  });
  const out = await doc.save();
  return { buffer: Buffer.from(out), filename: 'numbered.pdf', note: `تم ترقيم ${pages.length} صفحة` };
}

async function cropPdf(buf, pct) {
  const doc = await PDFDocument.load(buf, { ignoreEncryption: true });
  doc.getPages().forEach(p => {
    const { width, height } = p.getSize();
    const dx = width * (pct / 100), dy = height * (pct / 100);
    p.setCropBox(dx, dy, width - 2 * dx, height - 2 * dy);
  });
  const out = await doc.save();
  return { buffer: Buffer.from(out), filename: 'cropped.pdf', note: `تم قص ${pct}% من هوامش كل صفحة` };
}

async function splitRangePdf(buf, splitAt) {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const n = src.getPageCount();
  if (splitAt < 1 || splitAt >= n) throw new Error(`رقم الصفحة يجب أن يكون بين 1 و ${n - 1}`);
  const zip = new JSZip();
  const part1 = await PDFDocument.create();
  (await part1.copyPages(src, [...Array(splitAt).keys()])).forEach(p => part1.addPage(p));
  zip.file('part-1.pdf', await part1.save());
  const part2 = await PDFDocument.create();
  const rest = [...Array(n).keys()].slice(splitAt);
  (await part2.copyPages(src, rest)).forEach(p => part2.addPage(p));
  zip.file('part-2.pdf', await part2.save());
  const zipBuf = await zip.generateAsync({ type: 'nodebuffer' });
  return { buffer: zipBuf, filename: 'split-range.zip', note: `تم التقسيم إلى جزأين عند الصفحة ${splitAt}` };
}

async function extractPagesPdf(buf, rangeStr) {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const n = src.getPageCount();
  const pageNums = parsePageRanges(rangeStr, n);
  if (pageNums.length === 0) throw new Error('لم يتم العثور على صفحات صالحة ضمن هذا النطاق');
  const out = await PDFDocument.create();
  const idxs = pageNums.map(p => p - 1);
  (await out.copyPages(src, idxs)).forEach(p => out.addPage(p));
  const outBytes = await out.save();
  return { buffer: Buffer.from(outBytes), filename: 'extracted.pdf', note: `تم استخراج ${pageNums.length} صفحة: ${pageNums.join(', ')}` };
}

async function imagesToPdf(buffers, mimeTypes) {
  const doc = await PDFDocument.create();
  for (let i = 0; i < buffers.length; i++) {
    const mime = mimeTypes[i] || '';
    let img;
    if (mime.includes('png')) img = await doc.embedPng(buffers[i]);
    else img = await doc.embedJpg(buffers[i]); // Telegram photos are JPEG by default
    const page = doc.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  const out = await doc.save();
  return { buffer: Buffer.from(out), filename: 'images.pdf', note: `تم تحويل ${buffers.length} صورة إلى ملف PDF واحد` };
}

module.exports = {
  sendMessage,
  editMessage,
  answerCallback,
  getFileBuffer,
  sendDocumentBuffer,
  humanSize,
  mergePdfs,
  splitPdf,
  compressPdf,
  rotatePdf,
  repairPdf,
  insertPages,
  watermarkPdf,
  pageNumbersPdf,
  cropPdf,
  splitRangePdf,
  extractPagesPdf,
  imagesToPdf,
};
