import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, test } from "vitest";
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";

const projectId = "demo-cognitive-bridge";
let testEnv: RulesTestEnvironment;

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      rules: readFileSync(resolve(process.cwd(), "firestore.rules"), "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv?.cleanup();
});

const locked = ["entitlements", "usage", "usage_server", "stripe_events"] as const;

describe("server-only Firestore collections", () => {
  test("a signed-in client cannot read or write entitlements, usage, usage_server, or stripe_events", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      for (const name of locked) {
        await setDoc(doc(db, name, "alice"), { paid: false, seed: true });
      }
    });

    const alice = testEnv.authenticatedContext("alice", {
      email: "alice@example.com",
      email_verified: true,
    });
    const db = alice.firestore();

    for (const name of locked) {
      const ref = doc(db, `${name}/alice`);
      await assertFails(getDoc(ref));
      await assertFails(setDoc(ref, { paid: true }));
      await assertFails(updateDoc(ref, { paid: true }));
      await assertFails(deleteDoc(ref));
      await assertFails(setDoc(doc(db, `${name}/alice/secret/note`), { paid: true }));
    }

    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(anon, "entitlements/alice"), { paid: true }));
    await assertFails(setDoc(doc(anon, "usage_server/forged"), {
      uid: "alice",
      promptTokens: 1,
      completionTokens: 1,
    }));
  });

  test("an owner can still write their own users document", async () => {
    const alice = testEnv.authenticatedContext("alice", {
      email: "alice@example.com",
      email_verified: true,
    }).firestore();
    await assertSucceeds(setDoc(doc(alice, "users/alice"), {
      scores: null,
      activeModule: "mirror",
      mirrorMessages: [],
      playgroundMessages: [],
      updatedAt: serverTimestamp(),
    }));
  });
});
