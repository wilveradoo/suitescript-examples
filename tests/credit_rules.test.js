const test = require('node:test');
const assert = require('node:assert');
global.define = (deps, factory) => { module.exports = factory(); };
require('../src/lib/credit_rules.js');
const { evaluate, CODES } = module.exports;

const base = { creditLimit: 100000, balance: 60000, overdueBalance: 0, orderTotal: 30000, tier: 'B', creditHold: false };

test('allows an order inside the limit', () => {
    assert.strictEqual(evaluate(base).code, CODES.OK);
});

test('blocks tier B above the limit', () => {
    const r = evaluate({ ...base, orderTotal: 45000 });
    assert.strictEqual(r.allowed, false);
    assert.strictEqual(r.code, CODES.LIMIT_EXCEEDED);
    assert.strictEqual(r.exposure, 105000);
});

test('tier A gets 15% tolerance', () => {
    const r = evaluate({ ...base, tier: 'A', orderTotal: 45000 });
    assert.strictEqual(r.allowed, true);
    assert.strictEqual(r.allowedLimit, 115000);
});

test('tier C is blocked when it has overdue invoices', () => {
    const r = evaluate({ ...base, tier: 'C', overdueBalance: 1200 });
    assert.strictEqual(r.code, CODES.OVERDUE_TIER_C);
});

test('manual credit hold always blocks', () => {
    assert.strictEqual(evaluate({ ...base, creditHold: true }).code, CODES.CREDIT_HOLD);
});

test('no limit configured -> allowed', () => {
    assert.strictEqual(evaluate({ ...base, creditLimit: 0, orderTotal: 999999 }).code, CODES.NO_LIMIT);
});
