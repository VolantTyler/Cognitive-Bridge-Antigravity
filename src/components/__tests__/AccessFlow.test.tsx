import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import AccessFlow from "../AccessFlow";
import {
  CHECKOUT_CANCELED_BANNER,
  FINAL_SALE,
  PAYWALL_BUTTON,
  PAYWALL_PRICE,
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
    const sale = document.getElementById("final-sale");
    expect(sale?.textContent).toContain(FINAL_SALE);
    expect(sale?.textContent).toContain("Terms");
    const button = screen.getByRole("button", { name: PAYWALL_BUTTON });
    expect(button).toHaveAttribute("aria-describedby", "final-sale");
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
