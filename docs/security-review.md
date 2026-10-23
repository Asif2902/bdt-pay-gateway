# Security Review

> **Disclaimer**: This review was conducted automatically as part of the build process, not by a professional third-party security firm. It does NOT constitute a formal audit or security guarantee. Before deploying to mainnet with real funds, obtain an independent professional audit.

## Smart Contract: USDCPaymentGateway.sol

### Findings

#### Resolved (Fixed)

| Issue | Resolution |
|---|---|
| `onlyOwner` emitted `InvalidSignature` for access-control failures | Fixed: now emits `Unauthorized()` |
| No event on ownership transfer | Fixed: `OwnershipTransferred` event added |

#### Known Limitations / Risks

| Severity | Issue | Notes |
|---|---|---|
| Medium | No emergency pause mechanism | If the operator signer key is compromised, unauthorized payments could be authorized until `setOperatorSigner` is called. Consider adding an `isPaused` guard. |
| Medium | No upper bound on USDC amount in authorization | A compromised operator signer could authorize very large payments. Mitigated by: separate treasury wallet, backend validates amount matches invoice. |
| Low | Operator signer key rotation requires downtime | Rotating the key leaves a window where old/new key may conflict. Use a key-rotation ceremony with a brief pause. |
| Low | TREASURY is a mutable address (not immutable) | If the treasury address is updated by the owner, future payments go to the new address. This is intentional flexibility but should be monitored. |
| Info | Chain ID validation only in domain separator | If Arc ever hard-forks and reuses chain ID 5042, old signatures could theoretically replay. Very unlikely but noted. |
| Info | No contract version / migration path | Upgrading the contract requires re-deploying and re-configuring all systems. |

### Test Coverage

- 48/48 unit tests pass
- Fuzz tests (5 × 256 runs) pass
- Coverage: happy path, expired auth, duplicate invoice, nonce replay, invalid signature, wrong length signature, insufficient balance, access control (all admin functions)
- NOT covered: live Arc Mainnet chain ID validation (requires fork test — chain ID 5042 differs from forge's default 31337)

## Backend API

### Risks

| Severity | Issue | Notes |
|---|---|---|
| High | `OPERATOR_SIGNER_PRIVATE_KEY` must be kept secret | If leaked, attacker can authorize payments without a real invoice. Use a secrets manager in production. |
| Medium | RPC outages cause payment verification delays | If Arc RPC is unavailable, `verify()` will fail. Payments are not lost — they are recorded on-chain — but the merchant won't be credited until the RPC recovers. Implement a retry queue. |
| Medium | No webhook/event listener for missed payments | Currently, payment verification is triggered by the customer submitting tx_hash. If the customer closes their browser, the merchant won't be credited automatically. Implement an event listener for `PaymentReceived` events. |
| Low | Rate limiting is in-memory (single instance) | In a multi-instance deployment, rate limits are per-instance. Use Redis for distributed rate limiting. |
| Low | Supabase service role key in memory | Ensure environment variables are not logged. |

## Database / Supabase

| Severity | Issue | Notes |
|---|---|---|
| Medium | Payout account numbers stored in plaintext | In production, use Supabase Vault (pgsodium) to encrypt sensitive payout fields at rest. |
| Low | RLS policies are complex — test all paths | Test with a Supabase client using the anon key (not service role) to verify RLS works as intended. |
| Low | No rate limiting at Supabase level | Apply Supabase rate limits in the dashboard for additional protection. |

## Remaining Items Before Production

1. **Obtain independent security audit** from a qualified firm.
2. **Implement payment event listener** to credit merchants whose customers closed the browser.
3. **Set up key management** for `OPERATOR_SIGNER_PRIVATE_KEY` (AWS KMS, HashiCorp Vault, etc.).
4. **Encrypt payout details** using Supabase Vault.
5. **Add contract pause mechanism** for emergency stops.
6. **Implement retry queue** for RPC failures.
7. **Run integration tests on Arc Testnet** before mainnet.
8. **Conduct reconciliation testing** — verify ledger balance = sum(credits) - sum(debits) always.
9. **Set up monitoring** for failed payment verifications.
10. **Configure Supabase backups** and point-in-time recovery.
