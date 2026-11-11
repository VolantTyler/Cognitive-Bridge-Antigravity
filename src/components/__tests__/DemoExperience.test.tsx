import { fireEvent, render, screen, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import DemoExperience from "../DemoExperience";
import {
  DEMO_CARD_HEADER,
  DEMO_CARD_SENTENCE_A,
  DEMO_CARD_SENTENCE_B,
  DEMO_CLOSING_LINE,
  DEMO_CLOSING_TITLE,
  DEMO_CTA,
  DEMO_CTA_CAPTION,
  DEMO_FRAMING,
  DEMO_HERO_LEDE,
  DEMO_HERO_TITLE,
  DEMO_HOW_BRIDGE,
  DEMO_HOW_MIRROR,
  DEMO_HOW_TAILOR,
  DEMO_REPLY_FOOTER,
  DEMO_RIBBON,
  DEMO_SEE_EXAMPLE,
} from "../../constants/paywallCopy";
import {
  DEMO_PROFILES,
  DEMO_QUESTION,
  DEMO_REPLY_EXPLORER,
  DEMO_REPLY_NONE,
  DEMO_REPLY_PLANNER,
  demoModelCard,
} from "../../demo/demoContent";

const RESEARCH_COPY = [
  DEMO_HERO_TITLE,
  DEMO_HERO_LEDE,
  DEMO_HOW_MIRROR,
  DEMO_HOW_TAILOR,
  DEMO_HOW_BRIDGE,
  DEMO_RIBBON,
  DEMO_FRAMING,
] as const;

describe("demo experience", () => {
  it("renders both examples from saved content and does not call the AI proxies", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onStart = vi.fn();
    render(<DemoExperience onStart={onStart} />);
    expect(screen.getByText(DEMO_PROFILES.A.description)).toBeInTheDocument();
    expect(screen.getByText(DEMO_CARD_SENTENCE_A)).toBeInTheDocument();
    expect(screen.getByText("google/gemini-3.8-flash")).toBeInTheDocument();
    expect(screen.getByText("Mean 80, runs 70 to 85")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "The Planner" }));
    expect(screen.getByText(DEMO_PROFILES.B.description)).toBeInTheDocument();
    expect(screen.getByText(DEMO_CARD_SENTENCE_B)).toBeInTheDocument();
    expect(screen.getByTestId("demo-model-card").textContent ?? "").not.toMatch(/Neuroticism/);
    fireEvent.click(screen.getAllByRole("button", { name: DEMO_CTA })[0]);
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

  it("uses the research-review copy and keeps the experiment disclaimer word for word", () => {
    render(<DemoExperience onStart={vi.fn()} />);
    for (const line of RESEARCH_COPY) {
      expect(screen.getByText(line)).toBeInTheDocument();
    }
    expect(screen.getByText(DEMO_CTA_CAPTION)).toBeInTheDocument();
    expect(screen.getByText(DEMO_CLOSING_TITLE)).toBeInTheDocument();
    expect(screen.getByText(DEMO_CLOSING_LINE)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: DEMO_SEE_EXAMPLE })).toHaveAttribute("href", "#example");
    expect(document.body.textContent ?? "").not.toMatch(/No AI was used/);
    expect(document.body.textContent ?? "").not.toMatch(/made-up/i);
    expect(screen.getAllByText(DEMO_RIBBON)).toHaveLength(1);
    expect(DEMO_FRAMING).toBe(
      "Cognitive Bridge is an experiment. It draws on published personality research, but it has not been tested or validated. It is not a psychological, clinical, or medical assessment. The model match is our untested guess.",
    );
  });

  it("shows one example ribbon and keeps the disclaimer beside the panel", () => {
    render(<DemoExperience onStart={vi.fn()} />);
    const section = document.getElementById("example");
    const body = screen.getByTestId("example-panel-body");
    const ribbon = screen.getByTestId("example-ribbon");
    const disclaimer = screen.getByTestId("example-disclaimer");
    const panel = screen.getByTestId("example-panel");
    expect(section).not.toBeNull();
    expect(section?.className).toMatch(/max-md:max-h-\[calc\(100dvh-4rem\)\]/);
    expect(section?.contains(ribbon)).toBe(true);
    expect(section?.contains(disclaimer)).toBe(true);
    expect(body.contains(ribbon)).toBe(false);
    expect(body.contains(disclaimer)).toBe(false);
    expect(body.className).toMatch(/max-md:overflow-y-auto/);
    expect(panel.contains(ribbon)).toBe(true);
    expect(panel.nextElementSibling).toBe(disclaimer);
    expect(disclaimer).toHaveTextContent(DEMO_FRAMING);
    expect(ribbon).toHaveTextContent(DEMO_RIBBON);
    expect(within(ribbon).getAllByText("Example")).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1 })).toHaveAttribute("id", "demo-title");
    expect(document.activeElement).toBe(screen.getByRole("heading", { level: 1 }));
  });

  it("gives every instruction bullet one congruent or compensatory chip and no brackets", () => {
    render(<DemoExperience onStart={vi.fn()} />);
    expect(screen.getByText(DEMO_PROFILES.A.activeTraits)).toBeInTheDocument();
    const items = within(screen.getByTestId("instruction-list")).getAllByRole("listitem");
    expect(items).toHaveLength(DEMO_PROFILES.A.bullets.length);
    for (const item of items) {
      const chips = within(item).getAllByTestId("instruction-chip");
      expect(chips).toHaveLength(1);
      expect(chips[0].textContent).toMatch(/^(congruent|compensatory)$/);
      expect(chips[0].className).toMatch(/text-\[11px\]/);
      expect(chips[0].className).toMatch(/\brounded\b/);
      expect(chips[0].className).toMatch(/\bborder\b/);
      expect(chips[0].className).toMatch(/whitespace-nowrap/);
      expect(item.textContent ?? "").not.toMatch(/\[|\]/);
    }
    fireEvent.click(screen.getByRole("button", { name: "The Planner" }));
    const plannerItems = within(screen.getByTestId("instruction-list")).getAllByRole("listitem");
    expect(plannerItems).toHaveLength(DEMO_PROFILES.B.bullets.length);
    for (const item of plannerItems) {
      expect(within(item).getAllByTestId("instruction-chip")).toHaveLength(1);
      expect(within(item).getByTestId("instruction-chip")).toHaveTextContent("congruent");
      expect(item.textContent ?? "").not.toMatch(/\[|\]/);
    }
  });

  it("shows one question and reply columns, with tabs that follow the profile", () => {
    render(<DemoExperience onStart={vi.fn()} />);
    expect(screen.getAllByText(DEMO_QUESTION)).toHaveLength(1);
    expect(screen.getByText("Question")).toBeInTheDocument();
    expect(screen.getByText(DEMO_REPLY_FOOTER)).toBeInTheDocument();
    for (const [column, body] of [
      ["none", DEMO_REPLY_NONE],
      ["explorer", DEMO_REPLY_EXPLORER],
      ["planner", DEMO_REPLY_PLANNER],
    ] as const) {
      const paragraph = document.querySelector(`[data-reply-column="${column}"] p`);
      expect(paragraph?.textContent).toBe(body);
      expect(paragraph?.className).toMatch(/whitespace-pre-line/);
    }
    expect(screen.getByRole("heading", { name: "With The Explorer's instructions" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "With The Planner's instructions" })).toBeInTheDocument();

    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.textContent)).toEqual(["No instructions", "Explorer", "Planner"]);
    const tabList = screen.getByRole("tablist", { name: "Replies" });
    expect(tabList.className).toMatch(/md:hidden/);
    for (const tab of tabs) {
      expect(tab.className).toMatch(/min-h-11/);
    }
    expect(tabs[1]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toHaveAttribute("aria-controls", tabs[1].getAttribute("aria-controls") ?? "");
    expect(document.getElementById(tabs[1].getAttribute("aria-controls") ?? "")).toHaveAttribute("role", "tabpanel");
    expect(document.querySelector('[data-reply-column="explorer"]')).toHaveAttribute("data-selected", "true");
    expect(document.querySelector('[data-reply-column="planner"]')).toHaveAttribute("data-selected", "false");
    expect(document.querySelector('[data-reply-column="none"]')).toHaveAttribute("data-selected", "false");

    fireEvent.keyDown(tabs[1], { key: "ArrowRight" });
    const plannerTab = screen.getByRole("tab", { name: "Planner" });
    expect(plannerTab).toHaveAttribute("aria-selected", "true");
    expect(plannerTab).toHaveFocus();
    fireEvent.keyDown(plannerTab, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Explorer" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(screen.getByRole("tab", { name: "Explorer" }), { key: "Home" });
    expect(screen.getByRole("tab", { name: "No instructions" })).toHaveAttribute("aria-selected", "true");

    fireEvent.click(screen.getByRole("button", { name: "The Planner" }));
    expect(screen.getByRole("tab", { name: "Planner" })).toHaveAttribute("aria-selected", "true");
    expect(document.querySelector('[data-reply-column="planner"]')).toHaveAttribute("data-selected", "true");
    expect(document.querySelector('[data-reply-column="explorer"]')).toHaveAttribute("data-selected", "false");

    const hero = screen.getByRole("heading", { level: 1 });
    const how = screen.getByRole("heading", { name: "Three steps" });
    const example = screen.getByRole("heading", { name: "See it with a sample profile" });
    const closing = screen.getByRole("heading", { name: DEMO_CLOSING_TITLE });
    const disclaimer = screen.getByTestId("example-disclaimer");
    expect(hero.compareDocumentPosition(how) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(how.compareDocumentPosition(example) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(example.compareDocumentPosition(disclaimer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(disclaimer.compareDocumentPosition(closing) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByTestId("hero-peek")).toHaveAttribute("aria-hidden", "true");
  });
});
