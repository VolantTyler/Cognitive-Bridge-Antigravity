import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { APP_VERSION_LABEL } from "./appVersion";
import { PrivacyPage, TermsPage } from "./components/LegalPages";
import { StandaloneRoutes } from "./components/StandaloneRoutes";
import { SUPPORT_EMAIL } from "./constants/checkoutCopy";
import { SUPPORT_EMAIL_LINK_CLASS } from "./components/SupportEmailLink";
import { parseLocation } from "./routes";

describe("legal routes", () => {
  it("parses /terms and /privacy and leaves the interview on other paths", () => {
    expect(parseLocation("/terms", "").name).toBe("terms");
    expect(parseLocation("/terms/", "").name).toBe("terms");
    expect(parseLocation("/privacy", "").name).toBe("privacy");
    expect(parseLocation("/", "?checkout=success").name).toBe("checkout");
    expect(parseLocation("/", "?checkout=cancel").name).toBe("checkout");
    expect(parseLocation("/", "").name).toBe("app");
  });

  it("renders the Terms page instead of the app shell", () => {
    render(
      <StandaloneRoutes
        pathname="/terms"
        search=""
        loadStatus={async () => "pending"}
        restore={async () => false}
        app={<h1>The Mirror</h1>}
      />
    );
    expect(screen.getByRole("heading", { name: "Terms" })).toBeInTheDocument();
    expect(screen.getByText(/you must be 18 or older to buy/i)).toBeInTheDocument();
    expect(screen.queryByText(/Some items in brackets are still being confirmed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\[.*pending/i)).not.toBeInTheDocument();
    const support = screen.getByRole("link", { name: SUPPORT_EMAIL });
    expect(support).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
    expect(support.className).toContain(SUPPORT_EMAIL_LINK_CLASS);
    expect(screen.getByText("New Jersey law governs these terms.")).toBeInTheDocument();
    expect(screen.getByText(
      "All sales are final, except duplicate charges, charges where you didn't get access, purchases with a billing address outside the US (these are refunded automatically), or where the law requires a refund."
    )).toBeInTheDocument();
    expect(screen.getByText(/Before checkout, you agree to these Terms and confirm you are 18 or older by checking "I agree to the Terms and I am 18 or older."/)).toBeInTheDocument();
    expect(screen.queryByText(/You accept these Terms on Stripe Checkout/)).not.toBeInTheDocument();
    expect(screen.getByText(/Stripe handles the receipt for your payment/)).toBeInTheDocument();
    expect(screen.queryByText(/Stripe emails your receipt to the address you used at checkout/)).not.toBeInTheDocument();
    expect(screen.getByText(
      "Your billing address must be in the 50 US states or Washington, D.C. Purchases with a billing address anywhere else, including US territories such as Puerto Rico or Guam, are refunded and access is not turned on."
    )).toBeInTheDocument();
    expect(screen.getByText(
      /basic usage events \(for example, which section you open or when you sign in\)/
    )).toBeInTheDocument();
    const interviews = screen.getByRole("heading", { name: "Interviews" });
    expect(interviews).toHaveAttribute("id", "interviews");
    expect(interviews.parentElement?.textContent).toContain(
      "Each purchase includes two interviews (one interview and one retake). An interview counts as used when you accept its results (Keep, accept corrections, or choose a preset), or 6 hours after the AI's first reply if you don't finish. A started interview with no AI reply expires after 6 hours and does not count."
    );
    expect(screen.queryByRole("heading", { name: "The Mirror" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Legal" })).toHaveTextContent(
      `${APP_VERSION_LABEL} · Terms · Privacy`
    );
    expect(APP_VERSION_LABEL).toBe("v2.4.0");
  });

  it("renders the Privacy page with analytics, Stripe, and the account sentence", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { name: "Privacy" })).toBeInTheDocument();
    expect(screen.getByText(/uses Google Analytics/)).toBeInTheDocument();
    expect(screen.getByText(/when a page loads/)).toBeInTheDocument();
    expect(screen.getByText(/There is no consent step/)).toBeInTheDocument();
    expect(screen.getByText(/sets cookies/)).toBeInTheDocument();
    expect(screen.getByText(/sends usage data to Google/)).toBeInTheDocument();
    expect(screen.getByText(/starting checkout, starting or finishing an interview, hitting the chat limit/)).toBeInTheDocument();
    expect(screen.getByText(/We've set the app not to send your email, name, or chat messages in these events/)).toBeInTheDocument();
    expect(screen.getAllByText(/email and password/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Stripe/).length).toBeGreaterThan(0);
    expect(screen.getByText(
      "If you try to create an account with an email that already has one, we tell you that address is already registered so you can sign in and keep a single account. We do not say whether an email is registered when you sign in or reset a password."
    )).toBeInTheDocument();
    expect(screen.getByText(
      /When you start a purchase we store a consent record \(your account id, the time you agreed, the Terms version, your 18\+ confirmation, and the checkout session id\) to show you agreed to the Terms\./
    )).toBeInTheDocument();
    expect(screen.getByText(
      /Stripe receives your account email \(we fill it in for you\), and the name, billing address and card details you enter there\./
    )).toBeInTheDocument();
    expect(screen.queryByText(/emails your receipt/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Some items in brackets are still being confirmed/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\[.*pending/i)).not.toBeInTheDocument();
    const supportLinks = screen.getAllByRole("link", { name: SUPPORT_EMAIL });
    expect(supportLinks.length).toBeGreaterThan(1);
    for (const link of supportLinks) {
      expect(link).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
      expect(link.className).toContain("[overflow-wrap:anywhere]");
    }
    const deletion = screen.getByRole("heading", { name: "Requesting deletion" }).closest("section");
    expect(deletion?.textContent ?? "").toContain(
      `To ask us to delete your account data, email ${SUPPORT_EMAIL}. We'll review and process your request. We may keep payment records.`
    );
    expect(deletion?.querySelector("a")?.getAttribute("href")).toBe(`mailto:${SUPPORT_EMAIL}`);
    expect(deletion?.textContent ?? "").not.toMatch(/within \d+|by hand/i);
    expect(screen.queryByText(/team only/i)).not.toBeInTheDocument();
  });

  it("serves the SPA shell for /terms so the route can render", () => {
    const hosting = JSON.parse(readFileSync("firebase.json", "utf8")).hosting;
    const rewrites = hosting.rewrites as Array<{ source: string; destination?: string; function?: string }>;
    expect(rewrites.at(-1)).toMatchObject({ source: "**", destination: "/index.html" });
    expect(rewrites.map((rule) => rule.source)).toEqual(expect.arrayContaining([
      "/api/checkout",
      "/api/checkout/restore",
      "/api/checkout/status",
      "/api/stripe/webhook",
      "/api/access",
      "/api/interview/reserve",
      "/api/interview/complete",
    ]));
  });

  it("TermsPage is the same document the /terms route renders", () => {
    render(<TermsPage />);
    expect(screen.getByRole("heading", { name: "Terms" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy page" })).toHaveAttribute("href", "/privacy");
  });
});
