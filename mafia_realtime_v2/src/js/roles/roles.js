import { thiefRole } from "./thief.js";
import { nurseRole } from "./nurse.js";
import { kingRole } from "./king.js";
import { citizenRole } from "./citizen.js";

export const ROLE_IDS = Object.freeze({
  THIEF: "thief",
  NURSE: "nurse",
  KING: "king",
  CITIZEN: "citizen",
});

export const TEAMS = Object.freeze({
  THIEVES: "thieves",
  CITIZENS: "citizens",
});

export const ROLE_DEFINITIONS = Object.freeze({
  [ROLE_IDS.THIEF]: thiefRole,
  [ROLE_IDS.NURSE]: nurseRole,
  [ROLE_IDS.KING]: kingRole,
  [ROLE_IDS.CITIZEN]: citizenRole,
});

export function getRoleDetails(roleId) {
  return (
    ROLE_DEFINITIONS[roleId] ??
    ROLE_DEFINITIONS[ROLE_IDS.CITIZEN]
  );
}

export function isRoleOnTeam(roleId, teamId) {
  return getRoleDetails(roleId).team === teamId;
}

export function roleHasNightAction(roleId) {
  return Boolean(
    getRoleDetails(roleId).hasNightAction,
  );
}