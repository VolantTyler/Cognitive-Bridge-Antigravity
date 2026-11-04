import { describe, expect, it, vi } from "vitest";
import { verifyBearerToken, verifyIdTokenWithAdmin } from "./auth";
import { GateError } from "./gate";

describe("verifyBearerToken", () => {
  it("rejects a missing or invalid token without echoing it", async () => {
    const verify = vi.fn(async () => ({ uid: "u" }));
    await expect(verifyBearerToken(undefined, verify)).rejects.toMatchObject({
      status: 401,
      code: "unauthenticated",
    });
    await expect(verifyBearerToken("Basic abc", verify)).rejects.toBeInstanceOf(GateError);
    expect(verify).not.toHaveBeenCalled();

    verify.mockRejectedValueOnce(new Error("bad super-secret-token"));
    try {
      await verifyBearerToken("Bearer super-secret-token", verify);
      throw new Error("expected rejection");
    } catch (error) {
      expect(error).toMatchObject({ status: 401, code: "unauthenticated" });
      expect((error as Error).message).not.toContain("super-secret-token");
    }
  });

  it("returns uid, email, and email_verified", async () => {
    const user = await verifyBearerToken("Bearer good", async () => ({
      uid: "uid-1",
      email: "tyler@example.com",
      email_verified: true,
    }));
    expect(user).toEqual({
      uid: "uid-1",
      email: "tyler@example.com",
      email_verified: true,
    });
  });
});

const verifyIdToken = vi.hoisted(() => vi.fn());

vi.mock("firebase-admin/app", () => ({
  getApps: () => [],
  initializeApp: vi.fn(() => ({ name: "test" })),
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({ verifyIdToken }),
}));

describe("verifyIdTokenWithAdmin", () => {
  it("uses firebase-admin and maps the decoded token", async () => {
    verifyIdToken.mockResolvedValueOnce({
      uid: "admin-uid",
      email: "ada@example.com",
      email_verified: false,
    });
    const decoded = await verifyIdTokenWithAdmin("header.payload.sig");
    expect(verifyIdToken).toHaveBeenCalledWith("header.payload.sig");
    expect(decoded).toEqual({
      uid: "admin-uid",
      email: "ada@example.com",
      email_verified: false,
    });
  });
});
