import { describe, expect, it, vi } from "vitest";
import { emailVerifiedFromToken, requireEmailVerified, verifyBearerToken, verifyIdTokenWithAdmin } from "./auth";
import { EMAIL_NOT_VERIFIED_CODE, EMAIL_NOT_VERIFIED_MESSAGE } from "./accountCopy";
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

  it("treats a missing email_verified claim as unverified", async () => {
    const user = await verifyBearerToken("Bearer good", async () => ({
      uid: "uid-2",
      email: "ada@example.com",
    }));
    expect(user.email_verified).toBe(false);
    expect(emailVerifiedFromToken(user)).toBe(false);
    expect(() => requireEmailVerified(user)).toThrow(GateError);
    try {
      requireEmailVerified(user);
    } catch (error) {
      expect(error).toMatchObject({
        status: 403,
        code: EMAIL_NOT_VERIFIED_CODE,
        message: EMAIL_NOT_VERIFIED_MESSAGE,
      });
    }
  });
});

describe("requireEmailVerified", () => {
  it("accepts a verified claim and rejects a false one", () => {
    const verified = requireEmailVerified({
      uid: "uid-1",
      email: "ada@example.com",
      email_verified: true,
    });
    expect(verified.uid).toBe("uid-1");
    expect(() =>
      requireEmailVerified({ uid: "uid-1", email: "ada@example.com", email_verified: false })
    ).toThrow(GateError);
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
