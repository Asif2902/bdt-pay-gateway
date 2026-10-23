# Manual BDT Payout Guide

## Overview

In this version, BDT payouts are **manual** — no external payment API is integrated. The system tracks liability; actual transfers happen outside the application via bKash, Nagad, or bank transfer.

## Workflow

### Step 1: Merchant Requests Payout

1. Merchant logs into dashboard.
2. Sees available BDT balance (sum of verified USDC payments, converted to BDT at locked rates, minus previous payouts).
3. Clicks "Request Payout" and enters the withdrawal amount.
4. System validates: balance sufficient, no other payout pending, payout details configured.
5. A payout record is created with status `pending`.

### Step 2: Operator Initiates Transfer

1. Admin/operator logs into admin dashboard → Pending Payouts tab.
2. Sees the payout with full account details (bKash/Nagad number or bank account).
3. Manually opens bKash, Nagad, or banking app outside this system.
4. Transfers the BDT amount to the merchant's account.
5. Back in the dashboard, clicks "Mark Processing" (optional but recommended for tracking).

### Step 3: Admin Records and Confirms

1. After the actual transfer is completed, admin clicks "Confirm Transfer".
2. Enters the **external transaction reference** (bKash TrxID, Nagad reference, bank transaction ID).
3. Optionally adds a note.
4. Submits.
5. System atomically:
   - Debits the merchant's BDT ledger
   - Marks payout as `completed`
   - Records the external reference and timestamp
   - Creates audit log entry

### Step 4: Merchant Sees Completion

Merchant's dashboard shows the payout as `completed` with the confirmation timestamp.

## Important Rules

- **A merchant CANNOT confirm their own payout** (enforced server-side via role check).
- **Only the `admin` role can confirm** (not `operator` — this prevents self-authorization).
- **Duplicate confirmations are blocked** (payout status must be `pending` or `processing`).
- **A payout cannot be confirmed if the ledger balance is insufficient** (double-checked at confirmation time).
- **Corrections**: If a wrong amount was paid, create an adjustment entry via the admin ledger adjustment tool (not yet implemented in v1 — do manually in SQL with audit log entry).

## Data Never Collected

- bKash/Nagad PINs or passwords
- Bank login credentials
- Any OTPs

Only account numbers and names are stored for routing purposes.

## Future Automation

The system is designed for future automated payout integration. To add a provider:

1. Implement the `PayoutProvider` interface (to be added in `server/lib/payoutProvider.ts`).
2. Add a webhook endpoint for transfer confirmation callbacks.
3. Update the `confirmPayout` flow to accept provider-confirmed transfers.
4. Write integration tests against the sandbox environment.

**Do NOT claim an integration is live or automated until it has been tested in production.**

## Reconciliation

To verify ledger consistency:

```sql
-- Check that each merchant's balance equals sum of credits minus debits
SELECT
  m.shop_name,
  m.id,
  get_merchant_balance(m.id) AS computed_balance,
  SUM(CASE ml.entry_type WHEN 'credit' THEN ml.amount_poisha ELSE -ml.amount_poisha END) AS sum_balance
FROM merchants m
JOIN merchant_ledger ml ON ml.merchant_id = m.id
GROUP BY m.id, m.shop_name;
-- computed_balance and sum_balance should always match
```
