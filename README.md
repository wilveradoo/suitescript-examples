# SuiteScript 2.1 examples

Three SuiteScript 2.1 scripts that solve a realistic order-to-cash scenario for a
**fictional** company, *Andes Hospitality Supply S.A.*, a B2B distributor of amenities and
linens for hotels. All company, customer, SKU and invoice names are invented for this demo;
there is no client code or data in this repository.

| Script | Type | What it does |
|---|---|---|
| [`credit_limit_guard_ue.js`](src/user-event/credit_limit_guard_ue.js) | User Event | Credit policy on Sales Orders: limit with tier tolerance (A/B/C), overdue rule, manual hold. Blocks and notifies Finance; role overrides are allowed and **audited** in a custom record. |
| [`collections_reminders_mr.js`](src/map-reduce/collections_reminders_mr.js) | Map/Reduce | Dunning: SuiteQL finds overdue invoices (skips disputed ones and paused customers), one email per customer with an aging table, tone by bucket (1-30 / 31-60 / 61+ days), account manager in copy for 61+, log record and Finance summary. |
| [`orders_stock_restlet.js`](src/restlet/orders_stock_restlet.js) | RESTlet | B2B web-store integration: stock by location, order status, and **idempotent** order creation (finds or creates the customer, validates SKUs and stock, uniform error codes). |

Business rules live in `src/lib` as pure functions (`credit_rules.js`, `aging.js`), so they can be tested without NetSuite:

```bash
npm test      # Node 18+, no dependencies
```

## Structure
```
src/user-event/    credit guard
src/map-reduce/    collections reminders
src/restlet/       orders + stock API
src/lib/           pure business rules (unit-tested)
tests/             node:test suites
docs/              sample payloads for the RESTlet
```

## Custom objects the scripts expect (fictional demo account)
- Customer fields: `custentity_andes_credit_tier` (A/B/C), `custentity_andes_credit_hold`, `custentity_andes_dunning_paused`
- Transaction body fields: `custbody_andes_disputed`, `custbody_andes_ext_order_id`
- Custom records: `customrecord_andes_credit_event`, `customrecord_andes_dunning_log`
- Script parameters are described at the top of each file.

Deploy to a Sandbox first; field IDs and statuses depend on the account.
