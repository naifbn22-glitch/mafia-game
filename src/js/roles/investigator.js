export const investigatorRole = Object.freeze({
  id: "investigator",

  name: "المحقق",
  pluralName: "المحققون",

  team: "citizens",

  icon: "🕵️",
  colorClass: "role-investigator",
  className: "role-investigator",

  description:
    "اختر لاعبًا واحدًا كل ليلة لكشف هويته. يظهر الملك والممرض والمواطن كمواطنين حفاظًا على سرية الأدوار.",

  objective:
    "استخدم نتائج التحقيق لمساعدة المواطنين على اكتشاف اللصوص دون كشف هويتك.",

  hasNightAction: true,
  nightOrder: 4,

  card: {
    title: "المحقق",
    symbol: "🕵️",
    image: "/roles/investigator-card.png",
    themeClass: "role-card-investigator",
  },
});
