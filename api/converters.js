// api/converters.js
// أدوات التحويل التي تعتمد على خدمة CloudConvert الخارجية
// (PDF↔Word/Excel/PowerPoint، PDF↔صور، PDF/A، تحويل رابط ويب إلى PDF).
//
// السبب في استخدام CloudConvert بدل تنفيذ التحويل محليًا: بيئة Vercel Serverless
// لا توفّر LibreOffice أو محرك متصفح كامل بشكل افتراضي، وإضافتهما يدويًا (مثل
// puppeteer + chromium) يجعل حجم الدالة كبيرًا جدًا وغير مستقر. CloudConvert
// يحل هذا لكل أدوات "قريبًا" دفعة واحدة بشكل موثوق.
//
// تثبيت الحزم: npm install cloudconvert jszip
//
// متغير البيئة المطلوب:
//   CLOUDCONVERT_API_KEY  -> يُنشأ من: https://cloudconvert.com/dashboard/api/v2/keys
//
// ملاحظات مهمة:
// 1) هذه العملية تتطلب اتصالًا وانتظارًا (قد تستغرق ثوانٍ إلى دقيقة حسب حجم الملف).
//    تأكد من ضبط "maxDuration" في vercel.json بما يناسب خطتك على Vercel
//    (راجع ملف SETUP.md المرفق).
// 2) الخطة المجانية في CloudConvert تمنحك 25 دقيقة تحويل يوميًا تقريبًا، وهو كافٍ
//    للتجربة، لكن للاستخدام الفعلي ستحتاج خطة مدفوعة.
// 3) معامل تحويل PDF إلى PDF/A أدناه (`pdf_a`) هو الاسم المعروف في توثيق
//    CloudConvert وقت كتابة هذا الكود، يُفضّل التأكد منه عبر "Job Builder"
//    في لوحة تحكم CloudConvert قبل الاعتماد عليه في الإنتاج.

const CloudConvert = require('cloudconvert');
const JSZip = require('jszip');

function getClient() {
  const key = process.env.CLOUDCONVERT_API_KEY;
  if (!key) {
    throw new Error(
      'لم يتم ضبط متغير البيئة CLOUDCONVERT_API_KEY. أنشئ مفتاح API من لوحة تحكم CloudConvert وأضفه في إعدادات المشروع على Vercel.'
    );
  }
  return new CloudConvert(key);
}

// خريطة صيغ الإدخال/الإخراج لكل أداة من أدوات "قريبًا" السابقة
const CONVERT_MAP = {
  pdf2word: { input: 'pdf', output: 'docx' },
  pdf2excel: { input: 'pdf', output: 'xlsx' },
  pdf2ppt: { input: 'pdf', output: 'pptx' },
  pdf2pdfa: { input: 'pdf', output: 'pdf', extra: { pdf_a: true } },
  word2pdf: { input: 'docx', output: 'pdf' },
  excel2pdf: { input: 'xlsx', output: 'pdf' },
  ppt2pdf: { input: 'pptx', output: 'pdf' },
  pdf2img: { input: 'pdf', output: 'png' },
};

// انتظار انتهاء المهمة يدويًا مع مهلة زمنية قابلة للضبط، بدل استخدام
// cc.jobs.wait() مباشرة، حتى لا تعلّق الدالة إلى ما لا نهاية على Vercel.
async function waitForJob(cc, jobId, timeoutMs = 55000) {
  const start = Date.now();
  let job = await cc.jobs.get(jobId);
  while (job.status !== 'finished' && job.status !== 'error') {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        'انتهت مهلة الانتظار لعملية التحويل. قد تحتاج لزيادة "maxDuration" في vercel.json، أو المحاولة بملف أصغر.'
      );
    }
    await new Promise((r) => setTimeout(r, 2000));
    job = await cc.jobs.get(jobId);
  }
  return job;
}

async function downloadFile(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('فشل تنزيل الملف الناتج من CloudConvert');
  return Buffer.from(await res.arrayBuffer());
}

// تحويل عام لملف عبر CloudConvert. يعيد { buffer, filename, note }
async function convertFileViaCloudConvert(buffer, filename, inputFormat, outputFormat, extraParams = {}) {
  const cc = getClient();

  let job = await cc.jobs.create({
    tasks: {
      'upload-file': { operation: 'import/upload' },
      'convert-file': {
        operation: 'convert',
        input: 'upload-file',
        input_format: inputFormat,
        output_format: outputFormat,
        ...extraParams,
      },
      'export-file': { operation: 'export/url', input: 'convert-file' },
    },
  });

  const uploadTask = job.tasks.find((t) => t.name === 'upload-file');
  await cc.tasks.upload(uploadTask, buffer, filename);

  job = await waitForJob(cc, job.id);

  if (job.status === 'error') {
    const failed = job.tasks.find((t) => t.status === 'error');
    throw new Error('فشلت عملية التحويل: ' + (failed && failed.message ? failed.message : 'خطأ غير معروف من CloudConvert'));
  }

  const files = cc.jobs.getExportUrls(job);
  if (!files || !files.length) throw new Error('لم يتم إنتاج أي ملف من عملية التحويل.');

  if (files.length === 1) {
    const outBuffer = await downloadFile(files[0].url);
    return { buffer: outBuffer, filename: files[0].filename, note: null };
  }

  // ملفات متعددة (مثال: PDF متعدد الصفحات إلى صور) -> نرزمها داخل ZIP
  const zip = new JSZip();
  for (const f of files) {
    const b = await downloadFile(f.url);
    zip.file(f.filename, b);
  }
  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  const baseName = (filename || 'output').replace(/\.[^.]+$/, '');
  return {
    buffer: zipBuffer,
    filename: `${baseName}_pages.zip`,
    note: `تم إنتاج ${files.length} ملف (صفحة) وتجميعها داخل أرشيف ZIP.`,
  };
}

// تحويل صفحة ويب (رابط) إلى PDF
async function urlToPdfViaCloudConvert(url) {
  const cc = getClient();

  let job = await cc.jobs.create({
    tasks: {
      'capture-site': { operation: 'capture-website', url, output_format: 'pdf' },
      'export-file': { operation: 'export/url', input: 'capture-site' },
    },
  });

  job = await waitForJob(cc, job.id);

  if (job.status === 'error') {
    const failed = job.tasks.find((t) => t.status === 'error');
    throw new Error('فشل تحويل الرابط: ' + (failed && failed.message ? failed.message : 'تأكد من صحة الرابط (يجب أن يبدأ بـ http:// أو https://)'));
  }

  const files = cc.jobs.getExportUrls(job);
  if (!files || !files.length) throw new Error('لم يتم إنتاج ملف PDF من الرابط.');

  const buffer = await downloadFile(files[0].url);
  return { buffer, filename: files[0].filename || 'page.pdf', note: null };
}

module.exports = { convertFileViaCloudConvert, urlToPdfViaCloudConvert, CONVERT_MAP };
