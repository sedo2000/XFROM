// api/db.js
// طبقة تخزين بيانات لوحة الإدمن باستخدام Vercel KV المتوافقة والمربوطة عبر Upstash Redis مجاناً.

const { createClient } = require('@vercel/kv');

// جلب المتغيرات بالأسماء الدقيقة التي تم إنشاؤها في لوحة تحكم Upstash
const url = process.env.UPSTASH_KV_REST_API_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_KV_REST_API_TOKEN || process.env.KV_REST_API_TOKEN;

if (!url || !token) {
  console.error("⚠️ Upstash KV environment variables are missing!");
}

// إنشاء مثيل مخصص يتوافق مع إعدادات التسمية الجديدة
const kv = createClient({
  url: url,
  token: token,
});

/* ================= المستخدمون ================= */

// يُستدعى مع كل تحديث وارد لتسجيل/تحديث بيانات المستخدم.
// يعيد { data, isNew } حيث isNew=true إذا كانت هذه أول مرة نراه فيها.
async function upsertUser(tgUser) {
  if (!tgUser || !tgUser.id) return { data: null, isNew: false };
  const key = `user:${tgUser.id}`;
  const existing = await kv.get(key);
  const now = Date.now();
  const data = {
    id: tgUser.id,
    username: tgUser.username || null,
    firstName: tgUser.first_name || null,
    lastName: tgUser.last_name || null,
    joinedAt: existing && existing.joinedAt ? existing.joinedAt : now,
    lastSeen: now,
    banned: existing ? !!existing.banned : false,
    messageCount: (existing && existing.messageCount ? existing.messageCount : 0) + 1,
  };
  await kv.set(key, data);
  await kv.sadd('users:all', String(tgUser.id));
  return { data, isNew: !existing };
}

async function getUser(id) {
  return await kv.get(`user:${id}`);
}

async function listUserIds() {
  return (await kv.smembers('users:all')) || [];
}

async function countUsers() {
  return (await kv.scard('users:all')) || 0;
}

async function banUser(id) {
  const u = await getUser(id);
  if (!u) return false;
  u.banned = true;
  await kv.set(`user:${id}`, u);
  return true;
}

async function unbanUser(id) {
  const u = await getUser(id);
  if (!u) return false;
  u.banned = false;
  await kv.set(`user:${id}`, u);
  return true;
}

async function isBanned(id) {
  const u = await getUser(id);
  return !!(u && u.banned);
}

async function countBanned() {
  const ids = await listUserIds();
  const users = await Promise.all(ids.map((id) => getUser(id)));
  return users.filter((u) => u && u.banned).length;
}

/* ================= الإعدادات (settings) ================= */
// تُستخدم لتبديلات لوحة الإدمن: وضع الصيانة، إشعار الحظر، إشعار الدخول، إلخ.

async function getSetting(key, def = null) {
  const v = await kv.get(`setting:${key}`);
  return v === null || v === undefined ? def : v;
}

async function setSetting(key, val) {
  await kv.set(`setting:${key}`, val);
}

/* ================= المحتوى (content) ================= */
// نصوص قابلة للتعديل من لوحة الإدمن (رسالة الترحيب، نص الدليل، إلخ).

async function getContent(key, def = '') {
  const v = await kv.get(`content:${key}`);
  return v === null || v === undefined ? def : v;
}

async function setContent(key, val) {
  await kv.set(`content:${key}`, val);
}

/* ================= المالية (finance) ================= */
// سجلّات مالية تُضاف يدويًا من لوحة الإدمن (لا يوجد بوابة دفع مربوطة حاليًا).

async function addFinanceRecord(rec) {
  const id = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const full = { ...rec, id, at: Date.now() };
  await kv.set(`finance:${id}`, full);
  await kv.sadd('finance:all', id);
  return full;
}

async function listFinanceRecords(limit = 20) {
  const ids = await kv.smembers('finance:all');
  const recs = await Promise.all((ids || []).map((id) => kv.get(`finance:${id}`)));
  return recs
    .filter(Boolean)
    .sort((a, b) => b.at - a.at)
    .slice(0, limit);
}

async function financeTotal() {
  const ids = await kv.smembers('finance:all');
  const recs = await Promise.all((ids || []).map((id) => kv.get(`finance:${id}`)));
  return recs.filter(Boolean).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
}

/* ================= الاشتراكات (subscriptions) ================= */

async function getSubscription(id) {
  return await kv.get(`sub:${id}`);
}

async function setSubscription(id, sub) {
  await kv.set(`sub:${id}`, sub);
  await kv.sadd('subs:all', String(id));
}

async function removeSubscription(id) {
  await kv.del(`sub:${id}`);
}

async function listActiveSubs() {
  const ids = (await kv.smembers('subs:all')) || [];
  const subs = await Promise.all(ids.map(async (id) => ({ id, sub: await kv.get(`sub:${id}`) })));
  const now = Date.now();
  return subs.filter((s) => s.sub && s.sub.expiresAt && s.sub.expiresAt > now);
}

module.exports = {
  upsertUser,
  getUser,
  listUserIds,
  countUsers,
  banUser,
  unbanUser,
  isBanned,
  countBanned,
  getSetting,
  setSetting,
  getContent,
  setContent,
  addFinanceRecord,
  listFinanceRecords,
  financeTotal,
  getSubscription,
  setSubscription,
  removeSubscription,
  listActiveSubs,
};
