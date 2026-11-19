# SuiteScript 2.1 examples

Small, self-contained **sample scripts** that show common NetSuite development patterns.
They are generic examples written for this portfolio (no client code or data).

| Script | Type | What it shows |
|---|---|---|
| `src/user-event/credit_limit_guard_ue.js` | User Event | Blocks Sales Orders over the customer's credit limit; role bypass via script parameter |
| `src/map-reduce/collections_reminders_mr.js` | Map/Reduce | SuiteQL + grouping to send one reminder email per customer for overdue invoices |
| `src/restlet/orders_stock_restlet.js` | RESTlet | GET real-time stock (SuiteQL) and POST to create Sales Orders; meant for TBA auth |

## Notes
- SuiteScript 2.1, `N/query` (SuiteQL), `N/record`, `N/search`, `N/email`, `N/runtime`.
- Script parameters: `custscript_cl_bypass_roles`, `custscript_cr_author`.
- Deploy with SDF or the File Cabinet in a **Sandbox** first; field IDs and statuses may need adjusting per account.
