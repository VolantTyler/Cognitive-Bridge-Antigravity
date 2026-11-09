/**
 * Browser origins allowed to call chatProxy and judgeProxy.
 * Firebase Hosting rewrites are same-origin (no CORS preflight). Requests
 * with no Origin header still pass. Localhost is included only in the emulator.
 */

export const PRODUCTION_ORIGINS = [
  "https://cognitive-bridge-ai.web.app",
  "https://cognitive-bridge-ai.firebaseapp.com",
] as const;

export const EMULATOR_ORIGINS = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://0.0.0.0:3000",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://localhost:4173",
  "http://127.0.0.1:4173",
] as const;

export function isFunctionsEmulator(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.FUNCTIONS_EMULATOR === "true" || Boolean(env.FIREBASE_EMULATOR_HUB);
}

export function allowedCorsOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const origins: string[] = [...PRODUCTION_ORIGINS];
  if (isFunctionsEmulator(env)) {
    origins.push(...EMULATOR_ORIGINS);
  }
  return origins;
}
