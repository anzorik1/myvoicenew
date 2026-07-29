# MyVoice architecture decisions

MyVoice is a modular monolith. `apps/api` owns the REST API and business rules,
`apps/api/src/worker.ts` runs BullMQ jobs, `apps/web` contains both the Telegram
Mini App and the separately authenticated admin area, and `apps/bot` is a thin
grammY client. PostgreSQL is the source of truth; Redis never owns balances,
votes, referrals, or results.

## Invariants

- Telegram identity is accepted only after HMAC validation of `initData` and an
  `auth_date` freshness check.
- VOX is an integer. Every balance mutation and its immutable ledger row are
  committed in one PostgreSQL transaction after locking the user row.
- `(user_id, vote_id)`, referral ownership, session token hashes, and every
  reward idempotency key are database-unique.
- A result is calculated from persisted `user_votes`, never from cache.
- Vote completion is idempotent. A delayed BullMQ job is backed by a periodic
  PostgreSQL reconciliation scan so Redis outages do not strand expired votes.
- Activity counts only completed, non-cancelled votes whose start time is after
  the user's completed registration.
- Referral ownership is set at first account creation and is one-level only.
- Future reward modes are gated by server-side flags plus configurable account
  thresholds. Disabled modes do not affect MVP accounting.

## Main risks and controls

| Risk | Control |
| --- | --- |
| Concurrent casts | serializable transaction + unique vote constraint |
| Duplicate reward/retried job | unique ledger idempotency key |
| Lost completion job | BullMQ retries + database reconciliation |
| Intermediate-result leak | public DTOs omit counts until `COMPLETED` |
| Balance/ledger drift | locked balance mutation in the same transaction |
| Forged Telegram ID | ID is read only from verified signed `initData` |
| Referral abuse | immutable single owner, self-check, bonus after consent |
| Early-voter overflow | vote row lock and bounded counter |

## Scope decisions

The first release has no blockchain, wallet connection, conversion, or money
semantics. The `TON_WALLET` feature remains a false public capability. Admin
authentication uses a separate credential realm and short-lived JWT. Access
tokens are kept in application memory; refresh credentials use an HttpOnly
cookie.
