/**
 * @NApiVersion 2.1
 * @NModuleScope SameAccount
 *
 * Aging helpers for the dunning process (pure functions, unit-tested).
 *   B1 = 1-30 days overdue   -> friendly reminder
 *   B2 = 31-60 days overdue  -> firm reminder
 *   B3 = 61+ days overdue    -> final notice + account manager in copy
 */
define([], () => {

    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    // Day number in UTC. ISO date strings ("YYYY-MM-DD") are parsed by hand so the
    // result does not depend on the server time zone; Date objects use local Y/M/D.
    const dayNumber = (d) => {
        if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) {
            return Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10)) / MS_PER_DAY;
        }
        const x = new Date(d);
        return Date.UTC(x.getFullYear(), x.getMonth(), x.getDate()) / MS_PER_DAY;
    };

    const daysOverdue = (dueDate, today = new Date()) =>
        Math.max(Math.floor(dayNumber(today) - dayNumber(dueDate)), 0);

    const bucketFor = (days) => {
        if (days <= 0) return null;
        if (days <= 30) return 'B1';
        if (days <= 60) return 'B2';
        return 'B3';
    };

    const SEVERITY = { B1: 1, B2: 2, B3: 3 };

    const worstBucket = (buckets) =>
        buckets.reduce((worst, b) => (SEVERITY[b] > (SEVERITY[worst] || 0) ? b : worst), null);

    const SUBJECTS = {
        B1: 'Friendly reminder: invoices past due',
        B2: 'Second notice: overdue invoices require your attention',
        B3: 'Final notice: seriously overdue invoices'
    };

    /** Summarises invoices: totals per bucket + worst bucket. */
    const summarize = (invoices, today = new Date()) => {
        const totals = { B1: 0, B2: 0, B3: 0 };
        const buckets = [];
        invoices.forEach(inv => {
            const days = daysOverdue(inv.duedate, today);
            const b = bucketFor(days);
            if (!b) return;
            inv.days_overdue = days;
            inv.bucket = b;
            totals[b] = Math.round((totals[b] + Number(inv.amount_due || 0)) * 100) / 100;
            buckets.push(b);
        });
        return { totals, worst: worstBucket(buckets), count: buckets.length };
    };

    return { daysOverdue, bucketFor, worstBucket, summarize, SUBJECTS };
});
