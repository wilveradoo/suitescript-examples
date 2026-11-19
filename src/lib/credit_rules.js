/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Pure credit rules for Andes Hospitality Supply S.A. (fictional company).
 * No N/* modules on purpose: the logic is unit-tested with plain Node (see /tests).
 *
 * Credit tiers (custentity_andes_credit_tier):
 *   A = strategic hotel groups   -> 15% tolerance over the limit
 *   B = standard accounts        -> no tolerance
 *   C = new / under review       -> no tolerance and blocked if any invoice is overdue
 */
define([], () => {

    const TOLERANCE_BY_TIER = { A: 0.15, B: 0, C: 0 };

    const CODES = Object.freeze({
        OK: 'OK',
        NO_LIMIT: 'NO_LIMIT',
        CREDIT_HOLD: 'CREDIT_HOLD',
        OVERDUE_TIER_C: 'OVERDUE_TIER_C',
        LIMIT_EXCEEDED: 'LIMIT_EXCEEDED'
    });

    const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

    /**
     * @param {Object} p
     * @param {number} p.creditLimit      0 or empty = no limit configured
     * @param {number} p.balance          open receivables of the customer
     * @param {number} p.overdueBalance   overdue part of the balance
     * @param {number} p.orderTotal       total of the order being saved
     * @param {string} [p.tier]           'A' | 'B' | 'C' (defaults to 'B')
     * @param {boolean} [p.creditHold]    manual credit hold flag
     * @returns {{allowed:boolean, code:string, exposure:number, allowedLimit:number, message:string}}
     */
    const evaluate = ({ creditLimit, balance, overdueBalance, orderTotal, tier, creditHold }) => {
        const limit = Number(creditLimit) || 0;
        const bal = Number(balance) || 0;
        const overdue = Number(overdueBalance) || 0;
        const total = Number(orderTotal) || 0;
        const t = TOLERANCE_BY_TIER[tier] !== undefined ? tier : 'B';

        const exposure = round2(bal + total);
        const allowedLimit = round2(limit * (1 + TOLERANCE_BY_TIER[t]));
        const base = { exposure, allowedLimit };

        if (creditHold) {
            return { ...base, allowed: false, code: CODES.CREDIT_HOLD, message: 'Customer is on manual credit hold.' };
        }
        if (t === 'C' && overdue > 0) {
            return { ...base, allowed: false, code: CODES.OVERDUE_TIER_C, message: `Tier C customer has ${round2(overdue)} overdue.` };
        }
        if (!limit) {
            return { ...base, allowed: true, code: CODES.NO_LIMIT, message: 'No credit limit configured.' };
        }
        if (exposure > allowedLimit) {
            return {
                ...base, allowed: false, code: CODES.LIMIT_EXCEEDED,
                message: `Exposure ${exposure} exceeds allowed limit ${allowedLimit} (tier ${t}).`
            };
        }
        return { ...base, allowed: true, code: CODES.OK, message: 'Within credit limit.' };
    };

    return { evaluate, CODES, round2 };
});
