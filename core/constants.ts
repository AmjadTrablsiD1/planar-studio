// Rule 11: the one constants file, read by core/ and server/ under Node and
// bundled into the UI by Vite through the same import. The catalogue (cores,
// ferrites) is data, not constants, and comes from library.json.
import constants from "../shared/constants.json" with { type: "json" };
import library from "../shared/library.json" with { type: "json" };

export const C = constants;
export type Constants = typeof constants;
export const LIB = library;

export const MU0 = C.physics.mu0;
export const EPS0 = C.physics.eps0;
export const MM = 1e-3;
export const UM = 1e-6;
