export const citizenRole = Object.freeze({
  id: "citizen",

  name: "المواطن",
  pluralName: "المواطنون",

  team: "citizens",

  icon: "👤",
  colorClass: "role-citizen",

  description:
    "ناقش الأدلة وصوّت لإخراج اللاعب الذي تعتقد أنه لص.",

  objective:
    "اكتشف جميع اللصوص وأخرجهم قبل سيطرتهم على المدينة.",

  hasNightAction: false,
  nightOrder: null,

  card: {
    title: "المواطن",
    symbol: "👤",
    image: "/roles/citizen-card.png",
    themeClass: "role-card-citizen",
  },
});