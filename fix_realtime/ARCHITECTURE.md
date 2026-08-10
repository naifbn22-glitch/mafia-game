# Realtime game architecture

## Server-authoritative state

الخادم هو المصدر الوحيد لحالة اللعب عبر الشبكة. المتصفح لا يوزع الأدوار ولا يعتمد الاختيارات النهائية.

## Socket rooms

- room:CODE:host
- room:CODE:public
- room:CODE:player:PLAYER_ID

بهذا لا يتم إرسال المعلومات السرية إلى صفحة البث أو إلى اللاعبين غير المخولين.

## Fast state and persistence

Redis يحتفظ بالحالة السريعة للغرف ويدعم توسيع Socket.IO على أكثر من نسخة خادم.
PostgreSQL يحتفظ بنسخة دائمة من الغرف كطبقة استرجاع.

## Reconnect

الواجهة تحتفظ برمز جلسة المدير أو اللاعب وتعيد الاشتراك في الغرفة تلقائيًا بعد انقطاع الشبكة.
