// Rule 11: the UI reads the same constants file as the core.
import constants from "../../shared/constants.json";
import themes from "../../shared/themes.json";

export const C = constants;
export const THEMES = themes as unknown as Record<string, Record<string, string>>;
export const THEME_IDS = Object.keys(THEMES).filter((k) => !k.startsWith("_"));
