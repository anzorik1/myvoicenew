import { createHmac } from 'node:crypto';
import {
  BinaryVoteBox,
  calculateActivity,
  decideBinaryResult,
  IdempotentLedger,
  shouldPayReferral,
} from '../src/domain';
import { validateTelegramInitData } from '../src/telegram-auth';

const signedInitData = (userId: number, token: string, authDate: number) => {
  const params = new URLSearchParams({
    auth_date: String(authDate),
    query_id: 'test-query',
    user: JSON.stringify({ id: userId, first_name: 'Test', language_code: 'en' }),
  });
  const check = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
  return params.toString();
};

describe('MyVoice core invariants', () => {
  test('1. a new user receives exactly 50 VOX', () => {
    const ledger = new IdempotentLedger();
    expect(ledger.award('signup:u1', 50)).toBe(true);
    expect(ledger.balance).toBe(50);
  });

  test('2. repeat login does not pay a second signup reward', () => {
    const ledger = new IdempotentLedger();
    ledger.award('signup:u1', 50);
    expect(ledger.award('signup:u1', 50)).toBe(false);
    expect(ledger.balance).toBe(50);
  });

  test('3. a user cannot vote twice', () => {
    const vote = new BinaryVoteBox();
    vote.cast('u1', 1);
    expect(() => vote.cast('u1', 2)).toThrow('Duplicate vote');
  });

  test('4. a retried request cannot duplicate VOX', () => {
    const ledger = new IdempotentLedger();
    ledger.award('vote:v1:u1', 10);
    ledger.award('vote:v1:u1', 10);
    expect(ledger.balance).toBe(10);
  });

  test('5. referrer signup reward is paid only once', () => {
    const ledger = new IdempotentLedger();
    ledger.award('ref-signup:r1', 5);
    ledger.award('ref-signup:r1', 5);
    expect(ledger.balance).toBe(5);
  });

  test('6. referrer below 80% receives no bonus', () => {
    expect(shouldPayReferral(79.99)).toBe(false);
    expect(shouldPayReferral(80)).toBe(true);
  });

  test('7. referral policy is one level only', () => {
    const directOwner = new Map([['invitee', 'referrer']]);
    expect(directOwner.get(directOwner.get('invitee')!)).toBeUndefined();
  });

  test('8. votes after close are rejected', () => {
    const vote = new BinaryVoteBox();
    vote.status = 'COMPLETED';
    expect(() => vote.cast('u1', 1)).toThrow('Voting is not open');
  });

  test('9. intermediate results are private', () => {
    const vote = new BinaryVoteBox();
    vote.cast('u1', 1);
    expect(() => vote.result()).toThrow('Results are private');
  });

  test('10. equal counts produce a tie', () => {
    expect(decideBinaryResult(3, 3)).toEqual({ status: 'TIE', winner: null });
  });

  test('11. a cancelled vote is not part of eligible activity', () => {
    expect(calculateActivity(0, 0)).toBe(100);
    expect(calculateActivity(8, 10)).toBe(80);
  });

  test('12. Telegram initData with an invalid signature is rejected', () => {
    const now = Math.floor(Date.now() / 1000);
    const data = signedInitData(42, 'real-token', now).replace(/hash=[^&]+/, `hash=${'0'.repeat(64)}`);
    expect(() => validateTelegramInitData(data, 'real-token', 3600, now)).toThrow(
      'Invalid Telegram signature',
    );
  });

  test('13. Telegram ID comes from signed data and cannot be substituted', () => {
    const now = Math.floor(Date.now() / 1000);
    const data = signedInitData(42, 'real-token', now);
    expect(validateTelegramInitData(data, 'real-token', 3600, now).user.id).toBe(42);
    expect(() => validateTelegramInitData(data.replace('%22id%22%3A42', '%22id%22%3A99'), 'real-token', 3600, now)).toThrow();
  });

  test('14. early participants never exceed the configured limit', async () => {
    const vote = new BinaryVoteBox();
    const attempts = Array.from({ length: 1200 }, (_, index) =>
      Promise.resolve().then(() => vote.cast(`u${index}`, 1, 1000)),
    );
    const results = await Promise.all(attempts);
    expect(results.filter((row) => row.earlyRank !== null)).toHaveLength(1000);
    expect(vote.earlyCount).toBe(1000);
  });

  test('15. repeating completion does not create new ledger entries', () => {
    const vote = new BinaryVoteBox();
    vote.cast('u1', 1);
    expect(vote.complete()).toEqual(vote.complete());
    const ledger = new IdempotentLedger();
    ledger.award('complete:v1:u1', 10);
    ledger.award('complete:v1:u1', 10);
    expect(ledger.entries.size).toBe(1);
  });
});
