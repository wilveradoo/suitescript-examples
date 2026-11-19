/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * Dunning / collections reminders - Andes Hospitality Supply S.A. (fictional demo)
 *
 * - Pulls overdue open invoices with SuiteQL, skipping disputed invoices and
 *   customers flagged "dunning paused".
 * - Groups by customer (map) and sends ONE email per customer (reduce) with an
 *   aging table; tone depends on the worst bucket (1-30 / 31-60 / 61+ days).
 * - Bucket B3 also copies the account manager.
 * - Every email is logged in customrecord_andes_dunning_log; a run summary goes
 *   to Finance.
 *
 * Script parameters:
 *   custscript_andes_dun_author      employee ID used as sender
 *   custscript_andes_dun_finance     employee/group ID that receives the run summary
 */
define(['N/query', 'N/email', 'N/record', 'N/runtime', 'N/log', '../lib/aging'],
    (query, email, record, runtime, log, aging) => {

    const getInputData = () => {
        return query.runSuiteQL({
            query: `
                SELECT t.id AS invoice_id, t.tranid, t.entity AS customer_id,
                       c.companyname, c.email AS customer_email, c.salesrep AS rep_id,
                       t.duedate, t.foreignamountunpaid AS amount_due,
                       BUILTIN.DF(t.currency) AS currency
                FROM transaction t
                JOIN customer c ON c.id = t.entity
                WHERE t.type = 'CustInvc'
                  AND t.status = 'CustInvc:A'
                  AND t.duedate < CURRENT_DATE
                  AND NVL(t.custbody_andes_disputed, 'F') = 'F'
                  AND NVL(c.custentity_andes_dunning_paused, 'F') = 'F'
                  AND c.email IS NOT NULL
                ORDER BY t.entity, t.duedate`
        }).asMappedResults();
    };

    const map = (context) => {
        const row = JSON.parse(context.value);
        context.write({ key: row.customer_id, value: row });
    };

    const buildTable = (invoices) => {
        const rows = invoices.map(i =>
            `<tr><td>${i.tranid}</td><td>${i.duedate}</td><td align="right">${i.days_overdue}</td>` +
            `<td align="right">${i.amount_due} ${i.currency}</td></tr>`).join('');
        return `<table border="1" cellpadding="4" cellspacing="0">` +
               `<tr><th>Invoice</th><th>Due date</th><th>Days overdue</th><th>Amount</th></tr>${rows}</table>`;
    };

    const reduce = (context) => {
        const invoices = context.values.map(v => JSON.parse(v));
        const { customer_email, companyname, rep_id } = invoices[0];
        const { totals, worst, count } = aging.summarize(invoices);
        if (!worst) return;

        const author = runtime.getCurrentScript().getParameter({ name: 'custscript_andes_dun_author' });
        const cc = worst === 'B3' && rep_id ? [Number(rep_id)] : undefined;

        try {
            email.send({
                author,
                recipients: [customer_email],
                cc,
                subject: `${aging.SUBJECTS[worst]} - ${companyname}`,
                body: `<p>Hello ${companyname},</p>` +
                      `<p>Our records show ${count} overdue invoice(s):</p>${buildTable(invoices)}` +
                      `<p>If you already paid, please send us the transfer receipt so we can apply it.</p>`,
                relatedRecords: { entityId: Number(context.key) }
            });

            const logRec = record.create({ type: 'customrecord_andes_dunning_log' });
            logRec.setValue({ fieldId: 'custrecord_adl_customer', value: Number(context.key) });
            logRec.setValue({ fieldId: 'custrecord_adl_bucket', value: worst });
            logRec.setValue({ fieldId: 'custrecord_adl_invoice_count', value: count });
            logRec.save();

            context.write({ key: context.key, value: JSON.stringify({ worst, count, totals }) });
        } catch (e) {
            log.error({ title: `Dunning failed for customer ${context.key}`, details: e });
            throw e; // surfaces in summarize() reduceSummary.errors
        }
    };

    const summarize = (summary) => {
        const perBucket = { B1: 0, B2: 0, B3: 0 };
        let customers = 0;
        summary.output.iterator().each((key, value) => {
            customers++;
            perBucket[JSON.parse(value).worst]++;
            return true;
        });

        const errors = [];
        summary.mapSummary.errors.iterator().each((k, e) => { errors.push(`map ${k}: ${e}`); return true; });
        summary.reduceSummary.errors.iterator().each((k, e) => { errors.push(`reduce ${k}: ${e}`); return true; });

        log.audit('Dunning run', { customers, perBucket, errors: errors.length });

        const finance = runtime.getCurrentScript().getParameter({ name: 'custscript_andes_dun_finance' });
        const author = runtime.getCurrentScript().getParameter({ name: 'custscript_andes_dun_author' });
        if (finance && author) {
            email.send({
                author,
                recipients: [finance],
                subject: `Dunning run: ${customers} customers contacted${errors.length ? ` (${errors.length} errors)` : ''}`,
                body: `1-30 days: ${perBucket.B1}\n31-60 days: ${perBucket.B2}\n61+ days: ${perBucket.B3}\n` +
                      (errors.length ? `\nErrors:\n${errors.slice(0, 20).join('\n')}` : '')
            });
        }
    };

    return { getInputData, map, reduce, summarize };
});
