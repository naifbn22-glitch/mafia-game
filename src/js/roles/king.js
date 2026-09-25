export const kingRole = Object.freeze({
  id: "king",

  name: "الملك",
  pluralName: "الملوك",

  team: "citizens",

  icon: "♛",
  colorClass: "role-king",
  className: "role-king",

  description:
    "لديك 3 أوسمة عفو طوال المباراة. امنح لاعبًا واحدًا عفوًا ملكيًا أو احتفظ بالوسام، ولا يمكنك اختيار نفسك.",

  objective:
    "استخدم أوسمة العفو في الوقت المناسب لحماية اللاعبين الذين تثق بهم من الإقصاء بالتصويت.",

  hasNightAction: true,
  nightOrder: 3,

  card: {
    title: "الملك",
    symbol: "♛",
    image: "/roles/king-card.png",
    themeClass: "role-card-king",
  },
});
