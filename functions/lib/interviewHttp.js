"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAccessStatus = handleAccessStatus;
exports.handleReserveInterview = handleReserveInterview;
exports.handleCompleteInterview = handleCompleteInterview;
const auth_1 = require("./auth");
const gate_1 = require("./gate");
function sendGate(res, error) {
    res.status(error.status).json({ error: error.message, code: error.code });
}
function sendFailure(res, status, code, error) {
    res.status(status).json({ error, code });
}
async function requireUser(req, deps, verified) {
    if (deps.enforceAppCheck()) {
        const token = (0, gate_1.readHeader)(req, "x-firebase-appcheck") ?? (0, gate_1.readHeader)(req, "X-Firebase-AppCheck");
        if (!token)
            throw (0, gate_1.appCheckError)();
        try {
            await deps.verifyAppCheck(token);
        }
        catch {
            throw (0, gate_1.appCheckError)();
        }
    }
    const user = await (0, auth_1.verifyBearerToken)((0, gate_1.readHeader)(req, "authorization"), deps.verifyIdToken);
    return verified ? (0, auth_1.requireEmailVerified)(user) : user;
}
async function handleAccessStatus(req, res, deps) {
    if ((req.method ?? "GET").toUpperCase() !== "GET") {
        sendFailure(res, 405, "method_not_allowed", "GET required.");
        return;
    }
    try {
        const user = await requireUser(req, deps, false);
        const access = await deps.readAccess(user.uid);
        res.status(200).json(access);
    }
    catch (error) {
        const gate = (0, auth_1.asGateError)(error);
        if (gate) {
            sendGate(res, gate);
            return;
        }
        sendFailure(res, 500, "access_failed", "We couldn't confirm your access.");
    }
}
async function handleReserveInterview(req, res, deps) {
    if ((req.method ?? "GET").toUpperCase() !== "POST") {
        sendFailure(res, 405, "method_not_allowed", "POST required.");
        return;
    }
    try {
        const user = await requireUser(req, deps, true);
        const outcome = await deps.reserve(user.uid, deps.now());
        res.status(200).json({
            reservationId: outcome.id,
            created: outcome.created,
            retake: outcome.retake,
            completed: outcome.ledger.completedIds.length,
            remaining: outcome.remaining,
        });
    }
    catch (error) {
        const gate = (0, auth_1.asGateError)(error);
        if (gate) {
            sendGate(res, gate);
            return;
        }
        sendFailure(res, 500, "reserve_failed", "We couldn't start this interview. Try again.");
    }
}
async function handleCompleteInterview(req, res, deps) {
    if ((req.method ?? "GET").toUpperCase() !== "POST") {
        sendFailure(res, 405, "method_not_allowed", "POST required.");
        return;
    }
    try {
        const user = await requireUser(req, deps, true);
        const body = req.body && typeof req.body === "object" ? req.body : {};
        const reservationId = typeof body.reservationId === "string" ? body.reservationId : null;
        const result = await deps.complete(user.uid, reservationId, deps.now());
        res.status(200).json(result);
    }
    catch (error) {
        const gate = (0, auth_1.asGateError)(error);
        if (gate) {
            sendGate(res, gate);
            return;
        }
        sendFailure(res, 500, "complete_failed", "We couldn't save this interview. Try again.");
    }
}
//# sourceMappingURL=interviewHttp.js.map