import { describe, it, expect } from "vitest";
import { tempCondition } from "./temperature.js";

// Ideal band 70–76°F throughout.
const MIN = 70;
const MAX = 76;

describe("tempCondition", () => {
  it("is green inside the ideal band (inclusive)", () => {
    expect(tempCondition(70, MIN, MAX).key).toBe("green");
    expect(tempCondition(73, MIN, MAX).key).toBe("green");
    expect(tempCondition(76, MIN, MAX).key).toBe("green");
  });

  // Hot side: yellow +5, orange +10, red +15.
  it("grades the hot side", () => {
    expect(tempCondition(80, MIN, MAX).key).toBe("yellow"); // +4
    expect(tempCondition(81, MIN, MAX).key).toBe("yellow"); // +5 edge
    expect(tempCondition(85, MIN, MAX).key).toBe("orange"); // +9
    expect(tempCondition(86, MIN, MAX).key).toBe("orange"); // +10 edge
    expect(tempCondition(90, MIN, MAX).key).toBe("red"); // +14
    expect(tempCondition(100, MIN, MAX).key).toBe("red"); // beyond +15
  });

  // Cold side: yellow -5, orange -15, red -25 (more cold tolerance).
  it("grades the cold side", () => {
    expect(tempCondition(66, MIN, MAX).key).toBe("yellow"); // -4
    expect(tempCondition(65, MIN, MAX).key).toBe("yellow"); // -5 edge
    expect(tempCondition(60, MIN, MAX).key).toBe("orange"); // -10
    expect(tempCondition(55, MIN, MAX).key).toBe("orange"); // -15 edge
    expect(tempCondition(50, MIN, MAX).key).toBe("red"); // -20
    expect(tempCondition(40, MIN, MAX).key).toBe("red"); // beyond -25
  });

  it("treats cold more forgivingly than heat (asymmetry)", () => {
    // 12° below stays orange, but 12° above is already red.
    expect(tempCondition(MIN - 12, MIN, MAX).key).toBe("orange");
    expect(tempCondition(MAX + 12, MIN, MAX).key).toBe("red");
  });

  it("is green when temp is missing", () => {
    expect(tempCondition(null, MIN, MAX).key).toBe("green");
    expect(tempCondition(NaN, MIN, MAX).key).toBe("green");
  });
});
