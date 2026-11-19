import { describe, expect, it } from "vitest";
import { groupRange, toggleGroup } from "./group-selection.js";

describe("worksheet group selection", () => {
  const groups = ["G1", "G2", "G3", "G4"];

  it("selects forward and reverse drag ranges in worksheet order", () => {
    expect(groupRange(groups, 0, 2)).toEqual(["G1", "G2", "G3"]);
    expect(groupRange(groups, 3, 1)).toEqual(["G2", "G3", "G4"]);
  });

  it("clamps a range to the available group rows", () => {
    expect(groupRange(groups, -5, 50)).toEqual(groups);
    expect(groupRange([], 0, 1)).toEqual([]);
  });

  it("preserves additive selection while maintaining source row order", () => {
    expect(groupRange(groups, 1, 2, ["G4"])).toEqual(["G2", "G3", "G4"]);
  });

  it("toggles an individual group without changing the order", () => {
    expect(toggleGroup(groups, ["G1", "G3"], "G3")).toEqual(["G1"]);
    expect(toggleGroup(groups, ["G1"], "G4")).toEqual(["G1", "G4"]);
  });
});
