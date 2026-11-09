"use strict";
/**
 * Browser origins allowed to call chatProxy and judgeProxy.
 * Firebase Hosting rewrites are same-origin (no CORS preflight). Requests
 * with no Origin header still pass. Localhost is included only in the emulator.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMULATOR_ORIGINS = exports.PRODUCTION_ORIGINS = void 0;
exports.isFunctionsEmulator = isFunctionsEmulator;
exports.allowedCorsOrigins = allowedCorsOrigins;
exports.PRODUCTION_ORIGINS = [
    "https://cognitive-bridge-ai.web.app",
    "https://cognitive-bridge-ai.firebaseapp.com",
];
exports.EMULATOR_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://0.0.0.0:3000",
    "http://localhost:5000",
    "http://127.0.0.1:5000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
];
function isFunctionsEmulator(env = process.env) {
    return env.FUNCTIONS_EMULATOR === "true" || Boolean(env.FIREBASE_EMULATOR_HUB);
}
function allowedCorsOrigins(env = process.env) {
    const origins = [...exports.PRODUCTION_ORIGINS];
    if (isFunctionsEmulator(env)) {
        origins.push(...exports.EMULATOR_ORIGINS);
    }
    return origins;
}
//# sourceMappingURL=cors.js.map