import type { ScenarioSpec } from "./types";

export const FOUR_SUNS: ScenarioSpec = {
  tier: "exact",
  title: "Four suns",
  question: "What if our solar system had four suns?",
  params: {
    engine: "gravity",
    duration_yr: 30,
    frames: 1500,
    bodies: [
      { name: "Sun A", mass_msun: 1, pos_au: [1, 0, 0], vel_au_yr: [0, 3.2, 0] },
      { name: "Sun B", mass_msun: 1, pos_au: [0, 1, 0], vel_au_yr: [-3.2, 0, 0] },
      { name: "Sun C", mass_msun: 1, pos_au: [-1, 0, 0], vel_au_yr: [0, -3.2, 0] },
      { name: "Sun D", mass_msun: 1, pos_au: [0, -1, 0], vel_au_yr: [3.2, 0, 0] },
      { name: "Earth", mass_msun: 3e-6, pos_au: [5, 0, 0], vel_au_yr: [0, 5.6, 0] },
    ],
  },
  assumptions: ["point masses", "no tides"],
};
