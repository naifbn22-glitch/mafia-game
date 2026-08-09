# تشغيل الخادم محليًا

1. انسخ `.env.example` إلى `.env`.
2. نفذ:

```bash
npm install
npm run build
npm start
```

3. افتح `http://localhost:3000`.

# النشر

الخادم يحتاج استضافة تدعم WebSocket مثل Render أو Railway.
بعد نشر الخادم، أضف متغير `VITE_SERVER_URL` في Vercel بقيمة رابط الخادم، ثم أعد نشر الواجهة.
وفي Render أضف `ALLOWED_ORIGINS` بقيمة رابط Vercel.
