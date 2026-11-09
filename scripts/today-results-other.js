/** Unlisted accounts belong to その他; refuse inconsistent or incomplete totals. */
export function accountStatsForTarget(target, targets, accounts) {
  if (!target.isOther) return accounts.get(target.accountId);
  if (targets.filter(t=>t.isOther).length !== 1) throw new Error('「その他」行が重複しています。');
  const all=accounts.get('全体');
  if (!all) throw new Error('「その他」計算用の全体実績がありません。');
  const people=targets.filter(t=>!t.isOther);
  if (new Set(people.map(t=>t.accountId)).size!==people.length) throw new Error('担当者IDの重複により「その他」を計算できません。');
  const keys=['interaction','individual','broadcast',...(target.hasReceiveColumn?['interactionReceive']:[]),...(target.hasDetailedReceiveColumns?['individualReceive','broadcastReceive']:[])];
  const result={};
  for (const key of keys) {
    let remainder=all[key];
    if (!Number.isSafeInteger(remainder)||remainder<0) throw new Error(`全体実績 ${key} が不正です。`);
    for (const person of people) {
      const value=accounts.get(person.accountId)?.[key];
      if (!Number.isSafeInteger(value)||value<0) throw new Error(`${person.name} の ${key} が不足しており「その他」を計算できません。`);
      remainder-=value;
    }
    if (remainder<0) throw new Error(`担当者合計が全体の ${key} を超えています。`);
    result[key]=remainder;
  }
  return result;
}
