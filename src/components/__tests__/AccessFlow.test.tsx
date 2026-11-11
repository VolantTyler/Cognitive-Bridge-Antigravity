import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AccessFlow from "../AccessFlow";
import {
  CHECKOUT_CANCELED_BANNER,
  CHECKOUT_CONSENT_ERROR,
  FINAL_SALE,
  PAYWALL_BUTTON,
  PAYWALL_PRICE,
  PAYWALL_TEST_MODE,
  PAYWALL_TITLE,
  PAYWALL_US,
} from "../../constants/paywallCopy";

const props = {
  email: null,
  canceled: false,
  alertMessage: null,
  busy: false,
  onStartInterview: vi.fn(),
  onUnlock: vi.fn(),
  onBackToDemo: vi.fn(),
  onRestore: vi.fn(),
  onSignedIn: vi.fn(),
  onCloseAuth: vi.fn(),
  onRetryCheckout: vi.fn(),
};

describe("paywall", () => {
  it("shows the final-sale notice beside the unlock button and announces cancel as status", () => {
    render(<AccessFlow {...props} phase="paywall" canceled />);
    expect(screen.getByRole("heading", { name: PAYWALL_TITLE })).toBeInTheDocument();
    expect(screen.getByText(PAYWALL_PRICE)).toBeInTheDocument();
    expect(screen.getByText(PAYWALL_US)).toBeInTheDocument();
    expect(screen.getByText(/up to 50 messages a day \(resets at midnight US Eastern\)/)).toBeInTheDocument();
    expect(screen.getByText("Two interviews: your first, plus one retake. A retake replaces your saved results once you accept the new ones.")).toBeInTheDocument();
    expect(screen.getByText(/An interview counts once you accept your results/)).toBeInTheDocument();
    expect(screen.queryByText(/Both sets of results stay saved/)).not.toBeInTheDocument();
    const sale = document.getElementById("final-sale");
    expect(sale?.textContent).toContain(FINAL_SALE);
    expect(sale?.textContent).toContain("Terms");
    const button = screen.getByRole("button", { name: PAYWALL_BUTTON });
    expect(button).toHaveAttribute("aria-describedby", "final-sale");
    expect(button).toBeDisabled();
    const consent = screen.getByRole("checkbox", { name: "I agree to the Terms and I am 18 or older." });
    expect(consent).not.toBeChecked();
    expect(consent).toHaveAttribute("id", "checkout-terms");
    expect(document.querySelector('label[for="checkout-terms"]')).toBeInTheDocument();
    expect(consent.className).toMatch(/focus-visible:outline/);
    expect(consent).toHaveAttribute("aria-invalid", "true");
    expect(consent).toHaveAttribute("aria-describedby", "checkout-terms-error");
    expect(screen.getByText(CHECKOUT_CONSENT_ERROR)).toBeInTheDocument();
    fireEvent.click(button);
    expect(props.onUnlock).not.toHaveBeenCalled();
    fireEvent.click(consent);
    expect(button).toBeEnabled();
    expect(screen.queryByText(CHECKOUT_CONSENT_ERROR)).not.toBeInTheDocument();
    const testMode = screen.getByText(PAYWALL_TEST_MODE);
    expect(testMode.compareDocumentPosition(button) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(screen.getByRole("status")).toHaveTextContent(CHECKOUT_CANCELED_BANNER);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(props.onUnlock).toHaveBeenCalled();
  });

  it("uses an alert only for a real checkout failure", () => {
    render(<AccessFlow {...props} phase="paywall" alertMessage="Couldn't open checkout. You haven't been charged." />);
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't open checkout. You haven't been charged.");
  });
});
