# BDT Pay Gateway

A merchant payment gateway where customers pay in USDC on Arc Mainnet and merchants receive the equivalent in Bangladeshi Taka (BDT) via manual bank/mobile-money payout.

Built with [Arc Studio](https://studio.arc.io)

## Tech Stack

- **Frontend**: React 18, TypeScript, Vite, wagmi v2, ConnectKit, Tailwind CSS
- **Backend**: Express, TypeScript, Bun, viem
- **Database**: Supabase (PostgreSQL with Row Level Security)
- **Auth**: Supabase Auth
- **Blockchain**: Arc Mainnet (chain ID 5042), USDC ERC-20
- **Smart Contract**: Solidity 0.8.28, EIP-712 signatures, Foundry tests

## Features

- Merchants sign up, create USDC invoices, and track BDT earnings
- Customers pay invoices with a wallet (MetaMask or WalletConnect) on Arc Mainnet
- Backend independently verifies payments from the blockchain (does not trust client data)
- BDT ledger tracks credits per payment and debits per payout
- Admin dashboard manages merchants and processes manual BDT payouts
- All financial arithmetic uses integers (poisha/USDC units); no floating point

## Development

### Prerequisites

- Bun (https://bun.sh)
- Foundry (https://getfoundry.sh)
- A Supabase project
- Node.js 18+ (for the Circle CLI — not needed for the app itself)

### Install

```bash
bun install
```

### Environment Variables

Copy `.env.example` to `.env` and fill in your values.

| Variable | Purpose | Required |
|---|---|---|
| `VITE_SUPABASE_URL` | Supabase project URL | Yes |
| `VITE_SUPABASE_ANON_KEY` | Supabase public anon key | Yes |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (backend only) | Yes |
| `VITE_GATEWAY_CONTRACT_ADDRESS` | Deployed USDCPaymentGateway address | Yes (after deploy) |
| `OPERATOR_SIGNER_PRIVATE_KEY` | Private key for signing invoice authorizations | Yes |
| `ARC_MAINNET_RPC_URL` | Arc Mainnet RPC URL (fallback outside Arc Studio) | No |
| `RPC_PROXY_BASE_URL` | Arc Studio RPC proxy base URL | No (auto in Arc Studio) |
| `RPC_PROXY_TOKEN` | Arc Studio RPC proxy token | No (auto in Arc Studio) |
| `RPC_PROXY_CHAINS` | Arc Studio RPC proxy supported chains | No (auto in Arc Studio) |
| `PORT` | Backend server port (default 3001) | No |
| `CORS_ORIGINS` | Allowed frontend origins (comma-separated) | No |
| `REQUIRED_CONFIRMATIONS` | Block confirmations before crediting payment | No |
| `VITE_WALLETCONNECT_PROJECT_ID` | WalletConnect project ID (optional) | No |

### Database Setup

Run Supabase migrations in order using the Supabase CLI or the SQL editor:

```bash
# With Supabase CLI
supabase link --project-ref your-project-ref
supabase db push

# Or manually: run supabase/migrations/ files 001, 002, 003 in order
```

### Run

Start both frontend and backend:

```bash
# Frontend (Vite, port 5173)
bun run dev

# Backend (Express, port 3001) — in a separate terminal
bun run server
```

### Build

```bash
bun run build
```

### Test (backend)

```bash
bun test server/tests/
```

### Test (smart contract)

```bash
forge test
```

### Lint and Typecheck

```bash
bun run check
```

## Smart Contract

The `USDCPaymentGateway` contract accepts USDC payments authorized by an EIP-712 signature from the operator. It lives at `contracts/USDCPaymentGateway.sol`.

Deploy it with:

```bash
forge build
forge create contracts/USDCPaymentGateway.sol:USDCPaymentGateway \
  --rpc-url $ARC_MAINNET_RPC_URL \
  --private-key $DEPLOYER_PRIVATE_KEY \
  --constructor-args $USDC_ADDRESS $TREASURY_ADDRESS $OPERATOR_SIGNER_ADDRESS
```

Then set `VITE_GATEWAY_CONTRACT_ADDRESS` in `.env` to the deployed address.

See `docs/deployment-guide.md` for the full deployment guide.

## Docs

- `docs/architecture.md` — system overview and payment flow
- `docs/deployment-guide.md` — step-by-step production deployment
- `docs/security-review.md` — known risks and pre-production checklist
- `docs/payout-guide.md` — manual BDT payout workflow for operators
