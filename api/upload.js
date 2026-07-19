export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      // هنا تضع منطق معالجة البيانات القادمة من التطبيق الخاص بك
      return res.status(200).json({ 
        success: true, 
        message: "تم استلام الطلب في الخلفية بنجاح!" 
      });
    } catch (error) {
      return res.status(500).json({ error: "حدث خطأ أثناء المعالجة" });
    }
  } else {
    res.setHeader('Allow', ['POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}
