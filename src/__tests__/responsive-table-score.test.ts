import { parseScoreValue, getScoreBadgeClass } from "@/components/chat/ResponsiveTable";

describe("ResponsiveTable Score Parsing and Classification", () => {
  it("parses scores in 'X / Y' format", () => {
    expect(parseScoreValue("7 / 10")).toEqual({ score: 7, max: 10 });
    expect(parseScoreValue("45 / 100")).toEqual({ score: 45, max: 100 });
    expect(parseScoreValue("3 / 10")).toEqual({ score: 3, max: 10 });
    expect(parseScoreValue("10 / 10")).toEqual({ score: 10, max: 10 });
  });

  it("parses bare numeric scores with default max of 10", () => {
    expect(parseScoreValue("8")).toEqual({ score: 8, max: 10 });
    expect(parseScoreValue("2")).toEqual({ score: 2, max: 10 });
  });

  it("returns null for non-score strings", () => {
    expect(parseScoreValue("N/A")).toBeNull();
    expect(parseScoreValue("Unscored")).toBeNull();
    expect(parseScoreValue("")).toBeNull();
  });

  it("classifies scores into correct badge tiers", () => {
    expect(getScoreBadgeClass(7, 10)).toBe("scoreHigh");
    expect(getScoreBadgeClass(9, 10)).toBe("scoreHigh");
    expect(getScoreBadgeClass(80, 100)).toBe("scoreHigh");
    expect(getScoreBadgeClass(5, 10)).toBe("scoreMedium");
    expect(getScoreBadgeClass(4, 10)).toBe("scoreMedium");
    expect(getScoreBadgeClass(3, 10)).toBe("scoreLow");
    expect(getScoreBadgeClass(1, 10)).toBe("scoreLow");
  });
});
