import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LIMITS,
  validateProject,
  parseProject,
  optimizeItem,
  calculateProject,
  participantThresholds,
} from '../src/optimizer.mjs';

const makeItem = (packs = [[6, 400], [10, 600]], overrides = {}) => ({
  id: 'item-1',
  name: 'Cups',
  unit: 'cups',
  perPerson: 1,
  stock: 0,
  packs: packs.map(([quantity, price], i) => ({
    id: `pack-${i + 1}`,
    label: `${quantity}-pack`,
    quantity,
    price,
  })),
  ...overrides,
});

const makeProject = (overrides = {}) => ({
  version: 1,
  title: 'Workshop supplies',
  participants: 23,
  items: [makeItem()],
  ...overrides,
});

const clone = (value) => structuredClone(value);

function deepFreeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

// This oracle deliberately does not use dynamic programming. It exhaustively
// enumerates count vectors, with each count bounded by the remaining quantity.
// A Pareto-optimal purchase has quantity < need + max(pack.quantity): otherwise
// removing any selected pack retains coverage and reduces both price and surplus.
function exhaustiveOracle(item, participants) {
  const required = participants * item.perPerson;
  const need = Math.max(0, required - item.stock);
  const empty = {
    quantity: 0,
    cost: 0,
    surplus: 0,
    packCount: 0,
    counts: item.packs.map(() => 0),
  };
  if (need === 0) {
    return { required, need, minPrice: clone(empty), minSurplus: clone(empty) };
  }
  const upperBound = need + Math.max(...item.packs.map((pack) => pack.quantity)) - 1;
  const counts = item.packs.map(() => 0);
  let minPrice;
  let minSurplus;

  function better(candidate, incumbent, priority) {
    if (!incumbent) return true;
    const keys = priority === 'price'
      ? ['cost', 'surplus', 'packCount']
      : ['surplus', 'cost', 'packCount'];
    for (const key of keys) {
      if (candidate[key] !== incumbent[key]) return candidate[key] < incumbent[key];
    }
    for (let i = 0; i < candidate.counts.length; i += 1) {
      if (candidate.counts[i] !== incumbent.counts[i]) {
        return candidate.counts[i] > incumbent.counts[i];
      }
    }
    return false;
  }

  function enumerate(index, quantity, cost, packCount) {
    if (index === item.packs.length) {
      if (quantity < need) return;
      const candidate = { quantity, cost, surplus: quantity - need, packCount, counts: [...counts] };
      if (better(candidate, minPrice, 'price')) minPrice = candidate;
      if (better(candidate, minSurplus, 'surplus')) minSurplus = candidate;
      return;
    }
    const pack = item.packs[index];
    const countLimit = Math.floor((upperBound - quantity) / pack.quantity);
    for (let count = 0; count <= countLimit; count += 1) {
      counts[index] = count;
      enumerate(index + 1, quantity + count * pack.quantity,
        cost + count * pack.price, packCount + count);
    }
    counts[index] = 0;
  }

  enumerate(0, 0, 0, 0);
  assert.ok(minPrice && minSurplus, 'Every positive-quantity pack can cover finite demand');
  return { required, need, minPrice, minSurplus };
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return (min, max) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return min + ((state >>> 0) % (max - min + 1));
  };
}

function assertSolutionArithmetic(solution, item, need) {
  assert.equal(solution.counts.length, item.packs.length);
  for (const count of solution.counts) assert.ok(Number.isInteger(count) && count >= 0);
  const quantity = solution.counts.reduce((total, count, i) => total + count * item.packs[i].quantity, 0);
  const cost = solution.counts.reduce((total, count, i) => total + count * item.packs[i].price, 0);
  assert.equal(solution.quantity, quantity);
  assert.equal(solution.cost, cost);
  assert.equal(solution.packCount, solution.counts.reduce((total, count) => total + count, 0));
  assert.equal(solution.surplus, need === 0 ? 0 : quantity - need);
  assert.ok(quantity >= need);
}

test('public exports include validation, optimization, aggregation and thresholds', () => {
  assert.deepEqual(LIMITS, {
    participants: 500, items: 5, packs: 6, perPerson: 20,
    stock: 10000, quantity: 1000, price: 1000000, bytes: 65536,
  });
  for (const exported of [validateProject, parseProject, optimizeItem, calculateProject, participantThresholds]) {
    assert.equal(typeof exported, 'function');
  }
});

test('valid project is deeply cloned and round-trips through JSON', () => {
  const input = makeProject();
  const actual = validateProject(input);
  assert.deepEqual(actual, input);
  assert.notEqual(actual, input);
  assert.notEqual(actual.items, input.items);
  assert.notEqual(actual.items[0], input.items[0]);
  assert.notEqual(actual.items[0].packs, input.items[0].packs);
  assert.notEqual(actual.items[0].packs[0], input.items[0].packs[0]);
  actual.items[0].packs[0].price = 1;
  assert.equal(input.items[0].packs[0].price, 400);
  assert.deepEqual(parseProject(JSON.stringify(input)), input);
});

test('validation trims presentation strings while retaining their content', () => {
  const input = makeProject({ title: '  Supplies  ' });
  input.items[0].name = '  紙コップ  ';
  input.items[0].unit = '  個  ';
  input.items[0].packs[0].label = '  Small pack  ';
  const expected = clone(input);
  expected.title = 'Supplies';
  expected.items[0].name = '紙コップ';
  expected.items[0].unit = '個';
  expected.items[0].packs[0].label = 'Small pack';
  assert.deepEqual(validateProject(input), expected);
  assert.deepEqual(parseProject(JSON.stringify(input)), expected);
  assert.equal(input.title, '  Supplies  ');
});

test('valid min/max numeric limits are accepted without rounding prices', () => {
  const input = makeProject({
    participants: 500,
    items: [makeItem([[1, 1_000_000], [1000, 1]], { perPerson: 20, stock: 10_000 })],
  });
  assert.deepEqual(validateProject(input), input);
  assert.doesNotThrow(() => validateProject(makeProject({ participants: 0 })));
});

test('maximum supported number of items and packs is accepted', () => {
  const input = makeProject({ items: Array.from({ length: 5 }, (_, i) => makeItem(
    [[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 6]],
    { id: `item-${i + 1}`, packs: Array.from({ length: 6 }, (_, j) => ({
      id: `item-${i + 1}-pack-${j + 1}`, label: `Pack ${j + 1}`, quantity: j + 1, price: j + 1,
    })) },
  )) });
  assert.doesNotThrow(() => validateProject(input));
});

test('stock covering demand and zero participants buy no packs', () => {
  for (const [participants, stock, perPerson] of [[0, 0, 1], [0, 100, 2], [10, 20, 2], [9, 100, 3]]) {
    const item = makeItem(undefined, { stock, perPerson });
    assert.deepEqual(optimizeItem(item, participants), exhaustiveOracle(item, participants));
  }
});

test('existing stock is subtracted from required units before optimization', () => {
  const item = makeItem([[4, 50], [7, 80]], { perPerson: 3, stock: 10 });
  const result = optimizeItem(item, 6);
  assert.equal(result.required, 18);
  assert.equal(result.need, 8);
  assert.deepEqual(result, exhaustiveOracle(item, 6));
  assert.deepEqual(result.minPrice.counts, [2, 0]);
});

test('price and surplus objectives can choose different purchases', () => {
  const item = makeItem([[6, 4], [5, 5]]);
  const result = optimizeItem(item, 5);
  assert.deepEqual(result, exhaustiveOracle(item, 5));
  assert.deepEqual(result.minPrice.counts, [1, 0]);
  assert.deepEqual(result.minSurplus.counts, [0, 1]);
});

test('minimum price uses lower surplus as its first tiebreak', () => {
  const item = makeItem([[6, 4], [5, 4]]);
  const result = optimizeItem(item, 5);
  assert.deepEqual(result.minPrice.counts, [0, 1]);
  assert.deepEqual(result, exhaustiveOracle(item, 5));
});

test('minimum surplus uses lower price as its first tiebreak', () => {
  const item = makeItem([[5, 5], [5, 4]]);
  const result = optimizeItem(item, 5);
  assert.deepEqual(result.minSurplus.counts, [0, 1]);
  assert.deepEqual(result, exhaustiveOracle(item, 5));
});

test('fewest packs wins before preference for earlier pack types', () => {
  const item = makeItem([[2, 2], [4, 4]]);
  const result = optimizeItem(item, 4);
  assert.deepEqual(result.minPrice.counts, [0, 1]);
  assert.deepEqual(result.minSurplus.counts, [0, 1]);
  assert.deepEqual(result, exhaustiveOracle(item, 4));
});

test('equal solutions deterministically favor counts at earlier indices', () => {
  for (const [packs, participants, expected] of [
    [[[5, 10], [5, 10]], 10, [2, 0]],
    [[[2, 2], [4, 4], [3, 3]], 6, [1, 1, 0]],
    [[[3, 7], [3, 7], [3, 7]], 8, [3, 0, 0]],
  ]) {
    const item = makeItem(packs);
    const result = optimizeItem(item, participants);
    assert.deepEqual(result, exhaustiveOracle(item, participants));
    assert.deepEqual(result.minPrice.counts, expected);
    assert.deepEqual(result.minSurplus.counts, expected);
  }
});

test('six pack candidates preserve deterministic ties across repeated calls', () => {
  const item = makeItem([[2, 2], [4, 4], [3, 3], [2, 2], [4, 4], [3, 3]]);
  const expected = exhaustiveOracle(item, 6);
  assert.deepEqual(expected.minPrice.counts, [1, 1, 0, 0, 0, 0]);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const actual = optimizeItem(item, 6);
    assert.deepEqual(actual, expected);
    actual.minPrice.counts[0] = 999;
    assert.deepEqual(actual.minSurplus.counts, expected.minSurplus.counts, 'Result alternatives must not share mutable count vectors');
  }
});

test('mixed packs beat a greedy cheapest-unit-price purchase', () => {
  const item = makeItem([[6, 5], [4, 4]]);
  const result = optimizeItem(item, 8);
  assert.deepEqual(result, exhaustiveOracle(item, 8));
  assert.deepEqual(result.minPrice.counts, [0, 2]);
});

test('single large pack and non-divisible requirements respect oversupply', () => {
  for (const [quantity, participants] of [[7, 1], [7, 7], [7, 8], [1000, 499]]) {
    const item = makeItem([[quantity, 123]]);
    assert.deepEqual(optimizeItem(item, participants), exhaustiveOracle(item, participants));
  }
});

test('maximum demand and large prices remain exact safe integers', () => {
  const item = makeItem([[1, 1_000_000]], { perPerson: 20 });
  const result = optimizeItem(item, 500);
  const expected = { quantity: 10_000, cost: 10_000_000_000, surplus: 0, packCount: 10_000, counts: [10_000] };
  assert.equal(result.required, 10_000);
  assert.equal(result.need, 10_000);
  assert.deepEqual(result.minPrice, expected);
  assert.deepEqual(result.minSurplus, expected);
  assert.ok(Number.isSafeInteger(result.minPrice.cost));
});

test('1,000 seeded randomized small cases match exhaustive count-vector enumeration', () => {
  const random = seededRandom(0x5041434b);
  for (let iteration = 0; iteration < 1000; iteration += 1) {
    const packTypes = random(1, 4);
    const item = makeItem(Array.from({ length: packTypes }, () => [random(1, 8), random(1, 30)]), {
      perPerson: random(1, 3), stock: random(0, 12),
    });
    const participants = random(0, 8);
    const actual = optimizeItem(item, participants);
    const expected = exhaustiveOracle(item, participants);
    assert.deepEqual(actual, expected, `seed=0x5041434b case=${iteration} input=${JSON.stringify({ item, participants })}`);
    assertSolutionArithmetic(actual.minPrice, item, actual.need);
    assertSolutionArithmetic(actual.minSurplus, item, actual.need);
  }
});

test('optimizer accepts frozen inputs and does not mutate them', () => {
  const item = deepFreeze(makeItem([[3, 50], [8, 115]], { stock: 2, perPerson: 2 }));
  const before = JSON.stringify(item);
  assert.deepEqual(optimizeItem(item, 11), exhaustiveOracle(item, 11));
  assert.equal(JSON.stringify(item), before);
});

test('project aggregation sums prices and preserves per-item oracle results', () => {
  const project = deepFreeze(makeProject({ participants: 5, items: [
    makeItem([[6, 4], [5, 5]], { id: 'cups' }),
    makeItem([[4, 10], [7, 16]], { id: 'plates', perPerson: 2, stock: 3 }),
    makeItem([[8, 100]], { id: 'napkins', stock: 100, perPerson: 3 }),
  ] }));
  const expectedItems = project.items.map((item) => ({ id: item.id, ...exhaustiveOracle(item, project.participants) }));
  const expectedTotals = {
    minPrice: expectedItems.reduce((total, item) => total + item.minPrice.cost, 0),
    minSurplus: expectedItems.reduce((total, item) => total + item.minSurplus.cost, 0),
  };
  assert.deepEqual(calculateProject(project), { items: expectedItems, totals: expectedTotals });
  assert.ok(expectedTotals.minPrice < expectedTotals.minSurplus);
});

test('project totals remain exact for the maximum supported five-item bill', () => {
  const project = makeProject({ participants: 500, items: Array.from({ length: 5 }, (_, i) =>
    makeItem([[1, 1_000_000]], { id: `i${i}`, perPerson: 20 })) });
  const result = calculateProject(project);
  assert.equal(result.items.length, 5);
  assert.deepEqual(result.totals, { minPrice: 50_000_000_000, minSurplus: 50_000_000_000 });
  assert.ok(Number.isSafeInteger(result.totals.minPrice));
});

test('all public calculation entry points reject invalid data', () => {
  const item = makeItem();
  for (const participants of [-1, 501, 1.5, '1', null, NaN, Infinity]) {
    assert.throws(() => optimizeItem(item, participants));
  }
  const invalidItem = makeItem([[0, 1]]);
  assert.throws(() => optimizeItem(invalidItem, 10));
  assert.throws(() => calculateProject(makeProject({ items: [invalidItem] })));
  assert.throws(() => participantThresholds(invalidItem, 0, 10));
});

test('threshold segments cover the range and match exhaustive vectors at every participant count', () => {
  const item = makeItem([[4, 9], [7, 13], [9, 20]], { stock: 5, perPerson: 2 });
  const before = clone(item);
  const from = 0;
  const to = 30;
  const segments = participantThresholds(item, from, to);
  assert.ok(Array.isArray(segments) && segments.length > 0);
  assert.equal(segments[0].from, from);
  assert.equal(segments.at(-1).to, to);
  let next = from;
  let previousVectors;
  for (const segment of segments) {
    assert.equal(segment.from, next);
    assert.ok(Number.isInteger(segment.from) && Number.isInteger(segment.to));
    assert.ok(segment.from <= segment.to);
    const atStart = exhaustiveOracle(item, segment.from);
    assert.deepEqual(segment.minPrice, atStart.minPrice, 'Segment solution numbers are evaluated at from');
    assert.deepEqual(segment.minSurplus, atStart.minSurplus, 'Segment solution numbers are evaluated at from');
    const vectors = [segment.minPrice.counts, segment.minSurplus.counts];
    assert.notDeepEqual(vectors, previousVectors, 'Adjacent identical vector runs must be coalesced');
    for (let participants = segment.from; participants <= segment.to; participants += 1) {
      const expected = exhaustiveOracle(item, participants);
      assert.deepEqual(segment.minPrice.counts, expected.minPrice.counts, `price at ${participants}`);
      assert.deepEqual(segment.minSurplus.counts, expected.minSurplus.counts, `surplus at ${participants}`);
      assert.equal(segment.minPrice.cost, expected.minPrice.cost);
      assert.equal(segment.minSurplus.cost, expected.minSurplus.cost);
    }
    previousVectors = vectors;
    next = segment.to + 1;
  }
  assert.equal(next, to + 1);
  assert.deepEqual(item, before);
});

test('one-participant threshold range produces exactly one segment', () => {
  const item = makeItem([[6, 400], [10, 600]], { stock: 1 });
  const actual = participantThresholds(item, 19, 19);
  assert.equal(actual.length, 1);
  assert.equal(actual[0].from, 19);
  assert.equal(actual[0].to, 19);
  const expected = exhaustiveOracle(item, 19);
  assert.deepEqual(actual[0].minPrice, expected.minPrice);
  assert.deepEqual(actual[0].minSurplus, expected.minSurplus);
});

test('stock-sufficient threshold range coalesces to a single zero-purchase segment', () => {
  const item = makeItem(undefined, { stock: 100, perPerson: 2 });
  const segments = participantThresholds(item, 0, 50);
  assert.equal(segments.length, 1);
  assert.equal(segments[0].from, 0);
  assert.equal(segments[0].to, 50);
  assert.deepEqual(segments[0].minPrice, exhaustiveOracle(item, 0).minPrice);
  assert.deepEqual(segments[0].minSurplus, exhaustiveOracle(item, 0).minSurplus);
});

test('threshold defaults span 0..500 with exact inclusive boundary transitions', () => {
  const item = makeItem([[10, 100]]);
  const segments = participantThresholds(item);
  assert.equal(segments.length, 51);
  assert.equal(segments[0].from, 0);
  assert.equal(segments[0].to, 0);
  for (let packs = 1; packs <= 50; packs += 1) {
    const segment = segments[packs];
    assert.equal(segment.from, (packs - 1) * 10 + 1);
    assert.equal(segment.to, packs * 10);
    assert.deepEqual(segment.minPrice.counts, [packs]);
    assert.deepEqual(segment.minSurplus.counts, [packs]);
    assert.equal(segment.minPrice.surplus, 9);
  }
  const partial = participantThresholds(item, 7, 23);
  assert.deepEqual(partial.map(({ from, to }) => ({ from, to })), [
    { from: 7, to: 10 }, { from: 11, to: 20 }, { from: 21, to: 23 },
  ]);
});

test('threshold ranges reject reversal, out-of-range endpoints and malformed integers', () => {
  const item = makeItem();
  for (const [from, to] of [[2, 1], [-1, 1], [0, 501], [501, 501], [0.5, 10], [0, 10.5], ['0', 10], [0, '10'], [null, 10], [0, null], [NaN, 10], [0, Infinity]]) {
    assert.throws(() => participantThresholds(item, from, to), `Range ${String(from)}..${String(to)}`);
  }
});

test('validation rejects non-object roots and unsupported schema versions', () => {
  for (const input of [null, undefined, true, false, 1, 'text', [], makeProject({ version: 0 }), makeProject({ version: 2 }), makeProject({ version: '1' })]) {
    assert.throws(() => validateProject(input), `unexpectedly accepted ${String(input)}`);
  }
});

test('required structural fields cannot be omitted', () => {
  const paths = [
    ['version'], ['title'], ['participants'], ['items'],
    ['items', 0, 'id'], ['items', 0, 'name'], ['items', 0, 'unit'],
    ['items', 0, 'perPerson'], ['items', 0, 'stock'], ['items', 0, 'packs'],
    ['items', 0, 'packs', 0, 'id'], ['items', 0, 'packs', 0, 'label'],
    ['items', 0, 'packs', 0, 'quantity'], ['items', 0, 'packs', 0, 'price'],
  ];
  for (const path of paths) {
    const input = makeProject();
    let target = input;
    for (const key of path.slice(0, -1)) target = target[key];
    delete target[path.at(-1)];
    assert.throws(() => validateProject(input), `Missing ${path.join('.')}`);
  }
});

test('numeric fields reject coercion, fractional, nonfinite and out-of-range values', () => {
  const cases = [
    [['participants'], [-1, 501, 0.1, '23', null, true, NaN, Infinity, -Infinity]],
    [['items', 0, 'perPerson'], [0, 21, -1, 1.5, '1', null, true, NaN, Infinity]],
    [['items', 0, 'stock'], [-1, 10001, 0.5, '0', null, false, NaN, Infinity]],
    [['items', 0, 'packs', 0, 'quantity'], [0, 1001, -1, 1.5, '6', null, true, NaN, Infinity]],
    [['items', 0, 'packs', 0, 'price'], [0, 1000001, -1, 1.5, '400', null, true, NaN, Infinity]],
  ];
  for (const [path, values] of cases) {
    for (const value of values) {
      const input = makeProject();
      let target = input;
      for (const key of path.slice(0, -1)) target = target[key];
      target[path.at(-1)] = value;
      assert.throws(() => validateProject(input), `${path.join('.')}=${String(value)}`);
    }
  }
});

test('string fields reject malformed types', () => {
  const paths = [
    ['title'], ['items', 0, 'id'], ['items', 0, 'name'], ['items', 0, 'unit'],
    ['items', 0, 'packs', 0, 'id'], ['items', 0, 'packs', 0, 'label'],
  ];
  for (const path of paths) {
    for (const value of [null, 1, false, [], {}, undefined]) {
      const input = makeProject();
      let target = input;
      for (const key of path.slice(0, -1)) target = target[key];
      target[path.at(-1)] = value;
      assert.throws(() => validateProject(input), `${path.join('.')}=${String(value)}`);
    }
  }
});

test('strings enforce nonempty content, control-character exclusion and documented lengths', () => {
  const cases = [
    [['title'], 80], [['items', 0, 'id'], 40], [['items', 0, 'name'], 60],
    [['items', 0, 'unit'], 8], [['items', 0, 'packs', 0, 'id'], 40], [['items', 0, 'packs', 0, 'label'], 60],
  ];
  for (const [path, maxLength] of cases) {
    for (const value of ['', '   ', 'name\n', 'name\t', 'name\u0000', 'name\u007f', 'x'.repeat(maxLength + 1)]) {
      const input = makeProject();
      let target = input;
      for (const key of path.slice(0, -1)) target = target[key];
      target[path.at(-1)] = value;
      assert.throws(() => validateProject(input), `${path.join('.')}=${JSON.stringify(value)}`);
    }
    const input = makeProject();
    let target = input;
    for (const key of path.slice(0, -1)) target = target[key];
    target[path.at(-1)] = 'x'.repeat(maxLength);
    assert.doesNotThrow(() => validateProject(input), `${path.join('.')} at exact length`);
  }
});

test('ids accept only the explicitly supported ASCII identifier alphabet', () => {
  for (const value of ['id with spaces', '日本語', 'id/slash', 'id.dot', ' leading', 'trailing ', 'a💡']) {
    const input = makeProject();
    input.items[0].id = value;
    assert.throws(() => validateProject(input));
    input.items[0].id = 'valid_item-1';
    input.items[0].packs[0].id = value;
    assert.throws(() => validateProject(input));
  }
});

test('item and pack collections reject malformed members and excess sizes', () => {
  for (const items of [null, {}, 'items', [], [null], [[]], [1], [false], Array.from({ length: 6 }, (_, i) => makeItem(undefined, { id: `i${i}` }))]) {
    assert.throws(() => validateProject(makeProject({ items })));
  }
  for (const packs of [null, {}, 'packs', [], [null], [[]], [1], Array.from({ length: 7 }, (_, i) => ({ id: `p${i}`, label: 'Pack', quantity: 1, price: 1 }))]) {
    assert.throws(() => validateProject(makeProject({ items: [makeItem(undefined, { packs })] })));
  }
});

test('duplicate item ids and duplicate pack ids are rejected', () => {
  const duplicateItems = makeProject({ items: [makeItem(), makeItem()] });
  assert.throws(() => validateProject(duplicateItems));
  const duplicatePacks = makeProject();
  duplicatePacks.items[0].packs[1].id = duplicatePacks.items[0].packs[0].id;
  assert.throws(() => validateProject(duplicatePacks));
  assert.throws(() => parseProject(JSON.stringify(duplicateItems)));
  assert.throws(() => parseProject(JSON.stringify(duplicatePacks)));
});

test('unknown keys are rejected at root, item and pack levels', () => {
  for (const path of [[], ['items', 0], ['items', 0, 'packs', 0]]) {
    const input = makeProject();
    let target = input;
    for (const key of path) target = target[key];
    target.unexpected = 123;
    assert.throws(() => validateProject(input));
    assert.throws(() => parseProject(JSON.stringify(input)));
  }
});

test('JSON parsing rejects malformed, non-JSON and non-object documents', () => {
  for (const text of ['', ' ', '{', '{} trailing', '{"version":1,}', 'undefined', 'NaN', '// comment\n{}', 'null', '[]', 'false', '123', '"project"']) {
    assert.throws(() => parseProject(text), `unexpectedly accepted ${JSON.stringify(text)}`);
  }
  for (const value of [null, undefined, 1, {}, [], Buffer.from('{}')]) {
    assert.throws(() => parseProject(value));
  }
});

test('valid JSON with overflowing numeric literals is rejected', () => {
  const text = JSON.stringify(makeProject()).replace('"price":400', '"price":1e309');
  assert.throws(() => parseProject(text));
});

test('64 KiB input byte limit is enforced even for otherwise valid JSON', () => {
  const text = JSON.stringify(makeProject());
  const oversized = text + ' '.repeat(65_537 - Buffer.byteLength(text, 'utf8'));
  assert.equal(Buffer.byteLength(oversized, 'utf8'), 65_537);
  assert.throws(() => parseProject(oversized));
  const atLimit = text + ' '.repeat(65_536 - Buffer.byteLength(text, 'utf8'));
  assert.deepEqual(parseProject(atLimit), makeProject());
});

test('JSON input size uses UTF-8 bytes rather than JavaScript string length', () => {
  const input = makeProject({ title: '相談会😀' });
  const text = JSON.stringify(input);
  const oversized = text + ' '.repeat(65_537 - Buffer.byteLength(text, 'utf8'));
  assert.ok(oversized.length < 65_536, 'Multibyte input fits a mistaken character-count check');
  assert.equal(Buffer.byteLength(oversized, 'utf8'), 65_537);
  assert.throws(() => parseProject(oversized));
  const atLimit = oversized.slice(0, -1);
  assert.equal(Buffer.byteLength(atLimit, 'utf8'), 65_536);
  assert.deepEqual(parseProject(atLimit), input);
});

test('deeply nested hostile JSON is rejected without recursive stack exhaustion', () => {
  const text = '['.repeat(2000) + '0' + ']'.repeat(2000);
  assert.throws(() => parseProject(text), (error) => {
    assert.ok(error instanceof Error);
    assert.notEqual(error.name, 'RangeError');
    return true;
  });
});

test('validation rejects prototype-inherited and class-based structural objects', () => {
  const input = makeProject();
  const inherited = Object.create(input);
  assert.throws(() => validateProject(inherited));
  const nullPrototype = Object.assign(Object.create(null), input);
  assert.throws(() => validateProject(nullPrototype));
  class Project { constructor() { Object.assign(this, makeProject()); } }
  assert.throws(() => validateProject(new Project()));
});

test('dangerous property names are rejected anywhere without prototype pollution', () => {
  const originalPolluted = Object.prototype.packmixPolluted;
  for (const key of ['__proto__', 'prototype', 'constructor']) {
    for (const path of [[], ['items', 0], ['items', 0, 'packs', 0]]) {
      const input = makeProject();
      let target = input;
      for (const child of path) target = target[child];
      Object.defineProperty(target, key, { value: { packmixPolluted: true }, enumerable: true, configurable: true });
      const text = JSON.stringify(input);
      assert.ok(text.includes(`"${key}"`));
      assert.throws(() => parseProject(text), `${key} at ${path.join('.')}`);
      assert.throws(() => validateProject(JSON.parse(text)), `${key} direct validation`);
      assert.equal(Object.prototype.packmixPolluted, originalPolluted);
    }
  }
});

test('escaped dangerous JSON keys and nested malicious payloads are rejected', () => {
  const normal = JSON.stringify(makeProject());
  const malicious = [
    normal.replace('{', '{"\\u005f_proto__":{"packmixPolluted":true},'),
    normal.replace('{', '{"metadata":{"deep":[{"constructor":{"prototype":{"packmixPolluted":true}}}]},'),
    normal.replace('"name":"Cups"', '"name":{"deep":{"__proto__":{"packmixPolluted":true}}}'),
  ];
  for (const text of malicious) assert.throws(() => parseProject(text));
  assert.equal(Object.prototype.packmixPolluted, undefined);
});

test('dangerous words used only as normal text are preserved', () => {
  const input = makeProject({ title: 'constructor prototype __proto__' });
  input.items[0].name = '<script>alert("test")</script>';
  input.items[0].packs[0].label = '__proto__';
  assert.deepEqual(parseProject(JSON.stringify(input)), input);
});
