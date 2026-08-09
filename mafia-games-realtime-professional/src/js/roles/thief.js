export const thiefRole = Object.freeze({
  id: "thief",

  name: "اللص",
  pluralName: "اللصوص",

  team: "thieves",

  icon: "🗡️",
  colorClass: "role-thief",

  description:
    "استيقظ مع بقية اللصوص واختر لاعبًا لإخراجه أثناء الليل.",

  objective:
    "تخلّص من المواطنين حتى يصبح عدد اللصوص مساويًا لعددهم.",

  hasNightAction: true,
  nightOrder: 1,

  card: {
    title: "اللص",
    symbol: "🗡️",
    image: "/roles/thief-card.png",
    themeClass: "role-card-thief",
  },
});