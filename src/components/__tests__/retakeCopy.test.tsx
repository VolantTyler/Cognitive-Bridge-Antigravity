import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AccessFlow from "../AccessFlow";
import { CheckoutReturn } from "../CheckoutReturn";
import InterviewsUsedNotice from "../InterviewsUsedNotice";
import RetakeStartControl from "../RetakeStartControl";
import { TermsPage } from "../LegalPages";
import {
  INTERVIEW_COUNT_LINE,
  RETAKE_REPLACES_RESULTS,
  RETAKE_START_WARNING,
  TERMS_RETAKE_REPLACES,
} from "../../constants/paywallCopy";

describe("retake replaces results copy", () => {
  it("states the replacement on the paywall, success screen, terms, and retake start", () => {
    render(
      <AccessFlow
        phase="paywall"
        email={null}
        canceled={false}
        alertMessage={null}
        busy={false}
        onStartInterview={vi.fn()}
        onUnlock={vi.fn()}
        onBackToDemo={vi.fn()}
        onRestore={vi.fn()}
        onSignedIn={vi.fn()}
        onCloseAuth={vi.fn()}
        onRetryCheckout={vi.fn()}
      />
    );
    expect(screen.getByText(
      "Two interviews: your first, plus one retake. A retake replaces your saved results once you accept the new ones."
    )).toBeInTheDocument();
    expect(screen.getByText(INTERVIEW_COUNT_LINE)).toBeInTheDocument();
    expect(screen.queryByText(/both sets of results stay saved/i)).not.toBeInTheDocument();
  });

  it("repeats the replacement line on success, terms, and the retake button", () => {
    const success = render(
      <CheckoutReturn
        search="?checkout=success"
        loadStatus={async () => "paid"}
        restore={async () => false}
        initialPhase="paid"
      />
    );
    expect(screen.getByText(RETAKE_REPLACES_RESULTS)).toBeInTheDocument();
    expect(screen.getByText(INTERVIEW_COUNT_LINE)).toBeInTheDocument();
    success.unmount();

    render(<TermsPage />);
    const interviews = document.getElementById("interviews");
    expect(interviews?.textContent).toContain(TERMS_RETAKE_REPLACES);

    const retake = render(<RetakeStartControl onRetake={vi.fn()} />);
    const notice = within(retake.container).getByRole("status");
    const button = within(retake.container).getByRole("button", { name: "Start retake" });
    expect(notice).toHaveTextContent(RETAKE_START_WARNING);
    expect(notice).toHaveTextContent(
      "If you leave after the AI has replied but before you accept, your current results stay, and the retake counts as used after 6 hours."
    );
    expect(button).toHaveAttribute("aria-describedby", notice.id);
    expect(notice.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    retake.unmount();

    render(<InterviewsUsedNotice />);
    const link = screen.getByRole("link", { name: "What counts as an interview" });
    expect(link).toHaveAttribute("href", "/terms#interviews");
    expect(link).not.toHaveAttribute("target");
    expect(link.className).toMatch(/min-h-11/);
    expect(link.className).toMatch(/focus-visible:outline/);
  });
});