/** Exact unbounded integer covering, with a finite bound and deterministic ties. */
export const LIMITS = Object.freeze({ participants: 500, items: 5, packs: 6, perPerson: 20, stock: 10000, quantity: 1000, price: 1000000, bytes: 65536 });
const fail = message => { throw new Error(message); };
function keys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(`${label}: オブジェクトが必要です`);
  const actual = Object.keys(value);
  if (actual.length !== expected.length || actual.some(k => !expected.includes(k))) fail(`${label}: 未知の項目または不足している項目があります`);
}
function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}: ${min}〜${max}の整数で入力してください`);
  return value;
}
function string(value, max, label, id = false) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value) || (id && !/^[a-zA-Z0-9_-]+$/.test(value))) fail(`${label}: 文字列の形式が正しくありません`);
  return value.trim();
}
export function validateProject(input) {
  keys(input, ['version', 'title', 'participants', 'items'], '計画');
  if (input.version !== 1) fail('対応していないファイル形式です');
  const title = string(input.title, 80, '計画名');
  const participants = integer(input.participants, 0, LIMITS.participants, '参加人数');
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > LIMITS.items) fail('品目数は1〜5です');
  const ids = new Set();
  const items = input.items.map((item, index) => {
    const label = `品目${index + 1}`;
    keys(item, ['id', 'name', 'unit', 'perPerson', 'stock', 'packs'], label);
    const id = string(item.id, 40, `${label} ID`, true);
    if (ids.has(id)) fail('品目IDが重複しています'); ids.add(id);
    if (!Array.isArray(item.packs) || item.packs.length < 1 || item.packs.length > LIMITS.packs) fail(`${label}: パック候補数は1〜6です`);
    const pids = new Set();
    const packs = item.packs.map((p, i) => {
      keys(p, ['id', 'label', 'quantity', 'price'], `${label} パック${i + 1}`);
      const pid = string(p.id, 40, 'パックID', true);
      if (pids.has(pid)) fail('パックIDが重複しています'); pids.add(pid);
      return {id: pid, label: string(p.label, 60, 'パック名'), quantity: integer(p.quantity, 1, LIMITS.quantity, 'パック入数'), price: integer(p.price, 1, LIMITS.price, '税込価格')};
    });
    return {id, name: string(item.name, 60, '品目名'), unit: string(item.unit, 8, '単位'), perPerson: integer(item.perPerson, 1, LIMITS.perPerson, '1人あたり'), stock: integer(item.stock, 0, LIMITS.stock, '手持ち在庫'), packs};
  });
  return {version: 1, title, participants, items};
}
export function parseProject(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > LIMITS.bytes) fail('JSONは64 KiB以下にしてください');
  let value;
  try { value = JSON.parse(text); } catch { fail('JSONの書式が正しくありません'); }
  // Iterative scan prevents recursive traversal of hostile deeply nested input.
  const stack = [{value, depth: 0}];
  while (stack.length) {
    const entry = stack.pop();
    if (entry.depth > 8) fail('JSONの階層が深すぎます');
    if (entry.value && typeof entry.value === 'object') {
      for (const key of Object.keys(entry.value)) {
        if (['__proto__', 'prototype', 'constructor'].includes(key)) fail('安全でないJSONキーです');
        stack.push({value: entry.value[key], depth: entry.depth + 1});
      }
    }
  }
  return validateProject(value);
}
function checkedItem(item, participants) {
  return validateProject({version: 1, title: '計算', participants, items: [item]}).items[0];
}
function buildTable(packs, maxNeed) {
  const k = packs.length;
  // Positive price: a cover at least maxNeed + largestPack cannot be optimal,
  // because removing any pack still covers maxNeed and strictly lowers cost.
  const limit = Math.max(0, maxNeed) + Math.max(...packs.map(p => p.quantity)) - 1;
  const costs = new Float64Array(limit + 1).fill(Infinity);
  const packCounts = new Uint16Array(limit + 1);
  const vectors = new Uint16Array((limit + 1) * k);
  costs[0] = 0;
  for (let q = 1; q <= limit; q++) {
    for (let p = 0; p < k; p++) {
      const prev = q - packs[p].quantity;
      if (prev < 0 || !Number.isFinite(costs[prev])) continue;
      const cost = costs[prev] + packs[p].price;
      const count = packCounts[prev] + 1;
      let better = cost < costs[q] || (cost === costs[q] && count < packCounts[q]);
      if (cost === costs[q] && count === packCounts[q]) {
        for (let j = 0; j < k; j++) {
          const candidate = vectors[prev * k + j] + (j === p ? 1 : 0);
          const current = vectors[q * k + j];
          if (candidate !== current) { better = candidate > current; break; }
        }
      }
      if (better) {
        costs[q] = cost; packCounts[q] = count;
        for (let j = 0; j < k; j++) vectors[q * k + j] = vectors[prev * k + j] + (j === p ? 1 : 0);
      }
    }
  }
  const cheapest = new Int32Array(limit + 1).fill(-1);
  const nearest = new Int32Array(limit + 1).fill(-1);
  let best = -1, next = -1;
  for (let q = limit; q >= 0; q--) {
    if (Number.isFinite(costs[q])) {
      next = q;
      // At equal cost, lower quantity means lower surplus for every need.
      if (best === -1 || costs[q] <= costs[best]) best = q;
    }
    cheapest[q] = best; nearest[q] = next;
  }
  return {packs, costs, packCounts, vectors, cheapest, nearest};
}
function resultAt(table, need, kind) {
  if (need === 0) return {quantity: 0, cost: 0, surplus: 0, packCount: 0, counts: table.packs.map(() => 0)};
  const q = table[kind][need];
  if (q < 0) fail('計算範囲に解がありません');
  const k = table.packs.length;
  return {quantity: q, cost: table.costs[q], surplus: q - need, packCount: table.packCounts[q], counts: Array.from(table.vectors.subarray(q * k, (q + 1) * k))};
}
function solve(table, item, participants) {
  const required = participants * item.perPerson;
  const need = Math.max(0, required - item.stock);
  return {required, need, minPrice: resultAt(table, need, 'cheapest'), minSurplus: resultAt(table, need, 'nearest')};
}
export function optimizeItem(input, participants) {
  const item = checkedItem(input, participants);
  return solve(buildTable(item.packs, Math.max(0, participants * item.perPerson - item.stock)), item, participants);
}
export function calculateProject(input) {
  const project = validateProject(input);
  const items = project.items.map(item => ({id: item.id, ...optimizeItem(item, project.participants)}));
  const totals = {minPrice: 0, minSurplus: 0};
  for (const item of items) { totals.minPrice += item.minPrice.cost; totals.minSurplus += item.minSurplus.cost; }
  return {items, totals};
}
export function participantThresholds(input, from = 0, to = LIMITS.participants) {
  integer(from, 0, LIMITS.participants, '開始人数'); integer(to, from, LIMITS.participants, '終了人数');
  const item = checkedItem(input, to);
  const table = buildTable(item.packs, Math.max(0, to * item.perPerson - item.stock));
  const ranges = [];
  let previousKey = '';
  for (let p = from; p <= to; p++) {
    const result = solve(table, item, p);
    const key = `${result.minPrice.counts.join(',')}|${result.minSurplus.counts.join(',')}`;
    if (key === previousKey) ranges.at(-1).to = p;
    else ranges.push({from: p, to: p, minPrice: result.minPrice, minSurplus: result.minSurplus});
    previousKey = key;
  }
  return ranges;
}
