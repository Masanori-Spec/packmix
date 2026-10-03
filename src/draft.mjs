/** Edit a browser-created draft before schema validation, without discarding other edits. */
export function removeDraftRow(draft, itemId, packId = null) {
  const items = draft.items.map(item => ({...item, packs: item.packs.map(pack => ({...pack}))}));
  const itemIndex = items.findIndex(item => item.id === itemId);
  if (itemIndex < 0) throw new Error('削除する品目が見つかりません');
  if (packId === null) {
    if (items.length <= 1) throw new Error('品目は1つ以上必要です');
    items.splice(itemIndex, 1);
  } else {
    const packs = items[itemIndex].packs;
    const packIndex = packs.findIndex(pack => pack.id === packId);
    if (packIndex < 0) throw new Error('削除するパックが見つかりません');
    if (packs.length <= 1) throw new Error('パック候補は1つ以上必要です');
    packs.splice(packIndex, 1);
  }
  return {...draft, items};
}
export const INVALID_NEED_LABEL = '必要数：入力の修正後に再計算';
