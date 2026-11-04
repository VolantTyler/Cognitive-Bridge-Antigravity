import { describe, expect, it } from "vitest";
import { allowedCorsOrigins, isFunctionsEmulator, PRODUCTION_ORIGINS } from "./cors";
import {
  configFromEnv,
  inputCharCount,
  isBridgeChatFeature,
  isInterviewFeature,
  nextBridgeUsage,
  parseGateMode,
  sanitizeFeature,
  sanitizeSessionId,
  usEasternDay,
  GateError,
} from "./gate";
import { dailyCapMessage } from "./accessCopy";

describe("gate config", () => {
  it("defaults to auth and ignores unknown modes", () => {
    expect(parseGateMode(undefined)).toBe("auth");
    expect(parseGateMode("paid")).toBe("paid");
    expect(parseGateMode(" OFF ")).toBe("off");
    expect(parseGateMode("sometimes")).toBe("auth");
  });

  it("reads caps, allowlist, and flags from env", () => {
    const config = configFromEnv({
      AI_GATE_MODE: "paid",
      AI_ALLOWLIST_UIDS: " tyler , ,ada ",
      ENFORCE_APP_CHECK: "true",
      INTERVIEWS_PAUSED: "false",
      BRIDGE_CHAT_DAILY_CAP: "12",
      MAX_INPUT_CHARS: "100",
    });
    expect(config.mode).toBe("paid");
    expect([...config.allowlist]).toEqual(["tyler", "ada"]);
    expect(config.enforceAppCheck).toBe(true);
    expect(config.interviewsPaused).toBe(false);
    expect(config.bridgeDailyCap).toBe(12);
    expect(config.maxInputChars).toBe(100);
  });
});

describe("US Eastern day", () => {
  it("rolls the counter at midnight US Eastern", () => {
    expect(usEasternDay(new Date("2026-11-05T04:30:00.000Z"))).toBe("2026-11-04");
    expect(usEasternDay(new Date("2026-11-05T05:00:00.000Z"))).toBe("2026-11-05");
  });
});

describe("bridge usage bucket", () => {
  it("resets the count on a new Eastern day and stops at the cap", () => {
    expect(nextBridgeUsage(undefined, "2026-11-04", 2)).toEqual({ day: "2026-11-04", count: 1 });
    expect(nextBridgeUsage({ day: "2026-11-04", count: 1 }, "2026-11-05", 2)).toEqual({
      day: "2026-11-05",
      count: 1,
    });
    expect(() => nextBridgeUsage({ day: "2026-11-04", count: 2 }, "2026-11-04", 2)).toThrow(GateError);
    try {
      nextBridgeUsage({ day: "2026-11-04", count: 50 }, "2026-11-04", 50);
    } catch (error) {
      expect(error).toMatchObject({ status: 429, code: "rate_limited", message: dailyCapMessage(50) });
    }
  });
});

describe("request fields", () => {
  it("caps feature and session id and counts characters", () => {
    expect(sanitizeFeature("playground-aligned")).toBe("playground-aligned");
    expect(sanitizeFeature("x".repeat(80))).toBe("unknown");
    expect(sanitizeFeature("../etc/passwd")).toBe("unknown");
    expect(sanitizeSessionId("abc_DEF-123")).toBe("abc_DEF-123");
    expect(sanitizeSessionId("has space")).toBeNull();
    expect(isBridgeChatFeature("Playground-Aligned")).toBe(true);
    expect(isBridgeChatFeature("mirror")).toBe(false);
    expect(isInterviewFeature("mirror")).toBe(true);
    expect(inputCharCount(
      [{ content: "abcd" }, { content: "ef" }],
      "sys"
    )).toBe(9);
  });
});

describe("CORS allowlist", () => {
  it("allows production domains and localhost only in the emulator", () => {
    const production = allowedCorsOrigins({});
    expect(production).toEqual([...PRODUCTION_ORIGINS]);
    expect(production).not.toContain("http://localhost:3000");
    expect(production).not.toContain("https://evil.example");
    expect(isFunctionsEmulator({ FUNCTIONS_EMULATOR: "true" })).toBe(true);
    const emulator = allowedCorsOrigins({ FUNCTIONS_EMULATOR: "true" });
    expect(emulator).toContain("https://cognitive-bridge-ai.web.app");
    expect(emulator).toContain("https://cognitive-bridge-ai.firebaseapp.com");
    expect(emulator).toContain("http://localhost:3000");
    expect(emulator).toContain("http://127.0.0.1:5000");
  });
});
