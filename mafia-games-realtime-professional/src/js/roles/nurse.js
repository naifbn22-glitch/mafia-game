export const nurseRole = Object.freeze({
  id: "nurse",

  name: "الممرضة",
  pluralName: "الممرضات",

  team: "citizens",

  icon: "✚",
  colorClass: "role-nurse",

  description:
    "اختر لاعبًا واحدًا لحمايته من هجوم اللصوص أثناء الليل.",

  objective:
    "ساعد المواطنين في اكتشاف جميع اللصوص وإخراجهم.",

  hasNightAction: true,
  nightOrder: 2,

  card: {
    title: "الممرضة",
    symbol: "✚",
    image: "/roles/nurse-card.png",
    themeClass: "role-card-nurse",
  },
});