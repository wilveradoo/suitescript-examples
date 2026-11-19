/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Credit guard on Sales Orders - Andes Hospitality Supply S.A. (fictional demo)
 *
 * - Evaluates credit rules (limit, tier tolerance, overdue balance, manual hold).
 * - Blocks the order and notifies Finance, logging every block in
 *   customrecord_andes_credit_event.
 * - Roles in custscript_andes_cg_bypass_roles may override; the override is logged
 *   too, so Finance can audit who released which order.
 *
 * Script parameters:
 *   custscript_andes_cg_bypass_roles  comma separated role IDs (e.g. "3,1042")
 *   custscript_andes_cg_finance_email internal ID of the Finance employee/group to notify
 */
define(['N/search', 'N/runtime', 'N/record', 'N/email', 'N/error', 'N/log', '../lib/credit_rules'],
    (search, runtime, record, email, error, log, rules) => {

    const CUSTOMER_FIELDS = [
        'companyname', 'creditlimit', 'balance', 'overduebalance',
        'custentity_andes_credit_tier', 'custentity_andes_credit_hold'
    ];

    const isBypassRole = () => {
        const raw = runtime.getCurrentScript().getParameter({ name: 'custscript_andes_cg_bypass_roles' }) || '';
        return raw.split(',').map(r => r.trim()).filter(Boolean).includes(String(runtime.getCurrentUser().role));
    };

    const logEvent = ({ customerId, orderTotal, decision, action }) => {
        try {
            const rec = record.create({ type: 'customrecord_andes_credit_event' });
            rec.setValue({ fieldId: 'custrecord_ace_customer', value: customerId });
            rec.setValue({ fieldId: 'custrecord_ace_action', value: action });          // BLOCKED | OVERRIDE
            rec.setValue({ fieldId: 'custrecord_ace_code', value: decision.code });
            rec.setValue({ fieldId: 'custrecord_ace_exposure', value: decision.exposure });
            rec.setValue({ fieldId: 'custrecord_ace_order_total', value: orderTotal });
            rec.setValue({ fieldId: 'custrecord_ace_user', value: runtime.getCurrentUser().id });
            rec.save();
        } catch (e) {
            // Logging must never break the transaction flow.
            log.error('Could not write credit event', e);
        }
    };

    const notifyFinance = ({ customerName, orderTotal, decision }) => {
        const recipient = runtime.getCurrentScript().getParameter({ name: 'custscript_andes_cg_finance_email' });
        if (!recipient) return;
        try {
            email.send({
                author: runtime.getCurrentUser().id,
                recipients: [recipient],
                subject: `Credit block: ${customerName} (${decision.code})`,
                body: `A Sales Order of ${orderTotal} was blocked for ${customerName}.\n${decision.message}\n` +
                      `Exposure: ${decision.exposure} | Allowed limit: ${decision.allowedLimit}`
            });
        } catch (e) {
            log.error('Finance notification failed', e);
        }
    };

    const beforeSubmit = (context) => {
        const { newRecord, type, UserEventType } = context;
        if (type !== UserEventType.CREATE && type !== UserEventType.EDIT) return;
        if (runtime.executionContext === runtime.ContextType.CSV_IMPORT) return;

        const customerId = newRecord.getValue({ fieldId: 'entity' });
        if (!customerId) return;

        const c = search.lookupFields({ type: search.Type.CUSTOMER, id: customerId, columns: CUSTOMER_FIELDS });
        const orderTotal = parseFloat(newRecord.getValue({ fieldId: 'total' })) || 0;

        const decision = rules.evaluate({
            creditLimit: parseFloat(c.creditlimit),
            balance: parseFloat(c.balance),
            overdueBalance: parseFloat(c.overduebalance),
            orderTotal,
            tier: c.custentity_andes_credit_tier && c.custentity_andes_credit_tier[0] && c.custentity_andes_credit_tier[0].text,
            creditHold: c.custentity_andes_credit_hold === true
        });

        log.debug('Credit decision', { customerId, orderTotal, decision });
        if (decision.allowed) return;

        if (isBypassRole()) {
            logEvent({ customerId, orderTotal, decision, action: 'OVERRIDE' });
            return;
        }

        logEvent({ customerId, orderTotal, decision, action: 'BLOCKED' });
        notifyFinance({ customerName: c.companyname, orderTotal, decision });

        throw error.create({
            name: `CREDIT_${decision.code}`,
            message: `Order blocked by credit policy: ${decision.message} Contact Finance to release it.`,
            notifyOff: true
        });
    };

    return { beforeSubmit };
});
