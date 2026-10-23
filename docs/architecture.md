# USDC-to-BDT Payment Gateway — Architecture

## Overview

A production-grade merchant payment gateway where:
- Customers pay in **USDC on Arc Mainnet** (chain ID 5042)
- Merchants receive the equivalent in **Bangladeshi Taka (BDT)** via manual payout

## System Components

```
                         ┌─────────────────────┐
                         │   Customer Browser   │
                         │ (checkout page /pay) │
                         └──────────┬──────────┘
                                    │ USDC payment (wagmi + MetaMask)
                                    ▼
                         ┌─────────────────────┐
                         │ USDCPaymentGateway   │
                         │  (Solidity contract) │
                         │  Arc Mainnet 5042    │
                         └──────────┬──────────┘
                                    │ PaymentReceived event
                                    ▼
┌──────────────┐          ┌─────────────────────┐          ┌──────────────────────┐
│  Merchant    │◄────────►│   Express Backend    │◄────────►│  Supabase PostgreSQL │
│  Dashboard   │          │   (Port 3001)        │          │  (Database + Auth)   │
│  (React SPA) │          │   viem verifier      │          │                      │
└──────────────┘          └─────────────────────┘          └──────────────────────┘
                                    │
                                    ▼
                         ┌─────────────────────┐
                         │   Admin Dashboard   │
                         │  (Payout workflow)  │
                         └─────────────────────┘
```

## Payment Flow

1. **Invoice Creation**: Merchant creates invoice with BDT amount via dashboard.
2. **Rate Lock**: System reads current exchange rate (default 125 BDT/USDC) and calculates exact USDC units required using integer arithmetic. Rate is locked at invoice creation time.
3. **Customer Checkout**: Customer opens `/pay/:invoiceId`, sees BDT + USDC amounts.
4. **Authorization**: Customer clicks "Pay" → frontend calls `/api/public/invoices/:id/authorize`. Backend signs an `InvoiceAuthorization` struct with the operator's private key.
5. **On-chain Payment**: Customer approves USDC spending, then calls `payInvoice()` on the contract with the signed authorization. Contract verifies signature, marks nonce+invoice used, transfers USDC to treasury.
6. **Independent Verification**: Frontend submits tx_hash to `/api/payments/verify`. Backend:
   - Re-fetches receipt from Arc RPC independently
   - Verifies chain ID, contract address, USDC token address
   - Decodes `PaymentReceived` event log
   - Verifies invoice ID, merchant ID, amount
   - Checks block confirmations
7. **Ledger Credit**: After verification, backend atomically credits merchant's BDT ledger.
8. **Payout Request**: Merchant requests payout from dashboard. System checks balance.
9. **Manual Transfer**: Operator transfers BDT via bKash/Nagad/bank externally.
10. **Confirmation**: Admin confirms payout with external reference → ledger debited.

## Financial Integrity

### Integer Arithmetic Only
- BDT stored in **poisha** (1 BDT = 100 poisha), never floats
- USDC stored in **token units** (1 USDC = 1,000,000 units, 6 decimals)
- Rate stored as poisha-per-USDC: e.g., 12500 = 125 BDT/USDC
- Conversion uses BigInt ceiling division: `ceil(bdtPoisha × 1_000_000 / ratePoishaPer1Usdc)`
- This ensures customer always pays enough; overpay rounds up by at most 1 unit (≈ $0.000001)

### Immutable Ledger
- Ledger entries are append-only. No entry is ever deleted or updated.
- Corrections use new adjustment entries with audit trail.
- Running balance computed from sum of all entries (debit/credit).

### Payment Idempotency
- `tx_hash` has a UNIQUE constraint — same tx hash cannot be credited twice
- DB-level `UNIQUE INDEX idx_payments_invoice_confirmed ON payments(invoice_id) WHERE status='confirmed'`
- Contract-level: `usedNonces` and `paidInvoices` mappings prevent replay
- Race condition: backend checks for existing record by tx_hash before inserting

## Security Model

### Contract Security
- EIP-712 typed signature prevents signature replay across domains/chains
- Nonce: single-use random 32-byte value per payment authorization
- InvoiceId: single-payment lock at contract level
- Chain ID embedded in domain separator — signatures invalid on other chains
- All state updates before transfer (Checks-Effects-Interactions)
- SafeERC20 for transfer — handles non-standard ERC-20 return values

### Backend Security
- Never trusts client-submitted tx details — re-reads from RPC
- JWT authentication via Supabase for all protected routes
- Role-based access control: merchant / operator / admin
- Merchant cannot confirm their own payout
- Rate limiting (300 req/15min global, 30 req/15min for sensitive routes)
- CORS locked to configured origins
- Helmet security headers

### Database Security
- RLS enabled on all tables — merchants only see their own data
- Service role key never exposed to frontend
- Payout account numbers never returned to frontend in full (masked in merchant view)
- Audit log for all sensitive administrative actions
- Database constraints and atomic transactions

## Arc Mainnet Chain Facts
- Chain ID: 5042
- USDC address: `0x3600000000000000000000000000000000000000` (6 decimals)
- Native gas token: USDC (same asset, 18 decimals for gas)
- Explorer: https://explorer.arc.io
