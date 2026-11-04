import { fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import DemoExperience from "../DemoExperience";
import {
  DEMO_BADGE,
  DEMO_CARD_HEADER,
  DEMO_CARD_SENTENCE_A,
  DEMO_CARD_SENTENCE_B,
  DEMO_CTA,
  DEMO_FRAMING,
} from "../../constants/paywallCopy";
import { DEMO_PROFILES, demoModelCard } from "../../demo/demoContent";

describe("demo experience", () => {
  it("renders both examples from saved content and does not call the AI proxies", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onStart = vi.fn();
    render(<DemoExperience onStart={onStart} />);
    expect(screen.getAllByText(DEMO_BADGE).length).toBeGreaterThan(0);
    expect(screen.getByText(DEMO_PROFILES.A.description)).toBeInTheDocument();
    expect(screen.getByText(DEMO_CARD_SENTENCE_A)).toBeInTheDocument();
    expect(screen.getByText("google/gemini-3.8-flash")).toBeInTheDocument();
    expect(screen.getByText("Mean 80, runs 70 to 85")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Example B/ }));
    expect(screen.getByText(DEMO_PROFILES.B.description)).toBeInTheDocument();
    expect(screen.getByText(DEMO_CARD_SENTENCE_B)).toBeInTheDocument();
    expect(screen.getByTestId("demo-model-card").textContent ?? "").not.toMatch(/Neuroticism/);
    fireEvent.click(screen.getByRole("button", { name: DEMO_CTA }));
    expect(onStart).toHaveBeenCalledOnce();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("does not import chat or judge proxies", () => {
    const sources = [
      "src/components/DemoExperience.tsx",
      "src/demo/demoContent.ts",
      "src/components/AccessFlow.tsx",
    ].map((path) => readFileSync(path, "utf8")).join("\n");
    expect(sources).not.toMatch(/chatProxy|judgeProxy|chatWithGemini|judgeOcean|matchModels/);
    const copy = readFileSync("src/constants/paywallCopy.ts", "utf8");
    expect(copy).toContain(DEMO_FRAMING);
    expect(copy).toContain(DEMO_CARD_HEADER);
  });

  it("keeps the strategy sentence off you and your, except the required lines", () => {
    for (const profile of ["A", "B"] as const) {
      const card = demoModelCard(profile);
      const visible = [card.sentence, card.title, ...card.chips, ...card.rows.map((row) => row.label)].join(" ");
      const stripped = visible.replace("(not you)", "").replace("not computed for you", "");
      expect(stripped).not.toMatch(/\byour\b|\byou\b|fits you|recommended|\bbest\b/i);
      expect(card.modelId).toBe("google/gemini-3.8-flash");
      expect(card.fewerRunsTag).toBeNull();
    }
  });
});
