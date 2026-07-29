export const calculateActivity = (participated: number, eligible: number) => {
  if (eligible <= 0) return 100;
  return Math.max(0, Math.min(100, (participated / eligible) * 100));
};

export const decideBinaryResult = (first: number, second: number) =>
  first === second ? { status: 'TIE' as const, winner: null } : {
    status: 'OPTION_WIN' as const,
    winner: first > second ? 1 : 2,
  };

export const shouldPayReferral = (activity: number, minimum = 80) => activity >= minimum;

export class IdempotentLedger {
  balance = 0;
  readonly entries = new Map<string, number>();

  award(key: string, amount: number) {
    if (this.entries.has(key)) return false;
    this.entries.set(key, amount);
    this.balance += amount;
    return true;
  }
}

export class BinaryVoteBox {
  readonly votes = new Map<string, 1 | 2>();
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED' = 'ACTIVE';
  earlyCount = 0;

  cast(userId: string, option: 1 | 2, earlyLimit = 1000) {
    if (this.status !== 'ACTIVE') throw new Error('Voting is not open');
    if (this.votes.has(userId)) throw new Error('Duplicate vote');
    this.votes.set(userId, option);
    const earlyRank = this.earlyCount < earlyLimit ? ++this.earlyCount : null;
    return { earlyRank };
  }

  complete() {
    if (this.status === 'COMPLETED') return this.result();
    this.status = 'COMPLETED';
    return this.result();
  }

  result() {
    if (this.status !== 'COMPLETED') throw new Error('Results are private');
    const first = [...this.votes.values()].filter((value) => value === 1).length;
    const second = this.votes.size - first;
    return decideBinaryResult(first, second);
  }
}
