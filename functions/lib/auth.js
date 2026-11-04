"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.verifyBearerToken = verifyBearerToken;
exports.verifyIdTokenWithAdmin = verifyIdTokenWithAdmin;
exports.asGateError = asGateError;
const gate_1 = require("./gate");
async function verifyBearerToken(authorizationHeader, verify) {
    const token = (0, gate_1.bearerToken)(authorizationHeader);
    if (!token)
        throw (0, gate_1.unauthenticatedError)();
    let decoded;
    try {
        decoded = await verify(token);
    }
    catch {
        throw (0, gate_1.unauthenticatedError)();
    }
    if (!decoded || typeof decoded.uid !== "string" || decoded.uid.length === 0) {
        throw (0, gate_1.unauthenticatedError)();
    }
    return {
        uid: decoded.uid,
        email: typeof decoded.email === "string" ? decoded.email : null,
        email_verified: decoded.email_verified === true,
    };
}
async function verifyIdTokenWithAdmin(token) {
    const { getApps, initializeApp } = await Promise.resolve().then(() => __importStar(require("firebase-admin/app")));
    const { getAuth } = await Promise.resolve().then(() => __importStar(require("firebase-admin/auth")));
    if (getApps().length === 0) {
        initializeApp();
    }
    const decoded = await getAuth().verifyIdToken(token);
    return {
        uid: decoded.uid,
        email: decoded.email,
        email_verified: decoded.email_verified,
    };
}
function asGateError(error) {
    return error instanceof gate_1.GateError ? error : null;
}
//# sourceMappingURL=auth.js.map