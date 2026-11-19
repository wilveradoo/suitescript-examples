/**
 * @NApiVersion 2.1
 * @NScriptType MapReduceScript
 * @NModuleScope SameAccount
 *
 * Collections reminders (example).
 * Finds overdue open invoices with SuiteQL, groups them by customer and sends
 * ONE email per customer listing all of their overdue invoices (no duplicates).
 * Script parameter: custscript_cr_author (internal ID of the sender employee).
 */
define(['N/query', 'N/email', 'N/runtime', 'N/log'], (query, email, runtime, log) => {

    const getInputData = () => {
        return query.runSuiteQL({
            query: `
                SELECT t.id AS invoice_id, t.tranid, t.entity AS customer_id,
                       t.duedate, t.foreignamountunpaid AS amount_due
                FROM transaction t
                WHERE t.type = 'CustInvc'
                  AND t.status = 'CustInvc:A'
                  AND t.duedate < CURRENT_DATE
                ORDER BY t.entity, t.duedate`
        }).asMappedResults();
    };

    // Group by customer so reduce() receives all invoices of one customer.
    const map = (context) => {
        const row = JSON.parse(context.value);
        context.write({ key: row.customer_id, value: row });
    };

    const reduce = (context) => {
        const invoices = context.values.map(v => JSON.parse(v));
        const author = runtime.getCurrentScript().getParameter({ name: 'custscript_cr_author' });

        const lines = invoices
            .map(i => `- Invoice ${i.tranid} | due ${i.duedate} | amount ${i.amount_due}`)
            .join('\n');

        try {
            email.send({
                author,
                recipients: Number(context.key),
                subject: 'Payment reminder: overdue invoices',
                body: `Hello,\n\nOur records show the following overdue invoices:\n\n${lines}\n\nPlease let us know if you have any questions.\n`
            });
            context.write({ key: context.key, value: invoices.length });
        } catch (e) {
            log.error({ title: `Email failed for customer ${context.key}`, details: e });
        }
    };

    const summarize = (summary) => {
        let customers = 0;
        summary.output.iterator().each(() => { customers++; return true; });
        log.audit('Collections reminders', `Emails sent to ${customers} customers`);

        summary.mapSummary.errors.iterator().each((k, e) => { log.error(`Map error ${k}`, e); return true; });
        summary.reduceSummary.errors.iterator().each((k, e) => { log.error(`Reduce error ${k}`, e); return true; });
    };

    return { getInputData, map, reduce, summarize };
});
