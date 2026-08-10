export const kingRole = Object.freeze({
  id: "king",

  name: "الملك",
  pluralName: "الملوك",

  team: "citizens",

  icon: "♛",
  colorClass: "role-king",

  description:
    "افحص لاعبًا واحدًا أثناء الليل لمعرفة شخصيته.",

  objective:
    "استخدم نتائج التحقيق لمساعدة المواطنين على كشف اللصوص.",

  hasNightAction: true,
  nightOrder: 3,

  card: {
    title: "الملك",
    symbol: "♛",
    image: "/roles/king-card.png",
    themeClass: "role-card-king",
  },
});