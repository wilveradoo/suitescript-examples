const test = require('node:test');
const assert = require('node:assert');
global.define = (deps, factory) => { module.exports = factory(); };
require('../src/lib/aging.js');
const aging = module.exports;

const today = new Date(2026, 10, 19); // 19-Nov-2026

test('bucketFor maps days to buckets', () => {
    assert.strictEqual(aging.bucketFor(0), null);
    assert.strictEqual(aging.bucketFor(1), 'B1');
    assert.strictEqual(aging.bucketFor(30), 'B1');
    assert.strictEqual(aging.bucketFor(31), 'B2');
    assert.strictEqual(aging.bucketFor(61), 'B3');
});

test('daysOverdue never goes negative', () => {
    assert.strictEqual(aging.daysOverdue('2026-12-01', today), 0);
    assert.strictEqual(aging.daysOverdue('2026-11-09', today), 10);
});

test('summarize totals per bucket and picks the worst', () => {
    const invoices = [
        { tranid: 'INV-5001', duedate: '2026-11-09', amount_due: 1200.5 },
        { tranid: 'INV-4872', duedate: '2026-09-20', amount_due: 8400 },
        { tranid: 'INV-4310', duedate: '2026-08-01', amount_due: 15000 }
    ];
    const s = aging.summarize(invoices, today);
    assert.strictEqual(s.worst, 'B3');
    assert.strictEqual(s.count, 3);
    assert.deepStrictEqual(s.totals, { B1: 1200.5, B2: 8400, B3: 15000 });
});
