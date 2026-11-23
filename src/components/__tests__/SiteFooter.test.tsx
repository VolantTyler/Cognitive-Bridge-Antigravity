import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { APP_VERSION_LABEL } from "../../appVersion";
import { NEED_HELP_OR_REFUND, SUPPORT_EMAIL } from "../../constants/checkoutCopy";
import SiteFooter from "../SiteFooter";
import { SUPPORT_EMAIL_LINK_CLASS } from "../SupportEmailLink";

describe("site footer", () => {
  it("shows help and refund contact on every footer", () => {
    render(<SiteFooter />);
    const line = screen.getByText((_, node) => {
      return node?.nodeName === "P" && (node.textContent ?? "").startsWith(NEED_HELP_OR_REFUND);
    });
    expect(line.textContent).toBe(`${NEED_HELP_OR_REFUND} Email ${SUPPORT_EMAIL}.`);
    const mail = line.querySelector("a");
    expect(mail).toHaveAttribute("href", `mailto:${SUPPORT_EMAIL}`);
    expect(mail).toHaveTextContent(SUPPORT_EMAIL);
    expect(mail?.className).toContain(SUPPORT_EMAIL_LINK_CLASS);
    expect(mail?.className).toMatch(/focus-visible:outline/);
    expect(screen.getByRole("navigation", { name: "Legal" })).toHaveTextContent(
      `${APP_VERSION_LABEL} · Terms · Privacy`
    );
  });
});
