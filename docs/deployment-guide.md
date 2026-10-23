# Deployment Guide

> **STOP**: Do not proceed to production deployment without:
> 1. Completing a full independent security audit of the smart contract.
> 2. Running integration tests on testnet.
> 3. Reviewing all configured wallet addresses, contract addresses, and chain IDs.

## Prerequisites

- Node.js 18+, Bun, Foundry (`curl -L https://foundry.paradigm.xyz | bash`)
- A Supabase project
- A funded Arc Mainnet wallet (USDC for gas)

## 1. Clone and Install

```bash
git clone <repo>
cd <repo>
bun install
```

## 2. Environment Setup

```bash
cp .env.example .env
```

Fill in all values in `.env`:
- `VITE_SUPABASE_URL` — from Supabase dashboard
- `VITE_SUPABASE_ANON_KEY` — from Supabase dashboard
- `SUPABASE_SERVICE_ROLE_KEY` — from Supabase dashboard (never expose to frontend)
- `OPERATOR_SIGNER_PRIVATE_KEY` — generate: `openssl rand -hex 32`

## 3. Supabase Database Setup

Run migrations in order:

```bash
# Using Supabase CLI (install: npm install -g supabase)
supabase link --project-ref your-project-ref
supabase db push

# Or run manually in Supabase SQL editor:
# 1. supabase/migrations/001_initial_schema.sql
# 2. supabase/migrations/002_rls_policies.sql
# 3. supabase/migrations/003_indexes_and_constraints.sql
```

### Create Admin User

After running migrations, promote a user to admin in the Supabase SQL editor:

```sql
UPDATE profiles SET role = 'admin' WHERE email = 'your-admin@example.com';
```

## 4. Smart Contract Deployment

> **Important**: Do not deploy the contract without reading the security considerations in `docs/security-review.md`.

```bash
# Build the contract
forge build

# Deploy to Arc Mainnet (requires deployer wallet with USDC for gas)
# Replace TREASURY_ADDRESS with the wallet that will receive USDC payments
# Replace OPERATOR_SIGNER_ADDRESS with the public address matching OPERATOR_SIGNER_PRIVATE_KEY

forge create contracts/USDCPaymentGateway.sol:USDCPaymentGateway \
  --rpc-url https://rpc.mainnet.arc.io \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --constructor-args \
    0x3600000000000000000000000000000000000000 \
    $TREASURY_ADDRESS \
    $OPERATOR_SIGNER_ADDRESS
```

After deployment, add the contract address to `.env`:

```bash
printf 'VITE_GATEWAY_CONTRACT_ADDRESS=0x_YOUR_CONTRACT_ADDRESS\n' >> .env
```

Update `AGENTS.md` with the deployed contract address.

## 5. Run in Development

```bash
# Terminal 1: Frontend (Vite)
bun run dev

# Terminal 2: Backend
bun run server
```

## 6. Production Deployment

### Backend (Express)

Deploy the Express server to any Node-compatible platform (Railway, Render, Fly.io, etc.). Set all environment variables from `.env`.

The server does NOT need a public-facing port — it runs behind a reverse proxy or as a serverless function.

Ensure `CORS_ORIGINS` includes your production frontend domain.

### Frontend (Vite)

```bash
bun run build
# Deploy dist/ to Netlify, Vercel, or Hugging Face Spaces
```

Set all `VITE_*` environment variables in the hosting platform's dashboard.

## 7. Post-Deployment Verification

1. Create a test merchant account and invoice.
2. Open the checkout page on a mobile device.
3. Connect a wallet with a small USDC balance on Arc Mainnet.
4. Complete a test payment.
5. Verify the payment appears in the merchant dashboard.
6. Verify the BDT credit in the ledger.
7. Test the admin payout workflow end-to-end.

## 8. Payout Provider Integration

The current version uses manual BDT payouts. For automated payouts, implement the interface in `server/lib/payoutProvider.ts` (not yet created — see architecture docs). Supported future providers: bKash API, Nagad API, bank RTGS. Do not claim an integration is live until it is verified in production.
