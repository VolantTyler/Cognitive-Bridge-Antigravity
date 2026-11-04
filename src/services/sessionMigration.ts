/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ComparisonMessage, Message, ModuleId, OceanScores } from "../types";

export interface GuestSession {
  scores: OceanScores | null;
  mirrorMessages: Message[];
  playgroundMessages: ComparisonMessage[];
  activeModule: ModuleId;
}

export interface StoredSession {
  scores: OceanScores | null;
  mirrorMessages: Message[];
  playgroundMessages: Array<{
    user: string;
    aligned: string;
    unaligned: string;
    loading: false;
  }>;
  activeModule: ModuleId;
}

/**
 * First sign-in copies the local guest session onto users/{uid}.
 * A later sign-in, Google or email/password, restores that same document.
 * The provider is not an input: both methods share this path.
 */
export async function adoptGuestSession(options: {
  uid: string;
  guest: GuestSession;
  read: (uid: string) => Promise<StoredSession | null>;
  write: (uid: string, session: StoredSession) => Promise<void>;
}): Promise<{ action: "restored" | "migrated"; session: StoredSession; uid: string }> {
  const existing = await options.read(options.uid);
  if (existing) {
    return { action: "restored", session: existing, uid: options.uid };
  }
  const session = guestToStoredSession(options.guest);
  await options.write(options.uid, session);
  return { action: "migrated", session, uid: options.uid };
}

export function guestToStoredSession(guest: GuestSession): StoredSession {
  return {
    scores: guest.scores,
    mirrorMessages: guest.mirrorMessages,
    playgroundMessages: guest.playgroundMessages.map((message) => ({
      user: message.user,
      aligned: message.aligned,
      unaligned: message.unaligned,
      loading: false as const,
    })),
    activeModule: guest.activeModule,
  };
}

export function sessionFromCloudData(data: { [key: string]: unknown } | undefined): StoredSession {
  const active = data?.activeModule;
  const playground = Array.isArray(data?.playgroundMessages) ? data.playgroundMessages : [];
  return {
    scores: (data?.scores as OceanScores | null) || null,
    mirrorMessages: Array.isArray(data?.mirrorMessages) ? (data.mirrorMessages as Message[]) : [],
    playgroundMessages: playground.map((message) => {
      const item = (message ?? {}) as ComparisonMessage;
      return {
        user: typeof item.user === "string" ? item.user : "",
        aligned: typeof item.aligned === "string" ? item.aligned : "",
        unaligned: typeof item.unaligned === "string" ? item.unaligned : "",
        loading: false as const,
      };
    }),
    activeModule: active === "tailor" || active === "playground" ? active : "mirror",
  };
}
