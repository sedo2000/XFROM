// api/admin.js
// لوحة تحكم الإدمن (مبنية على نفس نمط لوحات المفاتيح Inline المستخدم في البوت).

// 🔥 الإصلاح: استيراد الملفات المساعدة وقاعدة البيانات لمنع خطأ "D is not defined"
const D = require('./db'); 
const U = require('./converters'); // أو اسم الملف المسؤول عن دالة sendMessage / editMessage إذا كان مختلفاً

function parseAdminIds() {
  const idsStr = process.env.ADMIN_IDS;
  if (!idsStr) return []; // إذا كان المتغير غير موجود، نخرج فوراً بمصفوفة فارغة دون انهيار
  
  return String(idsStr)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((id) => {
      const num = Number(id);
      return Number.isFinite(num) ? num : null;
    })
    .filter((id) => id !== null);
}

function isAdmin(chatId) {
  return parseAdminIds().includes(Number(chatId));
}

// جلسات إدخال نصي داخل لوحة الإدمن (بث رسالة، حظر بمعرف، تعديل محتوى...)
const adminSessions = new Map();

/* ================= لوحات المفاتيح ================= */

function adminMainKeyboard(banNotif, joinNotif) {
  return [
    [
      { text: '⚙️ الإعدادات', callback_data: 'admin:settings' },
      { text: '📝 المحتوى', callback_data: 'admin:content' },
    ],
    [
      { text: '👥 المستخدمون', callback_data: 'admin:users' },
      { text: '🔒 الاشتراك', callback_data: 'admin:sub' },
    ],
    [
      { text: '📣 التواصل', callback_data: 'admin:comm' },
      { text: '💰 المالية', callback_data: 'admin:finance' },
    ],
    [{ text: '🛠️ النظام والدعم', callback_data: 'admin:system' }],
    [
      { text: `${banNotif ? '✅' : '❌'} إشعار الحظر 🔔`, callback_data: 'admin:toggle_ban_notif' },
      { text: `${joinNotif ? '✅' : '❌'} إشعار الدخول 🔔`, callback_data: 'admin:toggle_join_notif' },
    ],
    [{ text: '❓ دليل الاستخدام', callback_data: 'admin:guide' }],
    [{ text: '« رجوع للقائمة الرئيسية', callback_data: 'menu:main' }],
  ];
}

function backToAdmin() {
  return [[{ text: '« رجوع للوحة الإدمن', callback_data: 'admin:main' }]];
}

async function showAdminMain(chatId, messageId) {
  const banNotif = await D.getSetting('notify_on_ban', true);
  const joinNotif = await D.getSetting('notify_admin_on_join', true);
  const text = '🛠️ <b>لوحة تحكم الإدمن</b>\n\nاختر القسم الذي تريد إدارته:';
  const kb = adminMainKeyboard(banNotif, joinNotif);
  if (messageId) await U.editMessage(chatId, messageId, text, kb);
  else await U.sendMessage(chatId, text, kb);
}

/* ================= إعدادات عامة ================= */

async function showSettings(chatId, messageId) {
  const maintenance = await D.getSetting('maintenance_mode', false);
  const supportContact = await D.getContent('support_contact', 'غير محدد');
  const text =
    `⚙️ <b>الإعدادات</b>\n\n` +
    `وضع الصيانة: ${maintenance ? '🟢 مفعّل (البوت متوقف عن الجميع عدا الإدمن)' : '🔴 متوقف'}\n` +
    `جهة تواصل الدعم الحالية: ${supportContact}`;
  const kb = [
    [{ text: maintenance ? '🔴 إيقاف وضع الصيانة' : '🟢 تفعيل وضع الصيانة', callback_data: 'admin:toggle_maintenance' }],
    [{ text: '✏️ تعديل جهة تواصل الدعم', callback_data: 'admin:set_support_contact' }],
    ...backToAdmin(),
  ];
  if (messageId) await U.editMessage(chatId, messageId, text, kb);
  else await U.sendMessage(chatId, text, kb);
}

/* ================= المحتوى ================= */

async function showContent(chatId, messageId) {
  const welcome = await D.getContent('welcome_text', '(النص الافتراضي الحالي في الكود)');
  const text = `📝 <b>المحتوى</b>\n\nرسالة الترحيب الحالية:\n<i>${escapeHtml(welcome)}</i>`;
  const kb = [
    [{ text: '✏️ تعديل رسالة الترحيب', callback_data: 'admin:edit_welcome' }],
    ...backToAdmin(),
  ];
  if (messageId) await U.editMessage(chatId, messageId, text, kb);
  else await U.sendMessage(chatId, text, kb);
}

/* ================= المستخدمون ================= */

async function showUsers(chatId, messageId) {
  const total = await D.countUsers();
  const banned = await D.countBanned();
  const text = `👥 <b>المستخدمون</b>\n\nإجمالي المستخدمين: <b>${total}</b>\nالمحظورون: <b>${banned}</b>`;
  const kb = [
    [{ text: '🔎 عرض معلومات مستخدم (بالمعرف)', callback_data: 'admin:user_lookup' }],
    [{ text: '⛔ حظر مستخدم', callback_data: 'admin:user_ban' }],
    [{ text: '✅ إلغاء حظر مستخدم', callback_data: 'admin:user_unban' }],
    ...backToAdmin(),
  ];
  if (messageId) await U.editMessage(chatId, messageId, text, kb);
  else await U.sendMessage(chatId, text, kb);
}

/* ================= الاشتراك ================= */

async function showSubscription(chatId, messageId) {
  const active = await D.listActiveSubs();
  const text = `🔒 <b>الاشتراك</b>\n\nعدد الاشتراكات المفعّلة حاليًا: <b>${active.length}</b>\n\n⚠️ لا توجد بوابة دفع مربوطة تلقائيًا؛ هذا القسم لإدارة الاشتراكات يدويًا فقط.`;
  const kb = [
    [{ text: '➕ منح اشتراك لمستخدم', callback_data: 'admin:sub_grant' }],
    [{ text: '➖ سحب اشتراك من مستخدم', callback_data: 'admin:sub_revoke' }],
    ...backToAdmin(),
  ];
  if (messageId) await U.editMessage(chatId, messageId, text, kb);
  else await U.sendMessage(chatId, text, kb);
}

/* ================= التواصل ================= */

async function showComm(chatId, messageId) {
  const text = '📣 <b>التواصل</b>\n\nأرسل رسالة جماعية لجميع المستخدمين، أو حدّث رابط التواصل مع الدعم.';
  const kb = [
    [{ text: '📢 إرسال رسالة جماعية (Broadcast)', callback_data: 'admin:broadcast' }],
    ...backToAdmin(),
  ];
  if (messageId) await U.editMessage(chatId, messageId, text, kb);
  else await U.sendMessage(chatId, text, kb);
}

/* ================= المالية ================= */

async function showFinance(chatId, messageId) {
  const total = await D.financeTotal();
  const recent = await D.listFinanceRecords(5);
  const lines = recent
    .map((r) => `• ${r.amount} — ${r.note || 'بدون ملاحظة'} (${new Date(r.at).toLocaleDateString('ar')})`)
    .join('\n');
  const text =
    `💰 <b>المالية</b>\n\nإجمالي المسجّل: <b>${total}</b>\n\n` +
    (recent.length ? `آخر السجلات:\n${lines}` : 'لا توجد سجلات مالية بعد.');
  const kb = [
    [{ text: '➕ تسجيل دفعة/إيراد يدويًا', callback_data: 'admin:finance_add' }],
    ...backToAdmin(),
  ];
  if (messageId) await U.editMessage(chatId, messageId, text, kb);
  else await U.sendMessage(chatId, text, kb);
}

/* ================= النظام والدعم ================= */

async function showSystem(chatId, messageId) {
  const total = await D.countUsers();
  const banned = await D.countBanned();
  const active = await D.listActiveSubs();
  const financeT = await D.financeTotal();
  const text =
    `🛠️ <b>النظام والدعم</b>\n\n` +
    `👥 المستخدمون: ${total} (محظور: ${banned})\n` +
    `🔒 الاشتراكات المفعّلة: ${active.length}\n` +
    `💰 إجمالي المالية: ${financeT}\n\n` +
    `للإبلاغ عن مشكلة تقنية أو مراجعة سجل الأخطاء، تصل الإشعارات تلقائيًا لحساب المطوّر (DEV_ID).`;
  const kb = [...backToAdmin()];
  if (messageId) await U.editMessage(chatId, messageId, text, kb);
  else await U.sendMessage(chatId, text, kb);
}

/* ================= دليل الاستخدام ================= */

async function showGuide(chatId, messageId) {
  const guide = await D.getContent(
    'admin_guide',
    '• الإعدادات: تفعيل/تعطيل وضع الصيانة وتحديد جهة تواصل الدعم.\n' +
      '• المحتوى: تعديل رسالة الترحيب الرئيسية.\n' +
      '• المستخدمون: عرض/حظر/إلغاء حظر مستخدم بمعرفه.\n' +
      '• الاشتراك: منح أو سحب اشتراك يدويًا لمستخدم معيّن.\n' +
      '• التواصل: إرسال رسالة جماعية لكل المستخدمين.\n' +
      '• المالية: تسجيل الدفعات يدويًا ومتابعة الإجمالي.\n' +
      '• النظام والدعم: نظرة سريعة على حالة البوت.'
  );
  const text = `❓ <b>دليل الاستخدام</b>\n\n${guide}`;
  const kb = [...backToAdmin()];
  if (messageId) await U.editMessage(chatId, messageId, text, kb);
  else await U.sendMessage(chatId, text, kb);
}

/* ================= أدوات مساعدة ================= */

function escapeHtml(s) {
  return String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function startAdminInput(chatId, stage, extra = {}) {
  adminSessions.set(chatId, { stage, ...extra });
}

/* ================= معالجة نصوص الإدمن ================= */

async function handleAdminText(chatId, text) {
  const session = adminSessions.get(chatId);
  if (!session) return false;

  if (text === '/cancel' || text === 'إلغاء') {
    adminSessions.delete(chatId);
    await showAdminMain(chatId, null);
    return true;
  }

  switch (session.stage) {
    case 'await_support_contact': {
      await D.setContent('support_contact', text.trim());
      adminSessions.delete(chatId);
      await U.sendMessage(chatId, '✅ تم تحديث جهة تواصل الدعم.');
      await showSettings(chatId, null);
      return true;
    }
    case 'await_welcome_text': {
      await D.setContent('welcome_text', text);
      adminSessions.delete(chatId);
      await U.sendMessage(chatId, '✅ تم تحديث رسالة الترحيب.');
      await showContent(chatId, null);
      return true;
    }
    case 'await_lookup_id': {
      const id = parseInt(text.trim(), 10);
      if (!Number.isFinite(id)) {
        await U.sendMessage(chatId, '⚠️ أرسل معرف تلجرام رقمي صالح، أو /cancel للإلغاء.');
        return true;
      }
      const u = await D.getUser(id);
      adminSessions.delete(chatId);
      if (!u) {
        await U.sendMessage(chatId, '⚠️ لا يوجد مستخدم بهذا المعرف في قاعدة البيانات.');
      } else {
        await U.sendMessage(
          chatId,
          `👤 <b>معلومات المستخدم</b>\n\n` +
            `المعرف: <code>${u.id}</code>\n` +
            `الاسم: ${escapeHtml(u.firstName || '')} ${escapeHtml(u.lastName || '')}\n` +
            `يوزر: ${u.username ? '@' + u.username : '—'}\n` +
            `محظور: ${u.banned ? 'نعم ⛔' : 'لا ✅'}\n` +
            `عدد الرسائل: ${u.messageCount}\n` +
            `أول ظهور: ${new Date(u.joinedAt).toLocaleString('ar')}\n` +
            `آخر ظهور: ${new Date(u.lastSeen).toLocaleString('ar')}`
        );
      }
      await showUsers(chatId, null);
      return true;
    }
    case 'await_ban_id':
    case 'await_unban_id': {
      const id = parseInt(text.trim(), 10);
      if (!Number.isFinite(id)) {
        await U.sendMessage(chatId, '⚠️ أرسل معرف تلجرام رقمي صالح، أو /cancel للإلغاء.');
        return true;
      }
      const isBan = session.stage === 'await_ban_id';
      const ok = isBan ? await D.banUser(id) : await D.unbanUser(id);
      adminSessions.delete(chatId);
      if (!ok) {
        await U.sendMessage(chatId, '⚠️ لا يوجد مستخدم بهذا المعرف في قاعدة البيانات.');
      } else {
        await U.sendMessage(chatId, isBan ? `⛔ تم حظر المستخدم ${id}.` : `✅ تم إلغاء حظر المستخدم ${id}.`);
        if (isBan) {
          const notify = await D.getSetting('notify_on_ban', true);
          if (notify) {
            try {
              await U.sendMessage(id, '⛔ تم حظرك من استخدام هذا البوت من قِبل الإدارة.');
            } catch (_) {}
          }
        }
      }
      await showUsers(chatId, null);
      return true;
    }
    case 'await_sub_grant_id': {
      const id = parseInt(text.trim(), 10);
      if (!Number.isFinite(id)) {
        await U.sendMessage(chatId, '⚠️ أرسل معرف تلجرام رقمي صالح، أو /cancel للإلغاء.');
        return true;
      }
      adminSessions.set(chatId, { stage: 'await_sub_grant_days', userId: id });
      await U.sendMessage(chatId, '🔢 كم عدد الأيام لهذا الاشتراك؟ (مثال: 30)');
      return true;
    }
    case 'await_sub_grant_days': {
      const days = parseInt(text.trim(), 10);
      if (!Number.isFinite(days) || days <= 0) {
        await U.sendMessage(chatId, '⚠️ أرسل عدد أيام صحيح أكبر من صفر، أو /cancel للإلغاء.');
        return true;
      }
      const userId = session.userId;
      const expiresAt = Date.now() + days * 24 * 60 * 60 * 1000;
      await D.setSubscription(userId, { active: true, days, expiresAt, grantedAt: Date.now() });
      adminSessions.delete(chatId);
      await U.sendMessage(chatId, `✅ تم منح اشتراك ${days} يومًا للمستخدم ${userId}.`);
      try {
        await U.sendMessage(userId, `🎉 تم تفعيل اشتراكك لمدة ${days} يومًا. شكرًا لاستخدامك البوت!`);
      } catch (_) {}
      await showSubscription(chatId, null);
      return true;
    }
    case 'await_sub_revoke_id': {
      const id = parseInt(text.trim(), 10);
      if (!Number.isFinite(id)) {
        await U.sendMessage(chatId, '⚠️ أرسل معرف تلجرام رقمي صالح، أو /cancel للإلغاء.');
        return true;
      }
      await D.removeSubscription(id);
      adminSessions.delete(chatId);
      await U.sendMessage(chatId, `✅ تم سحب اشتراك المستخدم ${id}.`);
      await showSubscription(chatId, null);
      return true;
    }
    case 'await_broadcast_text': {
      adminSessions.delete(chatId);
      await U.sendMessage(chatId, '⏳ جارٍ إرسال الرسالة الجماعية...');
      const ids = await D.listUserIds();
      let sent = 0;
      let failed = 0;
      for (const id of ids) {
        try {
          await U.sendMessage(id, text);
          sent++;
        } catch (_) {
          failed++;
        }
        await new Promise((r) => setTimeout(r, 40));
      }
      await U.sendMessage(chatId, `✅ اكتمل البث.\nتم الإرسال إلى: ${sent}\nفشل: ${failed}`);
      await showComm(chatId, null);
      return true;
    }
    case 'await_finance_add': {
      const parts = text.trim().split(/\s+/);
      const amount = Number(parts[0]);
      const note = parts.slice(1).join(' ');
      if (!Number.isFinite(amount)) {
        await U.sendMessage(chatId, '⚠️ الصيغة: <المبلغ> <ملاحظة اختيارية>\nمثال: 15 اشتراك شهري - أحمد\nأو /cancel للإلغاء.');
        return true;
      }
      await D.addFinanceRecord({ amount, note });
      adminSessions.delete(chatId);
      await U.sendMessage(chatId, '✅ تم تسجيل الحركة المالية.');
      await showFinance(chatId, null);
      return true;
    }
    default:
      return false;
  }
}

/* ================= معالجة أزرار لوحة الإدمن ================= */

async function handleAdminCallback(cq) {
  const chatId = cq.message.chat.id;
  const messageId = cq.message.message_id;
  const data = cq.data;

  if (!isAdmin(chatId)) {
    await U.answerCallback(cq.id, '⚠️ هذا القسم للإدمن فقط');
    return;
  }

  switch (data) {
    case 'admin:main':
      adminSessions.delete(chatId);
      await showAdminMain(chatId, messageId);
      break;
    case 'admin:settings':
      await showSettings(chatId, messageId);
      break;
    case 'admin:content':
      await showContent(chatId, messageId);
      break;
    case 'admin:users':
      await showUsers(chatId, messageId);
      break;
    case 'admin:sub':
      await showSubscription(chatId, messageId);
      break;
    case 'admin:comm':
      await showComm(chatId, messageId);
      break;
    case 'admin:finance':
      await showFinance(chatId, messageId);
      break;
    case 'admin:system':
      await showSystem(chatId, messageId);
      break;
    case 'admin:guide':
      await showGuide(chatId, messageId);
      break;

    case 'admin:toggle_ban_notif': {
      const cur = await D.getSetting('notify_on_ban', true);
      await D.setSetting('notify_on_ban', !cur);
      await showAdminMain(chatId, messageId);
      break;
    }
    case 'admin:toggle_join_notif': {
      const cur = await D.getSetting('notify_admin_on_join', true);
      await D.setSetting('notify_admin_on_join', !cur);
      await showAdminMain(chatId, messageId);
      break;
    }
    case 'admin:toggle_maintenance': {
      const cur = await D.getSetting('maintenance_mode', false);
      await D.setSetting('maintenance_mode', !cur);
      await showSettings(chatId, messageId);
      break;
    }

    case 'admin:set_support_contact':
      startAdminInput(chatId, 'await_support_contact');
      await U.sendMessage(chatId, '✏️ أرسل جهة تواصل الدعم الجديدة (رابط أو يوزر)، أو /cancel للإلغاء.');
      break;

    case 'admin:edit_welcome':
      startAdminInput(chatId, 'await_welcome_text');
      await U.sendMessage(chatId, '✏️ أرسل نص رسالة الترحيب الجديد (يدعم HTML البسيط مثل <b> و <i>)، أو /cancel للإلغاء.');
      break;

    case 'admin:user_lookup':
      startAdminInput(chatId, 'await_lookup_id');
      await U.sendMessage(chatId, '🔎 أرسل معرف تلجرام (رقم) الخاص بالمستخدم، أو /cancel للإلغاء.');
      break;
    case 'admin:user_ban':
      startAdminInput(chatId, 'await_ban_id');
      await U.sendMessage(chatId, '⛔ أرسل معرف تلجرام (رقم) للمستخدم المراد حظره، أو /cancel للإلغاء.');
      break;
    case 'admin:user_unban':
      startAdminInput(chatId, 'await_unban_id');
      await U.sendMessage(chatId, '✅ أرسل معرف تلجرام (رقم) للمستخدم المراد إلغاء حظره، أو /cancel للإلغاء.');
      break;

    case 'admin:sub_grant':
      startAdminInput(chatId, 'await_sub_grant_id');
      await U.sendMessage(chatId, '➕ أرسل معرف تلجرام (رقم) للمستخدم المراد منحه اشتراكًا، أو /cancel للإلغاء.');
      break;
    case 'admin:sub_revoke':
      startAdminInput(chatId, 'await_sub_revoke_id');
      await U.sendMessage(chatId, '➖ أرسل معرف تلجرام (رقم) للمستخدم المراد سحب اشتراكه، أو /cancel للإلغاء.');
      break;

    case 'admin:broadcast':
      startAdminInput(chatId, 'await_broadcast_text');
      await U.sendMessage(chatId, '📢 أرسل نص الرسالة الجماعية التي تريد بثّها لجميع المستخدمين، أو /cancel للإلغاء.');
      break;

    case 'admin:finance_add':
      startAdminInput(chatId, 'await_finance_add');
      await U.sendMessage(chatId, '➕ أرسل: <المبلغ> ثم ملاحظة اختيارية\nمثال: 15 اشتراك شهري - أحمد\nأو /cancel للإلغاء.');
      break;

    default:
      break;
  }

  await U.answerCallback(cq.id);
}

module.exports = {
  isAdmin,
  showAdminMain,
  handleAdminCallback,
  handleAdminText,
  adminSessions,
};
