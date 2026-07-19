// api/index.js
// نقطة نهاية الويبهوك الرئيسية لبوت تلجرام (Xform Bot)
// يستقبل تحديثات تلجرام (رسائل + أزرار Inline) ويدير قوائم التنقل ومعالجة الملفات.
//
// متغيرات البيئة المطلوبة (تُضبط من إعدادات المشروع في Vercel):
//   BOT_TOKEN         -> توكن البوت من BotFather
//   DEV_ID            -> آيدي حساب المطوّر على تلجرام (لإشعارات الأخطاء)
//   WEBHOOK_SECRET     -> (اختياري) سر تحقق من صحة طلبات تلجرام

const U = require('./upload.js');

const DEV_ID = process.env.DEV_ID;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

/* ================= تعريف الأدوات ================= */

const TOOLS = [
  { id: 'merge', cat: 'pdf', name: 'دمج ملفات PDF', emoji: '➕', desc: 'اجمع عدة ملفات PDF في ملف واحد بالترتيب الذي ترسله.', multi: true, accept: 'pdf', status: 'ready' },
  { id: 'split', cat: 'pdf', name: 'تقسيم PDF', emoji: '✂️', desc: 'قسّم ملف PDF إلى ملفات منفصلة (كل صفحة في ملف) داخل أرشيف ZIP.', accept: 'pdf', status: 'ready' },
  { id: 'compress', cat: 'pdf', name: 'ضغط PDF', emoji: '🗜️', desc: 'قلّل حجم ملف PDF عبر إعادة بنائه الداخلية.', accept: 'pdf', status: 'ready' },
  { id: 'rotate', cat: 'pdf', name: 'تدوير PDF', emoji: '🔄', desc: 'دوّر جميع صفحات الملف بزاوية تختارها.', accept: 'pdf', status: 'ready',
    options: [{ key: 'angle', type: 'buttons', prompt: 'اختر زاوية الدوران:', choices: [{ label: '90°', value: 90 }, { label: '180°', value: 180 }, { label: '270°', value: 270 }] }] },
  { id: 'repair', cat: 'pdf', name: 'إصلاح PDF', emoji: '🔧', desc: 'يحاول إعادة بناء ملف PDF تالف أو لا يفتح بشكل صحيح.', accept: 'pdf', status: 'ready' },
  { id: 'insert', cat: 'pdf', name: 'إدراج صفحات', emoji: '📄', desc: 'أدرج صفحات ملف PDF آخر داخل ملفك في موضع محدد.', accept: 'pdf', status: 'ready', custom: 'insert' },
  { id: 'watermark', cat: 'pdf', name: 'إضافة علامة مائية', emoji: '💧', desc: 'ضع نصًا شفافًا كعلامة مائية على كل الصفحات.', accept: 'pdf', status: 'ready',
    options: [{ key: 'text', type: 'text', prompt: 'أرسل نص العلامة المائية:', validate: (s) => ({ ok: true, value: (s || '').trim() || 'محوّل' }) }] },
  { id: 'pagenumbers', cat: 'pdf', name: 'ترقيم الصفحات', emoji: '#️⃣', desc: 'أضف أرقام الصفحات تلقائيًا في الزاوية التي تختارها.', accept: 'pdf', status: 'ready',
    options: [{ key: 'pos', type: 'buttons', prompt: 'اختر موضع الترقيم:', choices: [{ label: 'المنتصف', value: 'center' }, { label: 'أسفل يمين', value: 'bottom-right' }, { label: 'أسفل يسار', value: 'bottom-left' }] }] },
  { id: 'crop', cat: 'pdf', name: 'قص PDF', emoji: '✂️', desc: 'قصّ هوامش صفحات الملف بنسبة مئوية من كل جانب.', accept: 'pdf', status: 'ready',
    options: [{ key: 'pct', type: 'text', prompt: 'أرسل نسبة القص المئوية (مثال: 10):', validate: (s) => { const n = parseInt(s, 10); return (Number.isFinite(n) && n >= 0 && n < 50) ? { ok: true, value: n } : { ok: false, error: 'أدخل رقمًا صحيحًا بين 0 و 49' }; } }] },
  { id: 'splitrange', cat: 'pdf', name: 'تقسيم نطاق صفحات', emoji: '📑', desc: 'قسّم الملف إلى نطاقين حسب رقم صفحة تحدده.', accept: 'pdf', status: 'ready',
    options: [{ key: 'splitAt', type: 'text', prompt: 'أرسل رقم الصفحة التي تريد التقسيم عندها:', validate: (s) => { const n = parseInt(s, 10); return (Number.isFinite(n) && n >= 1) ? { ok: true, value: n } : { ok: false, error: 'أدخل رقم صفحة صحيح' }; } }] },
  { id: 'extract', cat: 'pdf', name: 'استخراج صفحات محددة', emoji: '📌', desc: 'استخرج صفحات معينة فقط (مثال: 1,3,5-8) إلى ملف جديد.', accept: 'pdf', status: 'ready',
    options: [{ key: 'range', type: 'text', prompt: 'أرسل أرقام الصفحات (مثال: 1,3,5-8):', validate: (s) => (s && s.trim()) ? { ok: true, value: s.trim() } : { ok: false, error: 'أدخل نطاق صفحات صالح' } }] },

  { id: 'img2pdf', cat: 'image', name: 'صور إلى PDF', emoji: '📸', desc: 'حوّل صورة أو أكثر إلى ملف PDF واحد بالترتيب.', multi: true, accept: 'image', status: 'ready' },
  { id: 'pdf2img', cat: 'image', name: 'PDF إلى صور', emoji: '🖼️', desc: 'تحويل صفحات PDF إلى صور PNG.', status: 'soon' },
  { id: 'scan2pdf', cat: 'image', name: 'صور ممسوحة ضوئيًا إلى PDF', emoji: '📠', desc: 'حوّل صور المستندات الممسوحة ضوئيًا إلى ملف PDF مرتب.', multi: true, accept: 'image', status: 'ready' },

  { id: 'pdf2word', cat: 'doc', name: 'PDF إلى Word', emoji: '📝', desc: 'تحويل ملف PDF إلى مستند Word قابل للتحرير.', status: 'soon' },
  { id: 'pdf2excel', cat: 'doc', name: 'PDF إلى Excel', emoji: '📊', desc: 'استخراج الجداول من PDF إلى ملف Excel.', status: 'soon' },
  { id: 'pdf2ppt', cat: 'doc', name: 'PDF إلى PowerPoint', emoji: '📽️', desc: 'تحويل صفحات PDF إلى عرض تقديمي.', status: 'soon' },
  { id: 'pdf2pdfa', cat: 'doc', name: 'PDF إلى PDF/A', emoji: '📄', desc: 'تحويل الملف إلى صيغة الأرشفة طويلة الأمد PDF/A.', status: 'soon' },
  { id: 'word2pdf', cat: 'doc', name: 'Word إلى PDF', emoji: '📝', desc: 'تحويل مستند Word إلى ملف PDF.', status: 'soon' },
  { id: 'excel2pdf', cat: 'doc', name: 'Excel إلى PDF', emoji: '📊', desc: 'تحويل جدول Excel إلى ملف PDF.', status: 'soon' },
  { id: 'ppt2pdf', cat: 'doc', name: 'PowerPoint إلى PDF', emoji: '📽️', desc: 'تحويل عرض تقديمي إلى ملف PDF.', status: 'soon' },
  { id: 'url2pdf', cat: 'doc', name: 'URL/HTML إلى PDF', emoji: '🌐', desc: 'تحويل صفحة ويب إلى ملف PDF.', status: 'soon' },
];

const CAT_LABEL = { pdf: '📄 عمليات PDF', image: '🖼️ عمليات الصور', doc: '📝 تحويل المستندات' };

// تخزين الجلسات في الذاكرة (لكل chatId) — يصلح لبوت متوسط الاستخدام.
// ملاحظة: على Vercel قد يُعاد تشغيل الدالة بين الطلبات، لذا للاستخدام الإنتاجي الثقيل
// يُفضّل استبدال هذا الكائن بتخزين خارجي مثل Vercel KV أو Redis.
const sessions = new Map();

/* ================= لوحات المفاتيح ================= */

function mainMenuKeyboard() {
  return [
    [{ text: CAT_LABEL.pdf, callback_data: 'menu:pdf' }],
    [{ text: CAT_LABEL.image, callback_data: 'menu:image' }],
    [{ text: CAT_LABEL.doc, callback_data: 'menu:doc' }],
  ];
}

function backRow(cat) {
  return [{ text: '« رجوع', callback_data: 'menu:' + cat }, { text: '🏠 القائمة الرئيسية', callback_data: 'menu:main' }];
}

function categoryKeyboard(cat) {
  const rows = TOOLS.filter(t => t.cat === cat).map(t => [{
    text: `${t.emoji} ${t.name}${t.status === 'soon' ? ' (قريبًا)' : ''}`,
    callback_data: 'tool:' + t.id,
  }]);
  rows.push([{ text: '🏠 القائمة الرئيسية', callback_data: 'menu:main' }]);
  return rows;
}

function optionButtonsKeyboard(cat, choices) {
  const rows = choices.map(c => [{ text: c.label, callback_data: 'opt:' + c.value }]);
  rows.push(backRow(cat));
  return rows;
}

function finishFilesKeyboard(cat) {
  return [[{ text: '✅ تم، ابدأ المعالجة', callback_data: 'finish_files' }], backRow(cat)];
}

function simpleBackKeyboard(cat) {
  return [backRow(cat)];
}

/* ================= بناء نصوص القوائم ================= */

const MAIN_TEXT = '👋 أهلًا بك في <b>Xform Bot</b>\nاختر التصنيف الذي تريد العمل عليه:';

function categoryText(cat) {
  return `${CAT_LABEL[cat]}\nاختر الأداة المطلوبة:`;
}

/* ================= إدارة الجلسات والخطوات ================= */

function resetSession(chatId) {
  sessions.delete(chatId);
}

function newSession(tool) {
  return {
    toolId: tool.id,
    stage: null,
    options: {},
    optionQueue: (tool.options || []).map(o => o.key),
    files: [],
  };
}

// يحسب نص/أزرار الخطوة الحالية بناءً على حالة الجلسة، ولا يرسل شيئًا بنفسه
function computeStep(tool, session) {
  if (tool.status === 'soon') {
    return { text: `${tool.emoji} <b>${tool.name}</b>\n\nهذه الأداة قريبًا 🚧\n${tool.desc}`, keyboard: simpleBackKeyboard(tool.cat) };
  }

  // خطوة اختيار قيمة إعداد (زر أو نص)
  if (session.stage === 'await_option') {
    const opt = tool.options.find(o => o.key === session.currentOptionKey);
    const kb = opt.type === 'buttons' ? optionButtonsKeyboard(tool.cat, opt.choices) : simpleBackKeyboard(tool.cat);
    return { text: `${tool.emoji} <b>${tool.name}</b>\n\n${opt.prompt}`, keyboard: kb };
  }

  if (tool.custom === 'insert') {
    if (session.stage === 'await_base') return { text: `${tool.emoji} <b>${tool.name}</b>\n\n📥 أرسل الملف الأساسي (PDF):`, keyboard: simpleBackKeyboard(tool.cat) };
    if (session.stage === 'await_insert_file') return { text: '📥 أرسل ملف الصفحات المراد إدراجها (PDF):', keyboard: simpleBackKeyboard(tool.cat) };
    if (session.stage === 'await_insert_pos') return { text: '🔢 أرسل رقم الصفحة التي تريد الإدراج بعدها (0 = في البداية):', keyboard: simpleBackKeyboard(tool.cat) };
  }

  if (session.stage === 'await_more_files') {
    return { text: `${tool.emoji} <b>${tool.name}</b>\n\nتمت إضافة ${session.files.length} ملف حتى الآن.\nأرسل ملفًا آخر، أو اضغط "تم" للمتابعة.`, keyboard: finishFilesKeyboard(tool.cat) };
  }

  if (session.stage === 'await_file') {
    const kind = tool.accept === 'image' ? 'صورة' : 'ملف PDF';
    return { text: `${tool.emoji} <b>${tool.name}</b>\n\n📥 أرسل ${kind} للمعالجة:`, keyboard: simpleBackKeyboard(tool.cat) };
  }

  // نص وصف أولي قبل بدء الخطوات
  return { text: `${tool.emoji} <b>${tool.name}</b>\n\n${tool.desc}`, keyboard: simpleBackKeyboard(tool.cat) };
}

// يقرر الخطوة التالية بعد اكتمال خطوة سابقة، ويحدث session.stage
function advance(tool, session) {
  if (tool.custom === 'insert') {
    if (!session.stage) { session.stage = 'await_base'; return; }
    if (session.stage === 'await_base_done') { session.stage = 'await_insert_file'; return; }
    if (session.stage === 'await_insert_file_done') { session.stage = 'await_insert_pos'; return; }
    return;
  }
  if (session.optionQueue.length > 0) {
    session.currentOptionKey = session.optionQueue.shift();
    session.stage = 'await_option';
    return;
  }
  if (tool.multi) { session.stage = 'await_more_files'; return; }
  session.stage = 'await_file';
}

async function showStep(chatId, messageId, tool, session) {
  const step = computeStep(tool, session);
  if (messageId) await U.editMessage(chatId, messageId, step.text, step.keyboard);
  else await U.sendMessage(chatId, step.text, step.keyboard);
}

async function startTool(chatId, messageId, tool) {
  if (tool.status === 'soon') {
    resetSession(chatId);
    await showStep(chatId, messageId, tool, {});
    return;
  }
  const session = newSession(tool);
  sessions.set(chatId, session);
  advance(tool, session);
  await showStep(chatId, messageId, tool, session);
}

/* ================= تنفيذ العملية الفعلية ================= */

async function runTool(chatId, tool, session) {
  await U.sendMessage(chatId, '⏳ جارٍ المعالجة، الرجاء الانتظار...');
  try {
    let result;
    switch (tool.id) {
      case 'merge':
        result = await U.mergePdfs(session.files.map(f => f.buffer));
        break;
      case 'split':
        result = await U.splitPdf(session.files[0].buffer);
        break;
      case 'compress':
        result = await U.compressPdf(session.files[0].buffer);
        break;
      case 'rotate':
        result = await U.rotatePdf(session.files[0].buffer, session.options.angle);
        break;
      case 'repair':
        result = await U.repairPdf(session.files[0].buffer);
        break;
      case 'insert':
        result = await U.insertPages(session.files[0].buffer, session.files[1].buffer, session.options.insertAt);
        break;
      case 'watermark':
        result = await U.watermarkPdf(session.files[0].buffer, session.options.text, 48);
        break;
      case 'pagenumbers':
        result = await U.pageNumbersPdf(session.files[0].buffer, session.options.pos);
        break;
      case 'crop':
        result = await U.cropPdf(session.files[0].buffer, session.options.pct);
        break;
      case 'splitrange':
        result = await U.splitRangePdf(session.files[0].buffer, session.options.splitAt);
        break;
      case 'extract':
        result = await U.extractPagesPdf(session.files[0].buffer, session.options.range);
        break;
      case 'img2pdf':
      case 'scan2pdf':
        result = await U.imagesToPdf(session.files.map(f => f.buffer), session.files.map(f => f.mime));
        break;
      default:
        throw new Error('أداة غير معروفة');
    }
    await U.sendDocumentBuffer(chatId, result.buffer, result.filename, result.note);
    await U.sendMessage(chatId, '✅ تم بنجاح! ماذا تريد أن تفعل الآن؟', mainMenuKeyboard());
  } catch (err) {
    await U.sendMessage(chatId, `⚠️ حدث خطأ أثناء المعالجة:\n${err.message}`, mainMenuKeyboard());
    await notifyDeveloper(`خطأ في تنفيذ "${tool.id}" للمستخدم ${chatId}:\n${err.stack || err}`);
  }
  resetSession(chatId);
}

async function notifyDeveloper(text) {
  if (!DEV_ID) return;
  try { await U.sendMessage(DEV_ID, `🛑 <b>تنبيه بوت Xform</b>\n${text}`.slice(0, 3900)); } catch (_) { /* ignore */ }
}

/* ================= استقبال الملفات والنصوص ================= */

async function handleIncomingFile(chatId, tool, session, fileId, mime) {
  let buffer;
  try {
    buffer = await U.getFileBuffer(fileId);
  } catch (e) {
    await U.sendMessage(chatId, '⚠️ تعذّر تنزيل الملف، حاول مرة أخرى.', simpleBackKeyboard(tool.cat));
    return;
  }

  if (tool.custom === 'insert') {
    if (session.stage === 'await_base') {
      session.files[0] = { buffer, mime };
      session.stage = 'await_base_done';
      advance(tool, session);
      await showStep(chatId, null, tool, session);
      return;
    }
    if (session.stage === 'await_insert_file') {
      session.files[1] = { buffer, mime };
      session.stage = 'await_insert_file_done';
      advance(tool, session);
      await showStep(chatId, null, tool, session);
      return;
    }
    return;
  }

  if (session.stage === 'await_more_files') {
    session.files.push({ buffer, mime });
    await showStep(chatId, null, tool, session);
    return;
  }

  if (session.stage === 'await_file') {
    session.files.push({ buffer, mime });
    await runTool(chatId, tool, session);
    return;
  }
}

async function handleIncomingText(chatId, tool, session, text) {
  if (session.stage !== 'await_option') return false;
  const opt = tool.options.find(o => o.key === session.currentOptionKey);
  if (!opt || opt.type !== 'text') return false;

  const result = opt.validate ? opt.validate(text) : { ok: true, value: text };
  if (!result.ok) {
    await U.sendMessage(chatId, `⚠️ ${result.error}`, simpleBackKeyboard(tool.cat));
    return true;
  }
  session.options[opt.key] = result.value;
  advance(tool, session);
  await showStep(chatId, null, tool, session);
  return true;
}

/* ================= معالجة تحديثات تلجرام ================= */

async function processUpdate(update) {
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message.chat.id;
    const messageId = cq.message.message_id;
    const data = cq.data || '';

    if (data === 'menu:main') {
      resetSession(chatId);
      await U.editMessage(chatId, messageId, MAIN_TEXT, mainMenuKeyboard());
      await U.answerCallback(cq.id);
      return;
    }

    if (data.startsWith('menu:')) {
      const cat = data.split(':')[1];
      resetSession(chatId);
      await U.editMessage(chatId, messageId, categoryText(cat), categoryKeyboard(cat));
      await U.answerCallback(cq.id);
      return;
    }

    if (data.startsWith('tool:')) {
      const toolId = data.split(':')[1];
      const tool = TOOLS.find(t => t.id === toolId);
      if (!tool) { await U.answerCallback(cq.id, 'أداة غير موجودة'); return; }
      await startTool(chatId, messageId, tool);
      await U.answerCallback(cq.id);
      return;
    }

    if (data.startsWith('opt:')) {
      const session = sessions.get(chatId);
      const tool = session && TOOLS.find(t => t.id === session.toolId);
      if (!session || !tool || session.stage !== 'await_option') { await U.answerCallback(cq.id); return; }
      const opt = tool.options.find(o => o.key === session.currentOptionKey);
      const raw = data.slice(4);
      const choice = opt.choices.find(c => String(c.value) === raw);
      session.options[opt.key] = choice ? choice.value : raw;
      advance(tool, session);
      await showStep(chatId, messageId, tool, session);
      await U.answerCallback(cq.id);
      return;
    }

    if (data === 'finish_files') {
      const session = sessions.get(chatId);
      const tool = session && TOOLS.find(t => t.id === session.toolId);
      if (!session || !tool) { await U.answerCallback(cq.id); return; }
      if (session.files.length === 0) {
        await U.answerCallback(cq.id, 'أضف ملفًا واحدًا على الأقل أولاً');
        return;
      }
      await U.answerCallback(cq.id, 'جارٍ المعالجة...');
      await runTool(chatId, tool, session);
      return;
    }

    await U.answerCallback(cq.id);
    return;
  }

  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;

    if (msg.text && msg.text.startsWith('/start')) {
      resetSession(chatId);
      await U.sendMessage(chatId, MAIN_TEXT, mainMenuKeyboard());
      return;
    }

    const session = sessions.get(chatId);
    const tool = session && TOOLS.find(t => t.id === session.toolId);

    if (!session || !tool) {
      await U.sendMessage(chatId, 'اضغط /start لعرض القائمة الرئيسية 🏠');
      return;
    }

    // ملف مرفق (مستند)
    if (msg.document) {
      const mime = msg.document.mime_type || '';
      const isPdf = mime.includes('pdf') || (msg.document.file_name || '').toLowerCase().endsWith('.pdf');
      const isImage = mime.includes('image');
      if (tool.accept === 'pdf' && !isPdf) {
        await U.sendMessage(chatId, '⚠️ الرجاء إرسال ملف PDF فقط.', simpleBackKeyboard(tool.cat));
        return;
      }
      if (tool.accept === 'image' && !isImage) {
        await U.sendMessage(chatId, '⚠️ الرجاء إرسال صورة فقط.', simpleBackKeyboard(tool.cat));
        return;
      }
      await handleIncomingFile(chatId, tool, session, msg.document.file_id, mime);
      return;
    }

    // صورة مرسلة كصورة تلجرام عادية
    if (msg.photo && msg.photo.length) {
      if (tool.accept !== 'image') {
        await U.sendMessage(chatId, '⚠️ هذه الأداة تحتاج ملف PDF وليس صورة.', simpleBackKeyboard(tool.cat));
        return;
      }
      const best = msg.photo[msg.photo.length - 1];
      await handleIncomingFile(chatId, tool, session, best.file_id, 'image/jpeg');
      return;
    }

    // نص (إجابة على سؤال إعداد)
    if (msg.text) {
      const handled = await handleIncomingText(chatId, tool, session, msg.text);
      if (!handled) {
        await U.sendMessage(chatId, 'الرجاء استخدام الأزرار أدناه، أو إرسال الملف المطلوب.', simpleBackKeyboard(tool.cat));
      }
      return;
    }
  }
}

/* ================= مصدّر الدالة (Vercel Serverless Function) ================= */

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).send('Xform Telegram Bot webhook is running.');
    return;
  }

  if (WEBHOOK_SECRET) {
    const header = req.headers['x-telegram-bot-api-secret-token'];
    if (header !== WEBHOOK_SECRET) {
      res.status(401).json({ ok: false, error: 'unauthorized' });
      return;
    }
  }

  try {
    await processUpdate(req.body || {});
  } catch (err) {
    console.error('Update handling error:', err);
    await notifyDeveloper(`خطأ عام في معالجة التحديث:\n${err.stack || err}`);
  }

  res.status(200).json({ ok: true });
};
