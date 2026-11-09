"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyPaidSession = applyPaidSession;
exports.handleStripeEvent = handleStripeEvent;
exports.restorePurchaseForUser = restorePurchaseForUser;
const checkoutConfig_1 = require("./checkoutConfig");
const checkoutTypes_1 = require("./checkoutTypes");
function baseRecord(snapshot, uid) {
    return {
        sessionId: snapshot.id,
        uid,
        paymentIntentId: snapshot.paymentIntentId,
        billingCountry: snapshot.country,
        termsAccepted: (0, checkoutTypes_1.termsWereAccepted)(snapshot),
        outcome: "pending",
        manualRefundRequired: false,
        needsManualReview: false,
        amount: snapshot.amountTotal,
        currency: snapshot.currency,
    };
}
async function grant(snapshot, uid, deps) {
    const paymentIntentId = snapshot.paymentIntentId;
    if (!paymentIntentId || snapshot.amountTotal === null || snapshot.amountTotal <= 0 || !snapshot.currency) {
        return;
    }
    const existing = await deps.store.readEntitlement(uid);
    const active = new Set(existing?.activePaymentIntentIds ?? []);
    active.add(paymentIntentId);
    const state = {
        paid: true,
        provider: "stripe",
        sessionId: snapshot.id,
        paymentIntentId,
        amount: snapshot.amountTotal,
        currency: snapshot.currency,
        interviewsAllowed: checkoutConfig_1.INTERVIEWS_ALLOWED,
        activePaymentIntentIds: [...active],
        disputeStatus: existing?.disputeStatus ?? null,
        disputeId: existing?.disputeId ?? null,
    };
    await deps.store.writeEntitlement(uid, state, { paidAt: true });
    await deps.store.writeCheckoutRecord({
        ...baseRecord(snapshot, uid),
        outcome: "granted",
        termsAccepted: true,
        manualRefundRequired: false,
        needsManualReview: false,
    });
}
async function refundNonUs(snapshot, uid, deps) {
    const record = baseRecord(snapshot, uid);
    const paymentIntentId = snapshot.paymentIntentId;
    if (!paymentIntentId) {
        deps.logger.error(`non_us_refund_failed session=${snapshot.id} uid=${uid}`);
        await deps.store.writeCheckoutRecord({
            ...record,
            outcome: "non_us_refund_failed",
            manualRefundRequired: true,
            needsManualReview: true,
        });
        return;
    }
    try {
        await deps.refunds.refundNonUs(paymentIntentId, snapshot.id);
        await deps.store.writeCheckoutRecord({
            ...record,
            outcome: "non_us_refunded",
            manualRefundRequired: false,
        });
    }
    catch (error) {
        if ((0, checkoutTypes_1.isAlreadyRefundedError)(error)) {
            await deps.store.writeCheckoutRecord({
                ...record,
                outcome: "non_us_refunded",
                manualRefundRequired: false,
            });
            return;
        }
        deps.logger.error(`non_us_refund_failed session=${snapshot.id} uid=${uid}`);
        await deps.store.writeCheckoutRecord({
            ...record,
            outcome: "non_us_refund_failed",
            manualRefundRequired: true,
            needsManualReview: true,
        });
    }
}
/**
 * Decide a paid Checkout Session. Grants only for US billing plus terms accepted.
 * Non-US sessions are refunded and never written to entitlements.
 */
async function applyPaidSession(snapshot, deps) {
    if (!snapshot.id) {
        deps.logger.error("checkout_session_missing_id");
        return;
    }
    if (snapshot.paymentStatus !== "paid") {
        if (snapshot.uid) {
            await deps.store.writeCheckoutRecord({
                ...baseRecord(snapshot, snapshot.uid),
                outcome: "pending",
            });
        }
        return;
    }
    if (snapshot.uidConflict || !snapshot.uid) {
        deps.logger.error(`checkout_uid_unusable session=${snapshot.id}`);
        return;
    }
    const uid = snapshot.uid;
    if (snapshot.countryKind === "other") {
        await refundNonUs(snapshot, uid, deps);
        return;
    }
    if (snapshot.countryKind === "unconfirmed") {
        deps.logger.error(`billing_country_unconfirmed session=${snapshot.id} uid=${uid}`);
        await deps.store.writeCheckoutRecord({
            ...baseRecord(snapshot, uid),
            outcome: "country_unconfirmed",
            needsManualReview: true,
        });
        return;
    }
    if (!(0, checkoutTypes_1.termsWereAccepted)(snapshot)) {
        deps.logger.error(`terms_not_accepted session=${snapshot.id} uid=${uid}`);
        await deps.store.writeCheckoutRecord({
            ...baseRecord(snapshot, uid),
            outcome: "terms_not_accepted",
            termsAccepted: false,
            needsManualReview: true,
        });
        return;
    }
    if (!snapshot.paymentIntentId) {
        deps.logger.error(`payment_intent_missing session=${snapshot.id} uid=${uid}`);
        await deps.store.writeCheckoutRecord({
            ...baseRecord(snapshot, uid),
            outcome: "payment_intent_missing",
            needsManualReview: true,
        });
        return;
    }
    if (snapshot.amountTotal === null || snapshot.amountTotal <= 0 || !snapshot.currency) {
        deps.logger.error(`amount_missing session=${snapshot.id} uid=${uid}`);
        await deps.store.writeCheckoutRecord({
            ...baseRecord(snapshot, uid),
            outcome: "amount_missing",
            needsManualReview: true,
        });
        return;
    }
    await grant(snapshot, uid, deps);
}
async function uidForPaymentIntent(paymentIntentId, metadataUid, deps) {
    if (paymentIntentId) {
        const record = await deps.store.findCheckoutByPaymentIntent(paymentIntentId);
        if (record?.uid)
            return record.uid;
    }
    return metadataUid;
}
async function revokePaymentIntent(uid, paymentIntentId, deps, dispute) {
    const existing = await deps.store.readEntitlement(uid);
    if (!existing)
        return;
    let active = existing.activePaymentIntentIds;
    if (active.length === 0 && existing.paymentIntentId)
        active = [existing.paymentIntentId];
    active = active.filter((id) => id !== paymentIntentId);
    const paid = active.length > 0;
    await deps.store.writeEntitlement(uid, {
        ...existing,
        paid,
        provider: "stripe",
        interviewsAllowed: checkoutConfig_1.INTERVIEWS_ALLOWED,
        activePaymentIntentIds: active,
        paymentIntentId: paid ? active[0] : existing.paymentIntentId,
        disputeStatus: dispute?.status ?? existing.disputeStatus,
        disputeId: dispute?.id ?? existing.disputeId,
    }, { refundedAt: !paid });
}
async function onChargeRefunded(charge, deps) {
    if (!(0, checkoutTypes_1.isFullRefund)(charge)) {
        deps.logger.info("partial_refund_ignored");
        return;
    }
    const uid = await uidForPaymentIntent(charge.paymentIntentId, charge.metadataUid, deps);
    if (!uid || !charge.paymentIntentId) {
        deps.logger.error("refund_uid_unknown");
        return;
    }
    const record = await deps.store.findCheckoutByPaymentIntent(charge.paymentIntentId);
    if (record && (record.outcome === "non_us_refunded" || record.outcome === "non_us_refund_failed")) {
        await deps.store.writeCheckoutRecord({
            ...record,
            outcome: "non_us_refunded",
            manualRefundRequired: false,
        });
        return;
    }
    await revokePaymentIntent(uid, charge.paymentIntentId, deps);
}
async function onDisputeOpened(dispute, deps) {
    const uid = await uidForPaymentIntent(dispute.paymentIntentId, dispute.metadataUid, deps);
    deps.logger.error(`dispute_opened dispute=${dispute.id || "unknown"} uid=${uid ?? "unknown"}`);
    if (!uid)
        return;
    const existing = await deps.store.readEntitlement(uid);
    if (!existing)
        return;
    await deps.store.writeEntitlement(uid, {
        ...existing,
        disputeStatus: "open",
        disputeId: dispute.id || existing.disputeId,
    }, {});
}
async function onDisputeClosed(dispute, deps) {
    const uid = await uidForPaymentIntent(dispute.paymentIntentId, dispute.metadataUid, deps);
    if (!uid || !dispute.paymentIntentId) {
        deps.logger.error(`dispute_closed_uid_unknown dispute=${dispute.id || "unknown"}`);
        return;
    }
    if (dispute.status === "lost") {
        deps.logger.error(`dispute_lost dispute=${dispute.id || "unknown"} uid=${uid}`);
        await revokePaymentIntent(uid, dispute.paymentIntentId, deps, {
            status: "lost",
            id: dispute.id,
        });
        return;
    }
    const existing = await deps.store.readEntitlement(uid);
    if (!existing)
        return;
    await deps.store.writeEntitlement(uid, {
        ...existing,
        disputeStatus: dispute.status,
        disputeId: dispute.id || existing.disputeId,
    }, {});
}
async function onRefundFailed(refund, deps) {
    if (!refund.paymentIntentId) {
        deps.logger.error("refund_failed_missing_payment_intent");
        return;
    }
    const record = await deps.store.findCheckoutByPaymentIntent(refund.paymentIntentId);
    const nonUs = refund.metadataReason === "non_us_billing"
        || record?.outcome === "non_us_refunded"
        || record?.outcome === "non_us_refund_failed";
    if (!nonUs) {
        deps.logger.error(`refund_failed payment_intent=${refund.paymentIntentId}`);
        return;
    }
    deps.logger.error(`non_us_refund_failed payment_intent=${refund.paymentIntentId}`);
    if (!record || record.outcome === "granted")
        return;
    await deps.store.writeCheckoutRecord({
        ...record,
        outcome: "non_us_refund_failed",
        manualRefundRequired: true,
        needsManualReview: true,
    });
}
async function handleStripeEvent(event, deps) {
    if (!event.id)
        throw new Error("missing event id");
    const claim = await deps.store.claimEvent(event.id, event.type);
    if (claim === "duplicate") {
        deps.logger.info("duplicate ignored");
        return;
    }
    try {
        const object = event.data?.object ?? {};
        if (event.type === "checkout.session.completed") {
            await applyPaidSession((0, checkoutTypes_1.snapshotCheckoutSession)(object), deps);
        }
        else if (event.type === "charge.refunded") {
            await onChargeRefunded((0, checkoutTypes_1.snapshotCharge)(object), deps);
        }
        else if (event.type === "charge.dispute.created") {
            await onDisputeOpened((0, checkoutTypes_1.snapshotDispute)(object), deps);
        }
        else if (event.type === "charge.dispute.closed") {
            await onDisputeClosed((0, checkoutTypes_1.snapshotDispute)(object), deps);
        }
        else if (event.type === "refund.failed") {
            await onRefundFailed((0, checkoutTypes_1.snapshotRefundFailed)(object), deps);
        }
        else {
            deps.logger.info(`ignored ${event.type}`);
        }
        await deps.store.completeEvent(event.id);
    }
    catch (error) {
        deps.logger.error(`stripe_event_failed type=${event.type}`);
        throw error;
    }
}
async function restorePurchaseForUser(uid, deps) {
    const existing = await deps.store.readEntitlement(uid);
    if (existing?.paid)
        return { restored: true };
    const ids = new Set();
    const local = await deps.store.listCheckoutRecordsForUid(uid);
    for (const record of local)
        ids.add(record.sessionId);
    const remote = await deps.sessions.findSucceededSessionIds(uid);
    for (const id of remote)
        ids.add(id);
    for (const sessionId of ids) {
        const snapshot = await deps.sessions.retrieveSession(sessionId);
        if (!snapshot || snapshot.uid !== uid)
            continue;
        await applyPaidSession(snapshot, deps);
    }
    const after = await deps.store.readEntitlement(uid);
    return { restored: after?.paid === true };
}
//# sourceMappingURL=checkoutEvents.js.map