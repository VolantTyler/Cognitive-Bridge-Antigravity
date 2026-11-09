import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InterviewsExhausted, { MIRROR_INVITE } from "../InterviewsExhausted";
import { showMirrorInvite } from "../../access/productAccess";

describe("third interview screen", () => {
  it("hides the interview pitch and shows one notice plus View my results", () => {
    expect(showMirrorInvite({ paid: true, interviewsRemaining: 0, inProgress: false })).toBe(false);
    expect(showMirrorInvite({ paid: true, interviewsRemaining: 1, inProgress: false })).toBe(true);
    expect(showMirrorInvite({ paid: true, interviewsRemaining: 0, inProgress: true })).toBe(true);

    render(<InterviewsExhausted onViewResults={vi.fn()} />);
    expect(screen.queryByRole("heading", { name: "Make Your AI Fit You" })).not.toBeInTheDocument();
    expect(screen.queryByText(MIRROR_INVITE)).not.toBeInTheDocument();
    expect(screen.getAllByText(/You've used both interviews included with your purchase/)).toHaveLength(1);
    expect(screen.getByRole("link", { name: "What counts as an interview" })).toHaveAttribute("href", "/terms#interviews");
    expect(screen.getByRole("button", { name: "View my results" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start retake" })).not.toBeInTheDocument();
  });
});