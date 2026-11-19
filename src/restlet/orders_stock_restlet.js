/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 * @NModuleScope SameAccount
 *
 * B2B e-commerce integration - Andes Hospitality Supply S.A. (fictional demo)
 *
 *   GET  ?sku=AMN-SHAMP-30ML&location=Buenos Aires   -> available stock
 *   GET  ?externalOrderId=WEB-100245                 -> order status
 *   POST { externalOrderId, customer:{email,name}, location, shippingMethod,
 *          items:[{sku, quantity}] }                 -> creates a Sales Order
 *
 * Design notes
 *  - Idempotent: the web store may retry. externalOrderId is stored in
 *    custbody_andes_ext_order_id and a repeated POST returns the existing order.
 *  - Every response has the same shape: { success, code, message?, data? } because
 *    RESTlets cannot set an HTTP status from here; clients read `code`.
 *  - Auth: Token-Based Authentication with an integration role limited to
 *    Sales Order (create), Customer (create/view) and Item (view).
 */
define(['N/query', 'N/record', 'N/log'], (query, record, log) => {

    const ok = (data, code = 'OK') => ({ success: true, code, data });
    const fail = (code, message, details) => ({ success: false, code, message, details });

    const sql = (q, params) => query.runSuiteQL({ query: q, params }).asMappedResults();

    const findLocationId = (name) => {
        const rows = sql('SELECT id FROM location WHERE name = ?', [name]);
        return rows.length ? Number(rows[0].id) : null;
    };

    const findOrderByExternalId = (externalId) => {
        const rows = sql(
            `SELECT t.id, t.tranid, BUILTIN.DF(t.status) AS status
             FROM transaction t
             WHERE t.type = 'SalesOrd' AND t.custbody_andes_ext_order_id = ?`, [externalId]);
        return rows.length ? rows[0] : null;
    };

    const findOrCreateCustomer = ({ email, name }) => {
        const rows = sql('SELECT id FROM customer WHERE LOWER(email) = LOWER(?)', [email]);
        if (rows.length) return Number(rows[0].id);

        const c = record.create({ type: record.Type.CUSTOMER, isPerson: false });
        c.setValue({ fieldId: 'companyname', value: name });
        c.setValue({ fieldId: 'email', value: email });
        c.setValue({ fieldId: 'custentity_andes_credit_tier', value: 'C' }); // new accounts start under review
        return c.save();
    };

    const resolveItems = (items, locationId) => {
        const skus = items.map(i => i.sku);
        const placeholders = skus.map(() => '?').join(',');
        const rows = sql(
            `SELECT i.id, i.itemid AS sku, NVL(l.quantityavailable, 0) AS available
             FROM item i
             LEFT JOIN inventoryitemlocations l ON l.item = i.id AND l.location = ?
             WHERE i.itemid IN (${placeholders})`, [locationId, ...skus]);
        const bySku = Object.fromEntries(rows.map(r => [r.sku, r]));

        const unknown = skus.filter(s => !bySku[s]);
        const short = items
            .filter(i => bySku[i.sku] && Number(bySku[i.sku].available) < i.quantity)
            .map(i => ({ sku: i.sku, requested: i.quantity, available: Number(bySku[i.sku].available) }));
        return { bySku, unknown, short };
    };

    const validate = (b) => {
        const errors = [];
        if (!b.externalOrderId) errors.push('externalOrderId is required');
        if (!b.customer || !b.customer.email || !b.customer.name) errors.push('customer.email and customer.name are required');
        if (!b.location) errors.push('location is required');
        if (!Array.isArray(b.items) || !b.items.length) errors.push('items[] is required');
        else b.items.forEach((i, n) => {
            if (!i.sku) errors.push(`items[${n}].sku is required`);
            if (!Number.isInteger(i.quantity) || i.quantity <= 0) errors.push(`items[${n}].quantity must be a positive integer`);
        });
        return errors;
    };

    const get = (params) => {
        if (params.externalOrderId) {
            const order = findOrderByExternalId(params.externalOrderId);
            return order ? ok(order) : fail('ORDER_NOT_FOUND', `No order for ${params.externalOrderId}`);
        }
        if (params.sku && params.location) {
            const locationId = findLocationId(params.location);
            if (!locationId) return fail('UNKNOWN_LOCATION', `Location not found: ${params.location}`);
            const { bySku, unknown } = resolveItems([{ sku: params.sku, quantity: 1 }], locationId);
            if (unknown.length) return fail('UNKNOWN_SKU', `SKU not found: ${params.sku}`);
            return ok({ sku: params.sku, location: params.location, available: Number(bySku[params.sku].available) });
        }
        return fail('VALIDATION_ERROR', 'Provide sku + location, or externalOrderId');
    };

    const post = (body) => {
        const errors = validate(body || {});
        if (errors.length) return fail('VALIDATION_ERROR', 'Invalid payload', errors);

        const existing = findOrderByExternalId(body.externalOrderId);
        if (existing) return ok(existing, 'DUPLICATE_ORDER'); // idempotent retry

        const locationId = findLocationId(body.location);
        if (!locationId) return fail('UNKNOWN_LOCATION', `Location not found: ${body.location}`);

        const { bySku, unknown, short } = resolveItems(body.items, locationId);
        if (unknown.length) return fail('UNKNOWN_SKU', 'Some SKUs do not exist', unknown);
        if (short.length) return fail('OUT_OF_STOCK', 'Insufficient stock', short);

        try {
            const so = record.create({ type: record.Type.SALES_ORDER, isDynamic: true });
            so.setValue({ fieldId: 'entity', value: findOrCreateCustomer(body.customer) });
            so.setValue({ fieldId: 'location', value: locationId });
            so.setValue({ fieldId: 'custbody_andes_ext_order_id', value: body.externalOrderId });
            if (body.shippingMethod) so.setText({ fieldId: 'shipmethod', text: body.shippingMethod });

            body.items.forEach(({ sku, quantity }) => {
                so.selectNewLine({ sublistId: 'item' });
                so.setCurrentSublistValue({ sublistId: 'item', fieldId: 'item', value: Number(bySku[sku].id) });
                so.setCurrentSublistValue({ sublistId: 'item', fieldId: 'quantity', value: quantity });
                so.setCurrentSublistValue({ sublistId: 'item', fieldId: 'location', value: locationId });
                so.commitLine({ sublistId: 'item' });
            });

            const id = so.save(); // credit guard (User Event) runs here and may reject the order
            return ok({ salesOrderId: id, externalOrderId: body.externalOrderId }, 'CREATED');
        } catch (e) {
            log.error({ title: `Order ${body.externalOrderId} failed`, details: e });
            const creditBlock = e.name && e.name.indexOf('CREDIT_') === 0;
            return fail(creditBlock ? 'CREDIT_BLOCKED' : 'ORDER_CREATE_FAILED', e.message);
        }
    };

    return { get, post };
});
