// api/index.js
// نقطة نهاية الويبهوك الرئيسية لبوت تلجرام (Xform Bot)
// يستقبل تحديثات تلجرام (رسائل + أزرار Inline) ويدير قوائم التنقل ومعالجة الملفات.
//
// متغيرات البيئة المطلوبة (تُضبط من إعدادات المشروع في Vercel):
//   BOT_TOKEN          -> توكن البوت من BotFather
//   DEV_ID             -> آيدي حساب المطوّر على تلجرام (لإشعارات الأخطاء)
//   WEBHOOK_SECRET      -> (اختياري) سر تحقق من صحة طلبات تلجرام
//   ADMIN_IDS          -> معرفات تلجرام لحسابات الإدمن، مفصولة بفواصل
//   WEBAPP_URL         -> رابط https للتطبيق المصغر (Mini App) لزر "افتح تطبيق الويب"
//   CLOUDCONVERT_API_KEY -> مفتاح CloudConvert (لأدوات التحويل بين Office و PDF والصور)
//   KV_REST_API_URL / KV_REST_API_TOKEN -> بيانات اتصال Vercel KV (لوحة الإدمن)
//
// راجع ملف SETUP.md المرفق لتفاصيل الإعداد والتثبيت.

const U = require('./upload.js');

// تحميل الوحدات (KV / لوحة الإدمن / CloudConvert) بأمان: إن فشل تحميل إحداها
// (حزمة ناقصة، متغير بيئة خاطئ...) لن يُسقط البوت بالكامل بعد الآن — فقط
// الميزة المرتبطة ستُعطَّل مؤقتًا مع رسالة واضحة في Vercel Logs، بينما تبقى
// أدوات PDF الأساسية تعمل دائمًا لأنها لا تعتمد على db.js أو converters.js.
let D = null;
let A = null;
let C = null;
try { D = require('./db.js'); } catch (e) { console.error('⚠️ فشل تحميل db.js — لوحة الإدمن وتتبع المستخدمين معطّلة:', e.message); }
try { A = require('./admin.js'); } catch (e) { console.error('⚠️ فشل تحميل admin.js — لوحة الإدمن معطّلة:', e.message); }
try { C = require('./converters.js'); } catch (e) { console.error('⚠️ فشل تحميل converters.js — تحويلات CloudConvert معطّلة:', e.message); }

async function safeUpsertUser(tgUser) {
  if (!D) return { isNew: false };
  try { return await D.upsertUser(tgUser); } catch (e) { console.error('KV upsertUser error:', e.message); return { isNew: false }; }
}
async function safeIsBanned(id) {
  if (!D) return false;
  try { return await D.isBanned(id); } catch (e) { console.error('KV isBanned error:', e.message); return false; }
}
async function safeGetSetting(key, def) {
  if (!D) return def;
  try { return await D.getSetting(key, def); } catch (e) { console.error('KV getSetting error:', e.message); return def; }
}
async function safeGetContent(key, def) {
  if (!D) return def;
  try { return await D.getContent(key, def); } catch (e) { console.error('KV getContent error:', e.message); return def; }
}
function safeIsAdmin(id) {
  if (!A) return false;
  try { return A.isAdmin(id); } catch (e) { return false; }
}

const DEV_ID = process.env.DEV_ID;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;
const WEBAPP_URL = process.env.WEBAPP_URL;

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
  { id: 'pdf2img', cat: 'image', name: 'PDF إلى صور', emoji: '🖼️', desc: 'تحويل صفحات PDF إلى صور PNG (عبر CloudConvert).', accept: 'pdf', status: 'ready' },
  { id: 'scan2pdf', cat: 'image', name: 'صور ممسوحة ضوئيًا إلى PDF', emoji: '📠', desc: 'حوّل صور المستندات الممسوحة ضوئيًا إلى ملف PDF مرتب.', multi: true, accept: 'image', status: 'ready' },

  { id: 'pdf2word', cat: 'doc', name: 'PDF إلى Word', emoji: '📝', desc: 'تحويل ملف PDF إلى مستند Word قابل للتحرير (عبر CloudConvert).', accept: 'pdf', status: 'ready' },
  { id: 'pdf2excel', cat: 'doc', name: 'PDF إلى Excel', emoji: '📊', desc: 'استخراج الجداول من PDF إلى ملف Excel (عبر CloudConvert).', accept: 'pdf', status: 'ready' },
  { id: 'pdf2ppt', cat: 'doc', name: 'PDF إلى PowerPoint', emoji: '📽️', desc: 'تحويل صفحات PDF إلى عرض تقديمي (عبر CloudConvert).', accept: 'pdf', status: 'ready' },
  { id: 'pdf2pdfa', cat: 'doc', name: 'PDF إلى PDF/A', emoji: '📄', desc: 'تحويل الملف إلى صيغة الأرشفة طويلة الأمد PDF/A (عبر CloudConvert).', accept: 'pdf', status: 'ready' },
  { id: 'word2pdf', cat: 'doc', name: 'Word إلى PDF', emoji: '📝', desc: 'تحويل مستند Word إلى ملف PDF (عبر CloudConvert).', accept: 'docx', status: 'ready' },
  { id: 'excel2pdf', cat: 'doc', name: 'Excel إلى PDF', emoji: '📊', desc: 'تحويل جدول Excel إلى ملف PDF (عبر CloudConvert).', accept: 'xlsx', status: 'ready' },
  { id: 'ppt2pdf', cat: 'doc', name: 'PowerPoint إلى PDF', emoji: '📽️', desc: 'تحويل عرض تقديمي إلى ملف PDF (عبر CloudConvert).', accept: 'pptx', status: 'ready' },
  { id: 'url2pdf', cat: 'doc', name: 'URL/HTML إلى PDF', emoji: '🌐', desc: 'تحويل صفحة ويب إلى ملف PDF (عبر CloudConvert).', status: 'ready', custom: 'urlinput' },
];

const CAT_LABEL = { pdf: '📄 عمليات PDF', image: '🖼️ عمليات الصور', doc: '📝 تحويل المستندات' };

// امتدادات/أنواع MIME لأدوات Office المضافة حديثًا
const OFFICE_MIME = {
  docx: ['wordprocessingml', '.docx', '.doc'],
  xlsx: ['spreadsheetml', '.xlsx', '.xls'],
  pptx: ['presentationml', '.pptx', '.ppt'],
};

// تخزين جلسات معالجة الأدوات في الذاكرة (لكل chatId) — يصلح لبوت متوسط الاستخدام.
// ملاحظة: على Vercel قد يُعاد تشغيل الدالة بين الطلبات، لذا للاستخدام الإنتاجي الثقيل
// يُفضّل استبدال هذا الكائن بتخزين خارجي مثل Vercel KV أو Redis.
// (بيانات لوحة الإدمن نفسها أصبحت الآن في Vercel KV عبر db.js وليست في هذا الكائن.)
const sessions = new Map();

/* ================= لوحات المفاتيح ================= */

async function mainMenuKeyboard(chatId) {
  const rows = [];
  if (WEBAPP_URL) {
    rows.push([{ text: '🌐 افتح تطبيق الويب', web_app: { url: WEBAPP_URL } }]);
  }
  rows.push([{ text: CAT_LABEL.pdf, callback_data: 'menu:pdf' }]);
  rows.push([{ text: CAT_LABEL.image, callback_data: 'menu:image' }]);
  rows.push([{ text: CAT_LABEL.doc, callback_data: 'menu:doc' }]);
  if (safeIsAdmin(chatId)) {
    rows.push([{ text: '🛠️ لوحة الإدمن', callback_data: 'admin:main' }]);
  }
  return rows;
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

async function mainText() {
  const custom = await safeGetContent('welcome_text', '');
  if (custom && custom.trim()) return custom;
  return '👋 أهلًا بك في <b>Xform Bot</b>\nاختر التصنيف الذي تريد العمل عليه:';
}

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

  if (tool.custom === 'urlinput') {
    if (session.stage === 'await_url') return { text: `${tool.emoji} <b>${tool.name}</b>\n\n🔗 أرسل رابط الصفحة (يبدأ بـ http:// أو https://):`, keyboard: simpleBackKeyboard(tool.cat) };
  }

  if (session.stage === 'await_more_files') {
    return { text: `${tool.emoji} <b>${tool.name}</b>\n\nتمت إضافة ${session.files.length} ملف حتى الآن.\nأرسل ملفًا آخر، أو اضغط "تم" للمتابعة.`, keyboard: finishFilesKeyboard(tool.cat) };
  }

  if (session.stage === 'await_file') {
    const kindMap = { image: 'صورة', docx: 'ملف Word', xlsx: 'ملف Excel', pptx: 'ملف PowerPoint' };
    const kind = kindMap[tool.accept] || 'ملف PDF';
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
  if (tool.custom === 'urlinput') {
    if (!session.stage) { session.stage = 'await_url'; return; }
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

      // ===== أدوات مضافة عبر CloudConvert =====
      case 'pdf2word':
      case 'pdf2excel':
      case 'pdf2ppt':
      case 'pdf2pdfa':
      case 'word2pdf':
      case 'excel2pdf':
      case 'ppt2pdf':
      case 'pdf2img': {
        if (!C) throw new Error('ميزة التحويل غير مفعّلة حاليًا (تحقق من تثبيت الحزم ومتغير CLOUDCONVERT_API_KEY).');
        const map = C.CONVERT_MAP[tool.id];
        const srcName = `input.${map.input}`;
        result = await C.convertFileViaCloudConvert(session.files[0].buffer, srcName, map.input, map.output, map.extra || {});
        break;
      }
      case 'url2pdf':
        if (!C) throw new Error('ميزة التحويل غير مفعّلة حاليًا (تحقق من تثبيت الحزم ومتغير CLOUDCONVERT_API_KEY).');
        result = await C.urlToPdfViaCloudConvert(session.url);
        break;

      default:
        throw new Error('أداة غير معروفة');
    }
    await U.sendDocumentBuffer(chatId, result.buffer, result.filename, result.note);
    await U.sendMessage(chatId, '✅ تم بنجاح! ماذا تريد أن تفعل الآن؟', await mainMenuKeyboard(chatId));
  } catch (err) {
    await U.sendMessage(chatId, `⚠️ حدث خطأ أثناء المعالجة:\n${err.message}`, await mainMenuKeyboard(chatId));
    await notifyDeveloper(`خطأ في تنفيذ "${tool.id}" للمستخدم ${chatId}:\n${err.stack || err}`);
  }
  resetSession(chatId);
}

async function notifyDeveloper(text) {
  if (!DEV_ID) return;
  try { await U.sendMessage(DEV_ID, `🛑 <b>تنبيه بوت Xform</b>\n${text}`.slice(0, 3900)); } catch (_) { /* ignore */ }
}

async function notifyAdminsNewUser(user) {
  const enabled = await safeGetSetting('notify_admin_on_join', true);
  if (!enabled) return;
  const ids = String(process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  const text = `👤 مستخدم جديد دخل البوت:\n${user.first_name || ''} ${user.last_name || ''}\n@${user.username || '—'}\nID: <code>${user.id}</code>`;
  for (const id of ids) {
    try { await U.sendMessage(id, text); } catch (_) { /* ignore */ }
  }
}

/* ================= استقبال الملفات والنصوص ================= */

function fileMatchesAccept(accept, mime, fileName) {
  const m = (mime || '').toLowerCase();
  const n = (fileName || '').toLowerCase();
  if (accept === 'pdf') return m.includes('pdf') || n.endsWith('.pdf');
  if (accept === 'image') return m.includes('image');
  if (OFFICE_MIME[accept]) {
    return OFFICE_MIME[accept].some(sig => m.includes(sig) || n.endsWith(sig));
  }
  return false;
}

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
  if (tool.custom === 'urlinput' && session.stage === 'await_url') {
    const url = text.trim();
    if (!/^https?:\/\/.+/i.test(url)) {
      await U.sendMessage(chatId, '⚠️ أرسل رابطًا صحيحًا يبدأ بـ http:// أو https://', simpleBackKeyboard(tool.cat));
      return true;
    }
    session.url = url;
    await runTool(chatId, tool, session);
    return true;
  }

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
  // ===== تتبع المستخدم + وضع الصيانة + الحظر (لكل من الرسائل والأزرار) =====
  const tgUser = update.callback_query ? update.callback_query.from : (update.message ? update.message.from : null);
  const chatIdForCheck = update.callback_query ? update.callback_query.message.chat.id : (update.message ? update.message.chat.id : null);

  if (tgUser && chatIdForCheck) {
    const { isNew } = await safeUpsertUser(tgUser);
    if (isNew) await notifyAdminsNewUser(tgUser);

    const banned = await safeIsBanned(tgUser.id);
    if (banned) {
      if (update.callback_query) await U.answerCallback(update.callback_query.id, '⛔ أنت محظور من استخدام هذا البوت');
      else await U.sendMessage(chatIdForCheck, '⛔ أنت محظور من استخدام هذا البوت.');
      return;
    }

    const maintenance = await safeGetSetting('maintenance_mode', false);
    if (maintenance && !safeIsAdmin(tgUser.id)) {
      const msg = '🚧 البوت في وضع الصيانة حاليًا، حاول لاحقًا.';
      if (update.callback_query) await U.answerCallback(update.callback_query.id, msg);
      else await U.sendMessage(chatIdForCheck, msg);
      return;
    }
  }

  // ===== أزرار لوحة الإدمن =====
  if (update.callback_query && (update.callback_query.data || '').startsWith('admin:')) {
    if (!A) {
      await U.answerCallback(update.callback_query.id, '⚠️ لوحة الإدمن غير مفعّلة حاليًا (تحقق من إعداد KV)');
      return;
    }
    await A.handleAdminCallback(update.callback_query);
    return;
  }

  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = cq.message.chat.id;
    const messageId = cq.message.message_id;
    const data = cq.data || '';

    if (data === 'menu:main') {
      resetSession(chatId);
      await U.editMessage(chatId, messageId, await mainText(), await mainMenuKeyboard(chatId));
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
      await U.sendMessage(chatId, await mainText(), await mainMenuKeyboard(chatId));
      return;
    }

    if (msg.text && msg.text.startsWith('/admin')) {
      if (!A) {
        await U.sendMessage(chatId, '⚠️ لوحة الإدمن غير مفعّلة حاليًا (تحقق من إعداد KV في Vercel Logs).');
        return;
      }
      if (!A.isAdmin(chatId)) {
        await U.sendMessage(chatId, '⚠️ هذا الأمر مخصص للإدمن فقط.');
        return;
      }
      await A.showAdminMain(chatId, null);
      return;
    }

    // إن كانت هناك جلسة إدخال إدمن مفتوحة (بث، حظر، تعديل محتوى...)، أعطها الأولوية
    if (msg.text && A && A.isAdmin(chatId)) {
      const handledByAdmin = await A.handleAdminText(chatId, msg.text);
      if (handledByAdmin) return;
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
      const fileName = msg.document.file_name || '';
      if (!fileMatchesAccept(tool.accept, mime, fileName)) {
        const kindMap = { image: 'صورة', docx: 'ملف Word (.docx)', xlsx: 'ملف Excel (.xlsx)', pptx: 'ملف PowerPoint (.pptx)' };
        const kind = kindMap[tool.accept] || 'ملف PDF';
        await U.sendMessage(chatId, `⚠️ الرجاء إرسال ${kind} فقط.`, simpleBackKeyboard(tool.cat));
        return;
      }
      await handleIncomingFile(chatId, tool, session, msg.document.file_id, mime);
      return;
    }

    // صورة مرسلة كصورة تلجرام عادية
    if (msg.photo && msg.photo.length) {
      if (tool.accept !== 'image') {
        await U.sendMessage(chatId, '⚠️ هذه الأداة تحتاج ملف مختلف وليس صورة.', simpleBackKeyboard(tool.cat));
        return;
      }
      const best = msg.photo[msg.photo.length - 1];
      await handleIncomingFile(chatId, tool, session, best.file_id, 'image/jpeg');
      return;
    }

    // نص (إجابة على سؤال إعداد أو رابط لأداة URL إلى PDF)
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
    let body = req.body;
    
    // حماية قراءة البيانات ومنع الانهيار الفوري في بيئة Vercel
    if (body) {
      if (Buffer.isBuffer(body)) {
        body = JSON.parse(body.toString('utf-8'));
      } else if (typeof body === 'string') {
        body = JSON.parse(body);
      }
    }

    await processUpdate(body || {});
    
  } catch (err) {
    console.error('Update handling error:', err);
    if (DEV_ID) {
      try { await U.sendMessage(DEV_ID, `🛑 <b>خطأ عام في السيرفر:</b>\n${err.message}`); } catch(_) {}
    }
  }

  // إغلاق الاستجابة بنجاح لتنبيه سيرفرات تليجرام
  res.status(200).json({ ok: true });
};
