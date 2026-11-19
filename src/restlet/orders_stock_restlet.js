/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 *
 * E-commerce integration RESTlet (example).
 *  GET  ?sku=ABC            -> real-time available stock for an item (SuiteQL)
 *  POST { customerId, items:[{ sku, quantity }] } -> creates a Sales Order
 * Authenticate callers with Token-Based Authentication (TBA) using an
 * integration role that only has the permissions this script needs.
 */
define(['N/query', 'N/record', 'N/log'], (query, record, log) => {

    const findItemId = (sku) => {
        const rows = query.runSuiteQL({
            query: 'SELECT id FROM item WHERE itemid = ?',
            params: [sku]
        }).asMappedResults();
        return rows.length ? rows[0].id : null;
    };

    const get = (params) => {
        if (!params.sku) return { success: false, message: 'sku is required' };

        const rows = query.runSuiteQL({
            query: `
                SELECT i.itemid AS sku, SUM(l.quantityavailable) AS available
                FROM item i
                JOIN inventoryitemlocations l ON l.item = i.id
                WHERE i.itemid = ?
                GROUP BY i.itemid`,
            params: [params.sku]
        }).asMappedResults();

        if (!rows.length) return { success: false, message: `SKU ${params.sku} not found` };
        return { success: true, sku: rows[0].sku, available: Number(rows[0].available) || 0 };
    };

    const post = (body) => {
        if (!body.customerId || !Array.isArray(body.items) || !body.items.length) {
            return { success: false, message: 'customerId and items[] are required' };
        }
        try {
            const so = record.create({ type: record.Type.SALES_ORDER, isDynamic: true });
            so.setValue({ fieldId: 'entity', value: body.customerId });

            body.items.forEach(({ sku, quantity }) => {
                const itemId = findItemId(sku);
                if (!itemId) throw new Error(`SKU not found: ${sku}`);
                so.selectNewLine({ sublistId: 'item' });
                so.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: itemId });
                so.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: quantity });
                so.commitLine({ sublistId: 'item' });
            });

            const id = so.save();
            return { success: true, salesOrderId: id };
        } catch (e) {
            log.error('Order creation failed', e);
            return { success: false, message: e.message };
        }
    };

    return { get, post };
});
