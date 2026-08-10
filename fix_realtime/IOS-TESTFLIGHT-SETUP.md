# iOS / TestFlight

المشروع مجهز بـ Capacitor ومعرف التطبيق:

com.naif.mafiagame

## على جهاز Mac

1. ثبت Node.js و Xcode.
2. افتح Terminal داخل المشروع.
3. نفذ:

npm install
npm run cap:add:ios
npm run cap:ios

4. سيفتح Xcode.
5. اختر Team الخاص بحساب Apple Developer.
6. تأكد أن Bundle Identifier هو com.naif.mafiagame أو غيّره إلى معرفك النهائي قبل أول رفع.
7. اختر جهاز Any iOS Device.
8. Product > Archive.
9. من Organizer اختر Distribute App > App Store Connect > Upload.
10. افتح App Store Connect ثم TestFlight وأضف المختبرين.

## قبل البناء النهائي

في .env.production يجب أن تكون قيمة:

VITE_SERVER_URL=https://YOUR-RENDER-SERVICE.onrender.com

ثم:

npm run cap:ios
