# تشغيل ونشر Mafia Game عبر الإنترنت

تم ربط وضع اللعب عبر الشبكة بخادم Node.js حقيقي. الخادم يزامن الغرف بين الأجهزة باستخدام Server-Sent Events وطلبات HTTP، ويقدم ملفات الموقع من مجلد `dist`.

## التشغيل على جهازك

```bash
npm install
npm run build
npm start
```

افتح:

```text
http://localhost:3000
```

لا تستخدم `npm run dev` عند اختبار الخادم، لأن هذا الأمر يشغل واجهة Vite فقط على المنفذ 5173.

## النشر على Render

استخدم الإعدادات التالية:

```text
Runtime: Node
Build Command: npm install && npm run build
Start Command: npm start
Health Check Path: /api/health
```

بعد نجاح النشر تحصل على رابط عام ينتهي بـ `onrender.com`.

## التخزين

الغرف محفوظة مؤقتًا داخل `data/rooms.json`. هذا مناسب للاختبار الأول. للتشغيل العام المستقر، يجب نقل التخزين لاحقًا إلى PostgreSQL أو Redis لأن القرص المحلي في بعض خطط الاستضافة قد لا يكون دائمًا.
