import { Telegraf, Markup } from 'telegraf';

// تفعيل البوت باستخدام التوكن من متغيرات البيئة في فيرسل
const bot = new Telegraf(process.env.BOT_TOKEN);

// --- 1. القائمة الرئيسية (الصورة الأولى) ---
const mainKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📄 عمليات PDF', 'menu_pdf')],
    [Markup.button.callback('🖼️ عمليات الصور', 'menu_images')],
    [Markup.button.callback('📝 تحويل المستندات', 'menu_docs')]
]);

// --- 2. قائمة عمليات الصور (الصورة الثانية) ---
const imagesKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📸 صور إلى PDF', 'img_to_pdf')],
    [Markup.button.callback('🖼️ إلى صور PDF', 'pdf_to_img')],
    [Markup.button.callback('📸 صور إلى صور ممسوحة ضوئياً', 'img_to_scanned')],
    [Markup.button.callback('🔙 العودة للقائمة الرئيسية', 'main_menu')]
]);

// --- 3. قائمة عمليات PDF (الصورة الثالثة) ---
const pdfKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➕ دمج ملفات PDF', 'pdf_merge')],
    [Markup.button.callback('✂️ تقسيم PDF', 'pdf_split')],
    [Markup.button.callback('🗜️ ضغط PDF', 'pdf_compress')],
    [Markup.button.callback('🔄 تدوير PDF', 'pdf_rotate')],
    [Markup.button.callback('🔧 إصلاح PDF', 'pdf_repair')],
    [Markup.button.callback('📄 إدراج صفحات', 'pdf_insert')],
    [Markup.button.callback('💧 إضافة علامة مائية', 'pdf_watermark')],
    [Markup.button.callback('# ترقيم الصفحات', 'pdf_numbering')],
    [Markup.button.callback('✂️ قص PDF', 'pdf_crop')],
    [Markup.button.callback('✂️ تقسيم نطاق صفحات', 'pdf_range_split')],
    [Markup.button.callback('📄 استخراج صفحات محددة', 'pdf_extract')],
    [Markup.button.callback('🔙 العودة للقائمة الرئيسية', 'main_menu')]
]);

// --- 4. قائمة تحويل المستندات (الصورة الرابعة) ---
const docsKeyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📝 PDF → Word', 'pdf_to_word')],
    [Markup.button.callback('📊 PDF → Excel', 'pdf_to_excel')],
    [Markup.button.callback('📽️ PDF → PowerPoint', 'pdf_to_ppt')],
    [Markup.button.callback('📄 PDF → PDF/A', 'pdf_to_pdfa')],
    [Markup.button.callback('📝 Word → PDF', 'word_to_pdf')],
    [Markup.button.callback('📊 Excel → PDF', 'excel_to_pdf')],
    [Markup.button.callback('📽️ PowerPoint → PDF', 'ppt_to_pdf')],
    [Markup.button.callback('🌐 URL/HTML → PDF', 'html_to_pdf')],
    [Markup.button.callback('🔙 العودة للقائمة الرئيسية', 'main_menu')]
]);

// --- 5. أمر البدء والتنقل بين الواجهات ---
bot.start((ctx) => {
    return ctx.reply('أهلاً بك في بوت أدوات المعالجة الحقيقي! اختر القسم المطلوب:', mainKeyboard);
});

bot.action('main_menu', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.editMessageText('القائمة الأساسية المتاحة:', mainKeyboard);
    } catch (e) { console.log(e); }
});

bot.action('menu_pdf', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.editMessageText('اختر أداة تعديل ملفات PDF المتاحة:', pdfKeyboard);
    } catch (e) { console.log(e); }
});

bot.action('menu_images', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.editMessageText('اختر عمليات تحويل ومعالجة الصور:', imagesKeyboard);
    } catch (e) { console.log(e); }
});

bot.action('menu_docs', async (ctx) => {
    try {
        await ctx.answerCbQuery();
        await ctx.editMessageText('اختر أداة تحويل وتغيير صيغ المستندات:', docsKeyboard);
    } catch (e) { console.log(e); }
});

// --- 6. ملقوف معالجة ضغطات أدوات المعالجة ---
bot.action(/^(pdf_|img_|word_|excel_|ppt_|html_)/, async (ctx) => {
    const actionData = ctx.callbackQuery.data;
    try {
        await ctx.answerCbQuery('تم اختيار الأداة بنجاح');
        await ctx.reply(`لقد قمت باختيار الأداة البرمجية: [${actionData}]. يرجى إرسال الملف المطلوب لبدء المعالجة السحابية.`);
    } catch (e) { console.log(e); }
});

// --- 7. تصدير الدالة السحابية لتشغيل الـ Webhook على Vercel ---
export default async (req, res) => {
    try {
        if (req.method === 'POST') {
            // معالجة التحديث القادم من تليجرام فوراً
            await bot.handleUpdate(req.body);
            res.status(200).send('OK');
        } else {
            res.status(200).send('Xform Webhook Handler is Active!');
        }
    } catch (error) {
        console.error('Webhook Error:', error);
        res.status(500).send('Internal Server Error');
    }
};
