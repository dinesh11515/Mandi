export const TINYBAR_PER_HBAR = 100_000_000n;

export function parseHbar(amount: string): number {
  const match = /^(\d+(?:\.\d+)?) HBAR$/.exec(amount);
  if (!match) throw new Error(`invalid HBAR amount: ${amount}`);
  return Number(match[1]);
}

export function formatHbar(hbar: number): string {
  if (!Number.isFinite(hbar)) throw new Error(`invalid HBAR amount: ${hbar}`);
  const fixed = hbar.toFixed(8).replace(/0+$/, "").replace(/\.$/, "");
  return `${fixed} HBAR`;
}

export function toTinybar(hbar: number): bigint {
  return BigInt(Math.round(hbar * Number(TINYBAR_PER_HBAR)));
}

export function fromTinybar(tinybar: bigint | string | number): number {
  return Number(BigInt(tinybar)) / Number(TINYBAR_PER_HBAR);
}
