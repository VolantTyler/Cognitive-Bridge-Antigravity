import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import OceanCards, { OCEAN_TILE_MIN_PX, oceanLabelFits } from "../OceanCards";

const scores = {
  openness: 85,
  conscientiousness: 25,
  extroversion: 50,
  agreeableness: 50,
  neuroticism: 50,
};

describe("ocean trait tiles", () => {
  it("spells Extraversion and keeps each label inside a 140px tile", () => {
    render(<OceanCards scores={scores} />);
    const grid = document.querySelector("[data-ocean-grid]");
    expect(grid).toHaveStyle({ gridTemplateColumns: `repeat(auto-fit, minmax(${OCEAN_TILE_MIN_PX}px, 1fr))` });
    const labels = document.querySelectorAll("[data-ocean-label]");
    expect(labels.length).toBe(5);
    for (const label of labels) {
      const text = label.textContent ?? "";
      expect(text).not.toMatch(/Extroversion/);
      expect(label.className).toMatch(/whitespace-nowrap/);
      expect(label.className).not.toMatch(/tracking-\[0\.1em\]|break-all/);
      expect(oceanLabelFits(text)).toBe(true);
    }
    expect(screen.getByText("Extraversion")).toBeInTheDocument();
    expect(oceanLabelFits("CONSCIENTIOUSNESS")).toBe(true);
  });
});
