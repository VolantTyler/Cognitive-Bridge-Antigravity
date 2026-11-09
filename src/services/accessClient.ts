/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { authorizedAiHeaders, AiAccessError } from "./aiAccess";

export interface AccessSnapshot {
  paid: boolean;
  legacy: boolean;
  interviewsAllowed: number;
  interviewsCompleted: number;
  interviewsRemaining: number;
  inProgress: boolean;
}

export interface ReserveSnapshot {
  reservationId: string;
  created: boolean;
  retake: boolean;
  completed: number;
  remaining: number;
}

export interface CompleteSnapshot {
  newlyCompleted: boolean;
  remaining: number;
  completed: number;
}

const RESERVATION_KEY = "cb.interviewReservation";

function endpoint(path: string, functionName: string): string {
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0") {
    const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID || "cognitive-bridge-ai";
    return `http://localhost:5001/${projectId}/us-central1/${functionName}`;
  }
  return path;
}

function emptyAccess(): AccessSnapshot {
  return {
    paid: false,
    legacy: false,
    interviewsAllowed: 0,
    interviewsCompleted: 0,
    interviewsRemaining: 0,
    inProgress: false,
  };
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function readStoredReservation(): string | null {
  try {
    return sessionStorage.getItem(RESERVATION_KEY);
  } catch {
    return null;
  }
}

export function storeReservation(id: string): void {
  try {
    sessionStorage.setItem(RESERVATION_KEY, id);
  } catch {
    // sessionStorage can throw. The server still holds the reservation.
  }
}

export async function loadAccessStatus(): Promise<AccessSnapshot> {
  let headers: Record<string, string>;
  try {
    headers = await authorizedAiHeaders();
  } catch (error) {
    if (error instanceof AiAccessError) return emptyAccess();
    return emptyAccess();
  }
  const response = await fetch(endpoint("/api/access", "accessStatus"), { headers });
  if (!response.ok) return emptyAccess();
  const body = await response.json() as Partial<AccessSnapshot>;
  return {
    paid: body.paid === true,
    legacy: body.legacy === true,
    interviewsAllowed: asNumber(body.interviewsAllowed),
    interviewsCompleted: asNumber(body.interviewsCompleted),
    interviewsRemaining: asNumber(body.interviewsRemaining),
    inProgress: body.inProgress === true,
  };
}

export async function reserveInterview(): Promise<ReserveSnapshot> {
  const headers = await authorizedAiHeaders();
  const response = await fetch(endpoint("/api/interview/reserve", "reserveInterviewSlot"), {
    method: "POST",
    headers,
  });
  const body = await response.json().catch(() => ({})) as Partial<ReserveSnapshot> & { code?: unknown };
  if (!response.ok || typeof body.reservationId !== "string") {
    const error = new AiAccessError(body.code === "interviews_exhausted" ? "interviews_exhausted" : "payment_required");
    throw error;
  }
  storeReservation(body.reservationId);
  return {
    reservationId: body.reservationId,
    created: body.created === true,
    retake: body.retake === true,
    completed: asNumber(body.completed),
    remaining: asNumber(body.remaining),
  };
}

export async function completeInterview(reservationId: string | null): Promise<CompleteSnapshot> {
  const headers = await authorizedAiHeaders();
  const response = await fetch(endpoint("/api/interview/complete", "completeInterview"), {
    method: "POST",
    headers,
    body: JSON.stringify({ reservationId }),
  });
  if (!response.ok) {
    throw new AiAccessError("payment_required");
  }
  const body = await response.json() as Partial<CompleteSnapshot>;
  return {
    newlyCompleted: body.newlyCompleted === true,
    remaining: asNumber(body.remaining),
    completed: asNumber(body.completed),
  };
}
