/**
 * Guard against runaway agents: at most `max` write calls per server session (one Claude session).
 * It stops accidents, not people: a colleague can raise it with PLANFIX_MAX_WRITES (0 = no limit).
 */
export function maxWritesFromEnv(env = process.env): number {
  const raw = env.PLANFIX_MAX_WRITES;
  if (raw === undefined || raw === "") return 10;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 10;
}

export function createWriteLimiter(max: number) {
  let used = 0;
  return {
    /** Returns an error text when the limit is reached, otherwise counts the call and returns null. */
    take(): string | null {
      if (max === 0) return null;
      if (used >= max) {
        return (
          `Ліміт записів вичерпано: за одну сесію дозволено не більше ${max} змін у Planfix. ` +
          "Це схоже на масову дію. Нічого не змінено. Покажи користувачу, що саме залишилось зробити, " +
          "і попроси його підтвердити; щоб продовжити, треба перезапустити Claude (або адміністратор підніме PLANFIX_MAX_WRITES)."
        );
      }
      used += 1;
      return null;
    },
  };
}
