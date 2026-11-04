import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CheckoutReturn } from "../CheckoutReturn";
import {
  BACK_TO_DEMO,
  NON_US_HEADING,
  NON_US_REFUND_FAILED_BODY,
  NON_US_REFUNDED_BODY,
} from "../../constants/checkoutCopy";

const noop = async () => "pending" as const;

describe("checkout return", () => {
  it("shows Charlie's non-US copy and one neutral button", async () => {
    render(
      <CheckoutReturn
        search="?checkout=success&session_id=cs_123"
        loadStatus={async () => "non_us_refunded"}
        restore={async () => false}
      />
    );
    expect(await screen.findByRole("heading", { name: NON_US_HEADING })).toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(NON_US_REFUNDED_BODY);
    expect(status).not.toHaveTextContent(/minutes|business days|5-10/i);
    const back = screen.getByRole("link", { name: BACK_TO_DEMO });
    expect(back).toHaveAttribute("href", "/?view=demo");
    expect(back.className).not.toMatch(/red|status-danger/);
    expect(screen.queryByText(/payment confirmed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/The Mirror/)).not.toBeInTheDocument();
  });

  it("does not claim a refund when the refund call failed", async () => {
    render(
      <CheckoutReturn
        search="?checkout=success&session_id=cs_123"
        loadStatus={async () => "non_us_refund_failed"}
        restore={async () => false}
      />
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(NON_US_REFUND_FAILED_BODY);
    expect(alert.textContent ?? "").not.toMatch(/we're refunding|refunding your payment/i);
    expect(screen.getByRole("heading", { name: NON_US_HEADING })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: BACK_TO_DEMO })).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows payment confirmed only after a paid status", async () => {
    render(
      <CheckoutReturn
        search="?checkout=success&session_id=cs_123"
        loadStatus={async () => "paid"}
        restore={async () => false}
      />
    );
    expect(await screen.findByRole("status")).toHaveTextContent("Payment confirmed.");
    expect(screen.queryByText(NON_US_REFUNDED_BODY)).not.toBeInTheDocument();
  });

  it("shows a canceled checkout without a charge", () => {
    render(
      <CheckoutReturn
        search="?checkout=cancel"
        loadStatus={noop}
        restore={async () => false}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("Checkout canceled. You weren't charged.");
    expect(screen.queryByText(/payment confirmed/i)).not.toBeInTheDocument();
  });

  it("offers restore when confirmation has timed out", async () => {
    const restore = vi.fn(async () => true);
    render(
      <CheckoutReturn
        search="?checkout=success&session_id=cs_123"
        initialPhase="timeout"
        loadStatus={async () => "pending"}
        restore={restore}
      />
    );
    expect(screen.getByRole("status")).toHaveTextContent("Your payment is still being confirmed.");
    fireEvent.click(screen.getByRole("button", { name: "Restore purchase" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Payment confirmed.");
    });
    expect(restore).toHaveBeenCalled();
  });
});
