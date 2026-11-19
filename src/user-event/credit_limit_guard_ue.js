/**
 * @NApiVersion 2.1
 * @NScriptType UserEventScript
 * @NModuleScope SameAccount
 *
 * Credit limit guard (example).
 * Blocks a Sales Order when the customer's balance + the new order total
 * exceeds the customer's credit limit. Roles listed in the script parameter
 * custscript_cl_bypass_roles (comma separated internal IDs) can bypass the check.
 */
define(['N/search', 'N/runtime', 'N/error', 'N/log'], (search, runtime, error, log) => {

    const isBypassRole = () => {
        const raw = runtime.getCurrentScript().getParameter({ name: 'custscript_cl_bypass_roles' }) || '';
        const roles = raw.split(',').map(r => r.trim()).filter(Boolean);
        return roles.includes(String(runtime.getCurrentUser().role));
    };

    const beforeSubmit = (context) => {
        const { newRecord, type, UserEventType } = context;
        if (type !== UserEventType.CREATE && type !== UserEventType.EDIT) return;
        if (runtime.executionContext === runtime.ContextType.CSV_IMPORT) return;
        if (isBypassRole()) return;

        const customerId = newRecord.getValue({ fieldId: 'entity' });
        if (!customerId) return;

        const customer = search.lookupFields({
            type: search.Type.CUSTOMER,
            id: customerId,
            columns: ['creditlimit', 'balance']
        });

        const creditLimit = parseFloat(customer.creditlimit) || 0;
        if (!creditLimit) return; // no limit configured

        const balance = parseFloat(customer.balance) || 0;
        const orderTotal = parseFloat(newRecord.getValue({ fieldId: 'total' })) || 0;
        const exposure = balance + orderTotal;

        log.debug('Credit check', { customerId, creditLimit, balance, orderTotal });

        if (exposure > creditLimit) {
            throw error.create({
                name: 'CREDIT_LIMIT_EXCEEDED',
                message: `Order blocked: exposure ${exposure.toFixed(2)} exceeds credit limit ${creditLimit.toFixed(2)}.`,
                notifyOff: true
            });
        }
    };

    return { beforeSubmit };
});
