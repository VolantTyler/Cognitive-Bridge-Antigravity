import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { APP_VERSION_LABEL } from "./appVersion";
import { PrivacyPage, TermsPage } from "./components/LegalPages";
import { StandaloneRoutes } from "./components/StandaloneRoutes";
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
    expect(screen.getByText("[SUPPORT EMAIL, pending Tyler]", { exact: false })).toBeInTheDocument();
    expect(screen.getByText(
      "[GOVERNING LAW / LEGAL CHECK, pending Tyler] New Jersey law governs these terms."
    )).toBeInTheDocument();
    expect(screen.getByText(
      "[SALES FINAL / REFUND WORDING, pending legal check] All sales are final, except duplicate charges, charges where you didn't get access, purchases with a billing address outside the US (these are refunded automatically), or where the law requires a refund."
    )).toBeInTheDocument();
    expect(screen.getByText(
      "Your billing address must be in the 50 US states or Washington, D.C. Purchases with a billing address anywhere else, including US territories such as Puerto Rico or Guam, are refunded and access is not turned on."
    )).toBeInTheDocument();
    expect(screen.getByText(
      /basic usage events \(for example, which section you open or when you sign in\)/
    )).toBeInTheDocument();
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
    expect(screen.getAllByText(/email and password/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Stripe/).length).toBeGreaterThan(0);
    expect(screen.getByText(
      "If you try to create an account with an email that already has one, we tell you that address is already registered so you can sign in and keep a single account. We do not say whether an email is registered when you sign in or reset a password."
    )).toBeInTheDocument();
    expect(screen.getByText(
      "Stripe hosts checkout. We do not receive or store your card details. We store whether your account paid, the amount and currency, your billing country, whether you accepted the Terms, Stripe payment and checkout IDs, and any refund or dispute status."
    )).toBeInTheDocument();
    expect(screen.getByText(
      /Stripe receives your account email \(we fill it in for you\), and the name, billing address and card details you enter there, and emails your receipt\./
    )).toBeInTheDocument();
    expect(screen.getAllByText(/\[SUPPORT EMAIL, pending Tyler\]/).length).toBeGreaterThan(1);
    const deletion = screen.getByRole("heading", { name: "Requesting deletion" }).closest("section");
    expect(deletion?.textContent ?? "").toContain(
      "To ask us to delete your account data, email [SUPPORT EMAIL, pending Tyler]. We'll review and process your request. We may keep payment records."
    );
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
    ]));
  });

  it("TermsPage is the same document the /terms route renders", () => {
    render(<TermsPage />);
    expect(screen.getByRole("heading", { name: "Terms" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Privacy page" })).toHaveAttribute("href", "/privacy");
  });
});
