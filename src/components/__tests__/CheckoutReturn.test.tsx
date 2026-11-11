import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CheckoutReturn } from "../CheckoutReturn";
import { ACCOUNT_COPY } from "../../constants/accountCopy";
import {
  BACK_TO_COGNITIVE_BRIDGE,
  CHECKOUT_CONFIRMING,
  CHECKOUT_SIGN_IN,
  CheckoutClientError,
  CheckoutViewStatus,
  NON_US_HEADING,
  NON_US_REFUND_FAILED_BODY,
  NON_US_REFUNDED_BODY,
  SUPPORT_EMAIL,
} from "../../constants/checkoutCopy";
import { CheckoutAuthGate, CheckoutAuthUser } from "../../services/checkoutAuth";
import { SUPPORT_EMAIL_LINK_CLASS } from "../SupportEmailLink";

const noop = async () => "pending" as const;

const readyAuth: CheckoutAuthGate = {
  ready: async () => {},
  subscribe: () => () => {},
};

function deferredAuth() {
  let resolveReady: () => void = () => {};
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  const listeners = new Set<(user: CheckoutAuthUser | null) => void>();
  const gate: CheckoutAuthGate = {
    ready: () => ready,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    gate,
    resolveReady() {
      resolveReady();
    },
    emit(user: CheckoutAuthUser | null) {
      for (const listener of [...listeners]) listener(user);
    },
  };
}

describe("checkout return", () => {
  it("places a provided main nav above the checkout message", () => {
    render(
      <CheckoutReturn
        search="?checkout=cancel"
        loadStatus={noop}
        restore={async () => false}
        header={<nav aria-label="Main"><button type="button">Sign in</button></nav>}
      />,
    );
    const nav = screen.getByRole("navigation", { name: "Main" });
    const heading = screen.getByRole("heading");
    expect(nav.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /The Mirror/ })).not.toBeInTheDocument();
  });

  it("shows Charlie's non-US copy and one neutral button", async () => {
    render(
      <CheckoutReturn
        search="?checkout=success&session_id=cs_123"
        loadStatus={async () => "non_us_refunded"}
        restore={async () => false}
        authGate={readyAuth}
      />
    );
    expect(await screen.findByRole("heading", { name: NON_US_HEADING })).toBeInTheDocument();
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(NON_US_REFUNDED_BODY);
    const mail = screen.getByRole("link", { name: SUPPORT_EMAIL });
    expect(mail).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
    expect(mail.className).toContain(SUPPORT_EMAIL_LINK_CLASS);
    expect(status).not.toHaveTextContent(/minutes|business days|5-10/i);
    expect(BACK_TO_COGNITIVE_BRIDGE).toBe("Back to Cognitive Bridge");
    const back = screen.getByRole("link", { name: BACK_TO_COGNITIVE_BRIDGE });
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
        authGate={readyAuth}
      />
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(NON_US_REFUND_FAILED_BODY);
    expect(alert.textContent ?? "").not.toMatch(/we're refunding|refunding your payment/i);
    expect(screen.getByRole("heading", { name: NON_US_HEADING })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: BACK_TO_COGNITIVE_BRIDGE })).toHaveAttribute("href", "/?view=demo");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("shows payment confirmed only after a paid status", async () => {
    render(
      <CheckoutReturn
        search="?checkout=success&session_id=cs_123"
        loadStatus={async () => "paid"}
        restore={async () => false}
        authGate={readyAuth}
      />
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Payment confirmed.");
    });
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
    expect(screen.getByRole("button", { name: "Restore purchase" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: ACCOUNT_COPY.signInButton })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restore purchase" }));
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Payment confirmed.");
    });
    expect(restore).toHaveBeenCalled();
  });

  it("checks status only after auth is restored, then shows paid", async () => {
    const auth = deferredAuth();
    const loadStatus = vi.fn(async () => "paid" as const);
    window.history.replaceState({}, "", "/?checkout=success&session_id=cs_late");
    render(
      <CheckoutReturn
        search="?checkout=success&session_id=cs_late"
        loadStatus={loadStatus}
        restore={async () => false}
        authGate={auth.gate}
      />
    );

    expect(screen.getByRole("heading", { name: CHECKOUT_CONFIRMING })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: CHECKOUT_SIGN_IN })).not.toBeInTheDocument();
    expect(loadStatus).not.toHaveBeenCalled();

    act(() => {
      auth.emit({ uid: "restored-user" });
    });
    expect(loadStatus).not.toHaveBeenCalled();
    expect(screen.queryByText(CHECKOUT_SIGN_IN)).not.toBeInTheDocument();

    act(() => {
      auth.resolveReady();
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Payment confirmed.");
    });
    expect(loadStatus).toHaveBeenCalledTimes(1);
    expect(loadStatus).toHaveBeenCalledWith("cs_late");
    expect(screen.queryByText(CHECKOUT_SIGN_IN)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ACCOUNT_COPY.signInButton })).not.toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe("/?checkout=success&session_id=cs_late");
  });

  it("shows a sign-in action when auth is ready and nobody is signed in", async () => {
    const auth = deferredAuth();
    const loadStatus = vi.fn(async () => {
      throw new CheckoutClientError("signed_out");
    });
    window.history.replaceState({}, "", "/?checkout=success&session_id=cs_signed_out");
    render(
      <CheckoutReturn
        search="?checkout=success&session_id=cs_signed_out"
        loadStatus={loadStatus}
        restore={async () => false}
        authGate={auth.gate}
      />
    );

    expect(loadStatus).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: ACCOUNT_COPY.signInButton })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: BACK_TO_COGNITIVE_BRIDGE })).not.toBeInTheDocument();

    act(() => {
      auth.resolveReady();
    });
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: CHECKOUT_SIGN_IN })).toHaveFocus();
    });
    expect(loadStatus).toHaveBeenCalledTimes(1);
    const signIn = screen.getByRole("button", { name: ACCOUNT_COPY.signInButton });
    expect(signIn).toBeEnabled();
    const back = screen.getByRole("link", { name: BACK_TO_COGNITIVE_BRIDGE });
    expect(back).toHaveAttribute("href", "/?view=demo");
    expect(back.className).not.toMatch(/red|status-danger/);

    act(() => {
      auth.emit(null);
    });
    expect(loadStatus).toHaveBeenCalledTimes(1);

    fireEvent.click(signIn);
    expect(await screen.findByRole("dialog", { name: ACCOUNT_COPY.title })).toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe("/?checkout=success&session_id=cs_signed_out");
    expect(screen.getByRole("heading", { name: CHECKOUT_SIGN_IN })).toBeInTheDocument();
  });

  it("resumes polling when someone signs in from the sign-in phase", async () => {
    const auth = deferredAuth();
    let attempts = 0;
    const loadStatus = vi.fn(async (_sessionId: string): Promise<CheckoutViewStatus> => {
      attempts += 1;
      if (attempts === 1) throw new CheckoutClientError("signed_out");
      return "paid";
    });
    window.history.replaceState({}, "", "/?checkout=success&session_id=cs_resume");
    render(
      <CheckoutReturn
        search="?checkout=success&session_id=cs_resume"
        loadStatus={loadStatus}
        restore={async () => false}
        authGate={auth.gate}
      />
    );

    act(() => {
      auth.resolveReady();
    });
    expect(await screen.findByRole("button", { name: ACCOUNT_COPY.signInButton })).toBeInTheDocument();
    expect(loadStatus).toHaveBeenCalledTimes(1);
    expect(loadStatus).toHaveBeenCalledWith("cs_resume");

    act(() => {
      auth.emit({ uid: "ada" });
    });
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("Payment confirmed.");
    });
    expect(loadStatus).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("heading", { name: CHECKOUT_SIGN_IN })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ACCOUNT_COPY.signInButton })).not.toBeInTheDocument();
    expect(window.location.pathname + window.location.search).toBe("/?checkout=success&session_id=cs_resume");
  });
});
