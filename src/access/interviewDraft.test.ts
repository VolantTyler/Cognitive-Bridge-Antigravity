import { describe, expect, it } from "vitest";
import { shouldPersistInterviewDraft } from "./interviewDraft";

describe("interview draft persistence", () => {
  it("writes the first interview as it goes and holds a retake until accept", () => {
    expect(shouldPersistInterviewDraft({ inProgress: false, interviewsCompleted: 0 })).toBe(true);
    expect(shouldPersistInterviewDraft({ inProgress: true, interviewsCompleted: 0 })).toBe(true);
    expect(shouldPersistInterviewDraft({ inProgress: true, interviewsCompleted: 1 })).toBe(false);
    expect(shouldPersistInterviewDraft({ inProgress: false, interviewsCompleted: 1 })).toBe(true);
  });
});
