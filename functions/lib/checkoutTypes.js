"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clientStatusForRecord = clientStatusForRecord;
exports.emptyEntitlement = emptyEntitlement;
exports.idField = idField;
exports.normalizeBillingCountry = normalizeBillingCountry;
exports.snapshotCheckoutSession = snapshotCheckoutSession;
exports.snapshotCharge = snapshotCharge;
exports.snapshotDispute = snapshotDispute;
exports.snapshotRefundFailed = snapshotRefundFailed;
exports.isFullRefund = isFullRefund;
exports.isAlreadyRefundedError = isAlreadyRefundedError;
exports.termsWereAccepted = termsWereAccepted;
const checkoutConfig_1 = require("./checkoutConfig");
function clientStatusForRecord(record, entitlementPaid) {
    if (record?.outcome === "non_us_refunded")
        return "non_us_refunded";
    if (record?.outcome === "non_us_refund_failed")
        return "non_us_refund_failed";
    if (record?.outcome === "terms_not_accepted")
        return "terms_not_accepted";
    if (record?.outcome === "country_unconfirmed")
        return "country_unconfirmed";
    if (record?.outcome === "granted" || entitlementPaid)
        return "paid";
    if (!record)
        return "pending";
    return "pending";
}
function emptyEntitlement(partial) {
    return {
        paid: partial.paid,
        provider: "stripe",
        sessionId: partial.sessionId,
        paymentIntentId: partial.paymentIntentId,
        amount: partial.amount,
        currency: partial.currency,
        interviewsAllowed: checkoutConfig_1.INTERVIEWS_ALLOWED,
        activePaymentIntentIds: partial.activePaymentIntentIds,
        disputeStatus: null,
        disputeId: null,
    };
}
function asRecord(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    return value;
}
function stringField(value) {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
function numberField(value) {
    return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function idField(value) {
    const direct = stringField(value);
    if (direct)
        return direct;
    const record = asRecord(value);
    return record ? stringField(record.id) : null;
}
function normalizeBillingCountry(raw) {
    if (!raw)
        return "unconfirmed";
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(code))
        return "unconfirmed";
    if (code === "US")
        return "US";
    return "other";
}
function snapshotCheckoutSession(object) {
    const metadata = asRecord(object.metadata);
    const fromRef = stringField(object.client_reference_id);
    const fromMeta = metadata ? stringField(metadata.uid) : null;
    const uidConflict = Boolean(fromRef && fromMeta && fromRef !== fromMeta);
    const customer = asRecord(object.customer_details);
    const address = customer ? asRecord(customer.address) : null;
    const rawCountry = address ? stringField(address.country) : null;
    const consent = asRecord(object.consent);
    const currency = stringField(object.currency);
    return {
        id: stringField(object.id) ?? "",
        paymentStatus: stringField(object.payment_status),
        uid: uidConflict ? null : fromRef || fromMeta,
        uidConflict,
        countryKind: normalizeBillingCountry(rawCountry),
        country: rawCountry ? rawCountry.trim().toUpperCase() : null,
        termsOfService: consent ? stringField(consent.terms_of_service) : null,
        paymentIntentId: idField(object.payment_intent),
        amountTotal: numberField(object.amount_total),
        currency: currency ? currency.toLowerCase() : null,
    };
}
function snapshotCharge(object) {
    const metadata = asRecord(object.metadata);
    const amount = numberField(object.amount);
    const amountRefunded = numberField(object.amount_refunded);
    const fullyRefunded = object.refunded === true
        || (amount !== null && amount > 0 && amountRefunded !== null && amountRefunded >= amount);
    return {
        paymentIntentId: idField(object.payment_intent),
        metadataUid: metadata ? stringField(metadata.uid) : null,
        amount,
        amountRefunded,
        fullyRefunded,
    };
}
function snapshotDispute(object) {
    const metadata = asRecord(object.metadata);
    const charge = asRecord(object.charge);
    const chargeMeta = charge ? asRecord(charge.metadata) : null;
    return {
        id: stringField(object.id) ?? "",
        status: stringField(object.status),
        paymentIntentId: idField(object.payment_intent) || (charge ? idField(charge.payment_intent) : null),
        metadataUid: (metadata ? stringField(metadata.uid) : null)
            || (chargeMeta ? stringField(chargeMeta.uid) : null),
    };
}
function snapshotRefundFailed(object) {
    const metadata = asRecord(object.metadata);
    return {
        paymentIntentId: idField(object.payment_intent),
        metadataReason: metadata ? stringField(metadata.reason) : null,
    };
}
function isFullRefund(charge) {
    return charge.fullyRefunded;
}
function isAlreadyRefundedError(error) {
    if (!error || typeof error !== "object" || !("code" in error))
        return false;
    return String(error.code) === "charge_already_refunded";
}
function termsWereAccepted(snapshot) {
    return snapshot.termsOfService === "accepted";
}
//# sourceMappingURL=checkoutTypes.js.map