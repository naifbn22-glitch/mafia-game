# Naif Mafia Realtime Architecture

## البنية

- Web: Vite + Vercel
- Realtime backend: Node.js + Express + Socket.IO
- Realtime horizontal scaling: Redis + Socket.IO Redis adapter
- Persistence: PostgreSQL / Supabase
- iOS and Android: Capacitor

## متغيرات البيئة للواجهة

في Vercel:

VITE_SERVER_URL=https://YOUR-RENDER-SERVICE.onrender.com

## متغيرات البيئة للخادم

في Render:

NODE_ENV=production
ALLOWED_ORIGINS=https://YOUR-VERCEL-DOMAIN.vercel.app,https://localhost
REDIS_URL=redis://...
DATABASE_URL=postgresql://...

## تشغيل محلي

Terminal 1:

npm install
npm run build
npm start

Terminal 2 للتطوير فقط:

npm run dev

إذا شغلت الواجهة على Vite أثناء التطوير، أنشئ ملف .env.local:

VITE_SERVER_URL=http://localhost:3000

## ملاحظات الأمان

- توزيع الأدوار يتم على الخادم.
- اختيار الضحية والحماية والتحقيق والعفو يتم التحقق منه على الخادم.
- اللاعب يستقبل دوره فقط، واللص يستقبل هوية زملائه اللصوص فقط.
- صفحة البث لا تستقبل الأدوار السرية.
- المدير يستخدم رمز جلسة منفصل.
- اللاعب يستخدم رمز جلسة منفصل لإعادة الاتصال.
