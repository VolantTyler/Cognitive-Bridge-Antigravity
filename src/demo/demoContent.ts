import raw from "./demoCardData.json";
import {
  DEMO_CARD_SENTENCE_A,
  DEMO_CARD_SENTENCE_B,
} from "../constants/paywallCopy";
import type { OceanScores } from "../types";

export type DemoProfileId = "A" | "B";

export interface DemoProfile {
  id: DemoProfileId;
  title: string;
  description: string;
  scores: OceanScores;
  activeTraits: string;
  bullets: string[];
}

export const DEMO_QUESTION = "How should I prepare for a job interview next week?";

export const DEMO_REPLY_NONE =
  "A week is a good amount of time to prepare. Start by reading the job description closely and noting the skills it asks for. Look up the company: what it makes, who its customers are, and any recent news. Then think of a few examples from past work that show those skills, and practice describing them out loud, ideally with a friend. Prepare two or three questions to ask the interviewer. The day before, plan your route or test your video setup, choose what to wear, and get some rest. On the day, arrive a little early and bring a copy of your resume.";

export const DEMO_REPLY_EXPLORER =
  "Try treating the interview like a short research project. What problem is this team trying to solve, and where else have you seen a similar problem? Analogies from other fields often make stories memorable. Let your ideas run wide first, then narrow down.\n\nTo keep it moving, here are small milestones:\n1. Today: read the job post and jot three questions it raises.\n2. Mid-week: pick three stories from past work and tell each aloud once.\n3. Two days before: write two questions for the interviewer.\n4. Day before: check logistics, then stop preparing.\n\nNext action: open the job post and spend ten minutes on step 1.";

export const DEMO_REPLY_PLANNER =
  "Plan for five sessions of about 45 minutes.\n\n1. Day 1: Read the job description. List each required skill.\n2. Day 2: Match one past example to each skill. Use situation, action, result.\n3. Day 3: Research the company: products, customers, recent news.\n4. Day 4: Practice answers aloud, timed at about two minutes each. Write three questions for the interviewer.\n5. Day 5: Confirm time, location or video link, and the interviewer's name. Prepare clothes and printed resume.\n\nDay of the interview: arrive 10 minutes early. No new preparation that morning.\n\nDone when every listed skill has one practiced example.";

export const DEMO_PROFILES: Record<DemoProfileId, DemoProfile> = {
  A: {
    id: "A",
    title: "The Explorer (made-up)",
    description:
      "A made-up person who enjoys new ideas and tangents, and often finds it hard to stick to plans and finish tasks.",
    scores: { openness: 85, conscientiousness: 25, extroversion: 50, agreeableness: 50, neuroticism: 50 },
    activeTraits:
      "Active traits: high Openness (congruent), low Conscientiousness (compensatory: add structure). Extraversion, Agreeableness and Neuroticism are in the middle range, so they are not used.",
    bullets: [
      "[congruent] Explore novel angles, theoretical mechanisms, and cross-domain analogies.",
      "[congruent] Brainstorm broadly before converging.",
      "[compensatory] Act as an external executive function: break complex tasks into bite-sized milestones.",
      "[compensatory] Give clear step-by-step checklists and an immediate next action.",
    ],
  },
  B: {
    id: "B",
    title: "The Planner (made-up)",
    description:
      "A made-up person who likes clear structure, finishes what they start, and prefers familiar, practical options over brainstorming.",
    scores: { openness: 45, conscientiousness: 85, extroversion: 50, agreeableness: 50, neuroticism: 35 },
    activeTraits:
      "Active trait: high Conscientiousness (congruent). Openness and Neuroticism are in the middle range, so they are not used.",
    bullets: [
      "[congruent] Provide concise, high-density, rigorously structured responses.",
      "[congruent] Focus on precision.",
      "[congruent] Adhere strictly to specifications.",
    ],
  },
};

export interface DemoBar {
  label: string;
  caption: string;
  mean: number;
  low: number;
  high: number;
  ariaLabel: string;
}

export interface DemoModelCard {
  title: string;
  modelId: string;
  tierLabel: string;
  sentence: string;
  chips: string[];
  rows: DemoBar[];
  testedOn: string;
  fewerRunsTag: string | null;
}

interface StoredModel {
  modelId: string;
  tier: string;
  fewerRunsTag: string | null;
  rows: DemoBar[];
}

interface StoredFile {
  profiles: Record<string, { section: { groups: Array<{ id: string; models: StoredModel[] }> } }>;
  testedOn: Array<[string, string]>;
}

const file = raw as unknown as StoredFile;

function firstStrong(profileName: string): StoredModel {
  const groups = file.profiles[profileName].section.groups;
  const strong = groups.find((group) => group.id === "strong");
  if (!strong || strong.models.length === 0) {
    throw new Error("Demo card data is missing a strong model.");
  }
  return strong.models[0];
}

function testedOn(modelId: string): string {
  const row = file.testedOn.find((entry) => entry[0] === modelId);
  return row ? row[1] : "tested on Nov 2, 2026";
}

export function demoModelCard(profile: DemoProfileId): DemoModelCard {
  if (profile === "A") {
    const model = firstStrong("Example A (The Explorer)");
    return {
      title: "Example: The Explorer (made-up)",
      modelId: model.modelId,
      tierLabel: "Strong fit",
      sentence: DEMO_CARD_SENTENCE_A,
      chips: [
        "Openness: high, so models should be high",
        "Conscientiousness: low, so models should be high",
      ],
      rows: model.rows,
      testedOn: testedOn(model.modelId),
      fewerRunsTag: model.fewerRunsTag,
    };
  }
  const model = firstStrong("Example B (The Planner)");
  return {
    title: "Example: The Planner (made-up)",
    modelId: model.modelId,
    tierLabel: "Strong fit",
    sentence: DEMO_CARD_SENTENCE_B,
    chips: ["Conscientiousness: high, so models should be high"],
    rows: model.rows.filter((row) => !/neuroticism/i.test(row.label)),
    testedOn: testedOn(model.modelId),
    fewerRunsTag: null,
  };
}
