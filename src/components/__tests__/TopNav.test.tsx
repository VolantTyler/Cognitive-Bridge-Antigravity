import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import TopNav, { TopNavAccount } from "../TopNav";
import { DEMO_CTA, DEMO_HOME } from "../../constants/paywallCopy";

const signedOut = {
  account: null as TopNavAccount | null,
  isLightMode: true,
  onToggleTheme: vi.fn(),
  onSignOut: vi.fn(),
  onSignIn: vi.fn(),
  onVerifyEmail: vi.fn(),
  onOpenFeedback: vi.fn(),
  onOpenSettings: vi.fn(),
  onStartInterview: vi.fn(),
};

describe("top nav", () => {
  it("keeps Sign in in the bar and Start my interview from 768px up", () => {
    render(<TopNav mode="gate" {...signedOut} />);
    const nav = screen.getByRole("navigation", { name: "Main" });
    expect(nav.className).toMatch(/\bh-16\b/);
    expect(nav.className).toMatch(/\bsticky\b/);
    const home = screen.getByRole("link", { name: /COGNITIVE BRIDGE/ });
    expect(home).toHaveAttribute("href", DEMO_HOME);
    expect(home.compareDocumentPosition(screen.getByRole("button", { name: "Sign in" })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const signIn = screen.getByRole("button", { name: "Sign in" });
    const start = screen.getByRole("button", { name: DEMO_CTA });
    expect(signIn.className).toMatch(/min-h-11/);
    expect(signIn.className).toMatch(/focus-visible:outline/);
    expect(signIn.className).not.toMatch(/\bhidden\b/);
    expect(start.className).toMatch(/min-h-11/);
    expect(start.className).toMatch(/focus-visible:outline/);
    expect(start.className).toMatch(/\bhidden\b/);
    expect(start.className).toMatch(/md:inline-flex/);
    expect(screen.queryByRole("button", { name: /The Mirror/ })).not.toBeInTheDocument();

    fireEvent.click(signIn);
    expect(signedOut.onSignIn).toHaveBeenCalledOnce();
    fireEvent.click(start);
    expect(signedOut.onStartInterview).toHaveBeenCalledOnce();
  });

  it("switches to the account menu after sign-in, with sign out, theme, and settings", () => {
    const account: TopNavAccount = {
      displayName: "Ada",
      email: "ada@example.com",
      photoURL: null,
      emailVerified: true,
    };
    render(
      <TopNav
        mode="gate"
        {...signedOut}
        account={account}
        showDevSettings
      />,
    );
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: DEMO_CTA })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Ada/ }));
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Theme Mode/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Local Inference/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(signedOut.onSignOut).toHaveBeenCalledOnce();
  });

  it("hides Sign in until auth has settled", () => {
    render(<TopNav mode="gate" {...signedOut} authPending />);
    expect(screen.queryByRole("button", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  });

  it("shows the app step tabs and drops the interview button", () => {
    const onSelectStep = vi.fn();
    render(
      <TopNav
        mode="app"
        {...signedOut}
        onSelectStep={onSelectStep}
        steps={[
          { id: "mirror", label: "1. The Mirror", active: true },
          { id: "tailor", label: "2. The Tailor", active: false, disabled: true },
          { id: "playground", label: "3. The Bridge", active: false, disabled: true },
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "1. The Mirror" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: DEMO_CTA })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "1. The Mirror" }));
    expect(onSelectStep).toHaveBeenCalledWith("mirror");
  });
});
