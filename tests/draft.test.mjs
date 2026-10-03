import test from 'node:test';
import assert from 'node:assert/strict';
import {removeDraftRow, INVALID_NEED_LABEL} from '../src/draft.mjs';
import {validateProject} from '../src/optimizer.mjs';
import {demoProject} from '../src/demo.mjs';

test('deleting an invalid pack validates the remaining draft and retains other edits', () => {
  const draft = demoProject();
  draft.items[0].packs[0].price = NaN;
  draft.title = '編集中の計画'; draft.items[1].stock = 11;
  const next = removeDraftRow(draft, 'badge', 'small');
  const result = validateProject(next);
  assert.equal(result.title, '編集中の計画'); assert.equal(result.items[1].stock, 11);
  assert.equal(result.items[0].packs.length, 2);
  assert.ok(Number.isNaN(draft.items[0].packs[0].price)); assert.equal(draft.items[0].packs.length, 3);
});
test('deleting an invalid item does not require repairing the discarded item', () => {
  const draft = demoProject(); draft.items[0].perPerson = -1; draft.items[1].name = '変更した名前';
  const next = removeDraftRow(draft, 'badge');
  assert.equal(validateProject(next).items[0].name, '変更した名前');
  assert.equal(draft.items.length, 2);
});
test('deleting while another row is invalid preserves that unfinished value', () => {
  const draft = demoProject(); draft.items[0].packs[0].price = NaN; draft.items[1].name = '';
  const next = removeDraftRow(draft, 'badge', 'small');
  assert.equal(next.items[0].packs.length, 2); assert.equal(next.items[1].name, '');
  assert.throws(() => validateProject(next));
  next.items[1].name = '修正後'; assert.equal(validateProject(next).items[1].name, '修正後');
});
test('repeated stable-ID removals do not delete the wrong row after indices move', () => {
  const first = removeDraftRow(demoProject(), 'badge', 'small');
  const second = removeDraftRow(first, 'badge', 'medium');
  assert.deepEqual(second.items[0].packs.map(p => p.id), ['large']);
  assert.equal(validateProject(second).items.length, 2);
});
test('removal keeps at least one item and one pack and rejects missing targets', () => {
  const draft = demoProject();
  assert.throws(() => removeDraftRow(draft, 'missing'));
  assert.throws(() => removeDraftRow(draft, 'badge', 'missing'));
  const oneItem = removeDraftRow(draft, 'pen');
  assert.throws(() => removeDraftRow(oneItem, 'badge'));
  const onePack = removeDraftRow(removeDraftRow(draft, 'pen', 'six'), 'badge');
  assert.throws(() => removeDraftRow(onePack, 'pen', 'ten'));
});
test('invalid-input need placeholder makes no numeric demand claim', () => {
  assert.match(INVALID_NEED_LABEL, /修正後に再計算/); assert.doesNotMatch(INVALID_NEED_LABEL, /\d/);
});
