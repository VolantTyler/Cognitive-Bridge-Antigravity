export type AppRoute =
  | { name: "terms" }
  | { name: "privacy" }
  | { name: "checkout"; search: string }
  | { name: "app" };

export function parseLocation(pathname: string, search: string): AppRoute {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/terms") return { name: "terms" };
  if (path === "/privacy") return { name: "privacy" };
  const checkout = new URLSearchParams(search).get("checkout");
  if (checkout === "success" || checkout === "cancel") {
    return { name: "checkout", search };
  }
  return { name: "app" };
}
