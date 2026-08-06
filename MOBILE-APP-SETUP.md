# تشغيل المشروع كتطبيق Android و iOS

## 1. تثبيت الحزم

```bash
npm install
```

## 2. بناء نسخة الويب

```bash
npm run build
```

## 3. إنشاء مشروع Android لأول مرة

```bash
npm run cap:add:android
npm run cap:android
```

يحتاج Android Studio مثبتًا على Windows أو macOS.

## 4. إنشاء مشروع iOS لأول مرة

```bash
npm run cap:add:ios
npm run cap:ios
```

إنشاء تطبيق iOS وفتحه يحتاج جهاز macOS مع Xcode.

## 5. بعد أي تعديل في ملفات الموقع

```bash
npm run cap:sync
```

ثم افتح المشروع الأصلي:

```bash
npx cap open android
```

أو:

```bash
npx cap open ios
```

## ملاحظة نظام الغرف

نظام الغرف الحالي يعتمد على localStorage و BroadcastChannel، لذلك يعمل بين تبويبات المتصفح على الجهاز ونطاق الموقع نفسه. تشغيل الغرف بين هواتف مختلفة يحتاج ربط خدمة مزامنة مركزية مثل Firebase أو Supabase. تجهيز Capacitor يحول الواجهة إلى تطبيق، لكنه لا يحول التخزين المحلي وحده إلى شبكة متعددة الأجهزة.
