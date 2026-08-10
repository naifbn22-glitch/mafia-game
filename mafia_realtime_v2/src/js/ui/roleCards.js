const ROLE_CARD_IMAGES = Object.freeze({
  thief: {
    male: "/cards/thief-male.png",
    female: "/cards/thief-female.png",
  },

  king: {
    male: "/cards/king-male.png",
    female: "/cards/king-female.png",
  },

  nurse: {
    male: "/cards/nurse-male.png",
    female: "/cards/nurse-female.png",
  },

  citizen: {
    male: "/cards/citizen-male.png",
    female: "/cards/citizen-female.png",
  },

  investigator: {
    male: "/cards/investigator-male.png",
    female: "/cards/investigator-female.png",
  },
});

export function getRoleCardImage(
  roleId,
  gender = "male",
) {
  const roleImages = ROLE_CARD_IMAGES[roleId];

  if (!roleImages) {
    return null;
  }

  return (
    roleImages[gender] ??
    roleImages.male ??
    Object.values(roleImages)[0] ??
    null
  );
}