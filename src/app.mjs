import {validateProject, parseProject, calculateProject, participantThresholds, LIMITS} from './optimizer.mjs';
import {demoProject} from './demo.mjs';
import {removeDraftRow, INVALID_NEED_LABEL} from './draft.mjs';
const $ = selector => document.querySelector(selector);
const yen = number => `${number.toLocaleString('ja-JP')}円`;
let project = demoProject(), mode = 'minPrice', valid = true, serial = 0;
const thresholdCache = new Map();
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'value') node.value = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children.flat()) if (child !== null && child !== undefined) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
const num = (value, min, max, label, field) => el('input', {type: 'number', value, min, max, step: 1, inputmode: 'numeric', required: true, 'aria-label': label, 'data-field': field});
const field = (label, input) => el('label', {class: 'field'}, label, input);
function setStatus(text, error = false) { const n = $('#status'); n.textContent = text; n.classList.toggle('error', error); n.setAttribute('role', error ? 'alert' : 'status'); }
function collectDraft() {
  return {version: 1, title: $('#title').value, participants: $('#participants').value === '' ? NaN : Number($('#participants').value), items: [...$('#items').children].map(card => {
    const input = name => card.querySelector(`[data-field="${name}"]`).value;
    const number = name => input(name) === '' ? NaN : Number(input(name));
    return {id: card.dataset.id, name: input('name'), unit: input('unit'), perPerson: number('perPerson'), stock: number('stock'), packs: [...card.querySelectorAll('.pack-row')].map(row => {
      const value = name => row.querySelector(`[data-pack="${name}"]`).value;
      return {id: row.dataset.id, label: value('label'), quantity: value('quantity') === '' ? NaN : Number(value('quantity')), price: value('price') === '' ? NaN : Number(value('price'))};
    })};
  })};
}
function update(candidate = collectDraft()) {
  try { project = validateProject(candidate); valid = true; $('#export').disabled = false; setStatus(''); renderResults(); }
  catch (error) { valid = false; $('#export').disabled = true; setStatus(error.message, true); $('#results').replaceChildren(el('div', {class: 'blocked'}, '入力を確認してください。修正されるまで、古い計算結果は表示しません。')); $('#thresholds').replaceChildren(); for (const line of document.querySelectorAll('[data-need]')) line.replaceChildren(INVALID_NEED_LABEL); }
}
function acceptDraft() { update(); return valid; }
function rememberFocus() {
  const active = document.activeElement;
  if (!active) return null;
  const card = active.closest('.item-card');
  if (!card) return active.dataset.mode ? {mode: active.dataset.mode} : null;
  const pack = active.closest('.pack-row');
  return {cardId: card.dataset.id, index: [...$('#items').children].indexOf(card), packId: pack?.dataset.id, field: active.dataset.field, packField: active.dataset.pack, addPack: active.classList.contains('add-pack')};
}
function restoreFocus(saved) {
  if (!saved) return;
  if (saved.mode) {document.querySelector(`[data-mode="${saved.mode}"]`)?.focus(); return;}
  const cards = [...$('#items').children];
  const card = cards.find(n => n.dataset.id === saved.cardId) || cards[Math.min(saved.index, cards.length - 1)];
  if (!card) return;
  const pack = [...card.querySelectorAll('.pack-row')].find(n => n.dataset.id === saved.packId);
  const target = saved.packField && pack ? pack.querySelector(`[data-pack="${saved.packField}"]`) : saved.field ? card.querySelector(`[data-field="${saved.field}"]`) : saved.addPack ? card.querySelector('.add-pack:not(:disabled)') : null;
  (target || card.querySelector('[data-field="name"]'))?.focus();
}
function removeEditorRow(itemId, packId = null) {
  const savedFocus = rememberFocus();
  const candidate = removeDraftRow(collectDraft(), itemId, packId);
  const cards = [...$('#items').children];
  const card = cards.find(node => node.dataset.id === itemId);
  if (packId === null) card.remove();
  else [...card.querySelectorAll('.pack-row')].find(row => row.dataset.id === packId).remove();
  // Preserve all other raw form values, including unfinished/invalid inputs.
  const remainingCards = [...$('#items').children];
  remainingCards.forEach((node, index) => {
    node.querySelector('.item-number').textContent = String(index + 1).padStart(2, '0');
    node.querySelector('.item-head button').disabled = remainingCards.length <= 1;
    const packs = [...node.querySelectorAll('.pack-row')];
    for (const pack of packs) pack.querySelector('.remove-pack').disabled = packs.length <= 1;
    const add = node.querySelector('.add-pack');
    add.disabled = packs.length >= LIMITS.packs;
    add.textContent = `＋ パック候補を追加 (${packs.length}/6)`;
  });
  $('#add-item').disabled = remainingCards.length >= LIMITS.items;
  update(candidate);
  restoreFocus(savedFocus);
}
function renderEditor() {
  $('#title').value = project.title; $('#participants').value = project.participants;
  $('#items').replaceChildren(...project.items.map((item, index) => {
    const name = el('input', {class: 'item-name', value: item.name, maxlength: 60, required: true, 'aria-label': `品目${index + 1} 名前`, 'data-field': 'name'});
    const remove = el('button', {class: 'icon-button', 'aria-label': `${item.name}を削除`, disabled: project.items.length === 1, onclick: () => removeEditorRow(item.id)} , '×');
    const card = el('article', {class: 'item-card', 'data-id': item.id},
      el('div', {class: 'item-head'}, el('span', {class: 'item-number'}, String(index + 1).padStart(2, '0')), name, remove),
      el('div', {class: 'input-row'}, field('1人あたり', num(item.perPerson, 1, LIMITS.perPerson, `${item.name} 1人あたり`, 'perPerson')), field('手持ち在庫', num(item.stock, 0, LIMITS.stock, `${item.name} 手持ち在庫`, 'stock')), field('単位', el('input', {value: item.unit, maxlength: 8, required: true, 'aria-label': `${item.name} 単位`, 'data-field': 'unit'}))),
      el('div', {class: 'need-line', 'data-need': item.id}),
      el('div', {class: 'pack-title'}, '買えるパック', el('span', {}, '同じ品質・用途の候補を入力')),
      el('div', {class: 'pack-header', 'aria-hidden': true}, el('span', {}, 'パック名'), el('span', {}, '入数'), el('span', {}, '税込価格（円）'), el('span')),
      ...item.packs.map((pack, i) => el('div', {class: 'pack-row', 'data-id': pack.id},
        el('input', {value: pack.label, maxlength: 60, required: true, 'aria-label': `${item.name} パック${i + 1} 名前`, 'data-pack': 'label'}),
        el('input', {type: 'number', value: pack.quantity, min: 1, max: LIMITS.quantity, step: 1, required: true, inputmode: 'numeric', 'aria-label': `${item.name} パック${i + 1} 入数`, 'data-pack': 'quantity'}),
        el('input', {type: 'number', value: pack.price, min: 1, max: LIMITS.price, step: 1, required: true, inputmode: 'numeric', 'aria-label': `${item.name} パック${i + 1} 税込価格`, 'data-pack': 'price'}),
        el('button', {class: 'remove-pack', 'aria-label': `${item.name} パック${i + 1}を削除`, disabled: item.packs.length === 1, onclick: () => removeEditorRow(item.id, pack.id)}, '×')
      )),
      el('button', {class: 'add-pack', disabled: item.packs.length >= LIMITS.packs, onclick: () => { if (!acceptDraft()) return; project.items.find(candidate => candidate.id === item.id).packs.push({id: `p${Date.now()}_${serial++}`, label: '新しいパック', quantity: 10, price: 300}); renderAll(); }}, `＋ パック候補を追加 (${item.packs.length}/6)`)
    );
    return card;
  }));
  $('#add-item').disabled = project.items.length >= LIMITS.items;
  $('#minus').disabled = project.participants <= 0; $('#plus').disabled = project.participants >= LIMITS.participants;
}
function mix(item, plan) { return plan.counts.map((count, i) => count ? `${item.packs[i].label} × ${count}` : null).filter(Boolean).join(' ＋ ') || '購入なし'; }
function shoppingText(results) {
  const lines = [`PackMix | ${project.title}`, `${project.participants}人 / ${mode === 'minPrice' ? '最安プラン' : '余り最少プラン'}`, ''];
  project.items.forEach((item, i) => {
    const result = results.items[i], plan = result[mode];
    lines.push(`■ ${item.name}`, `必要${result.required}${item.unit} − 在庫${item.stock}${item.unit} = 購入必要${result.need}${item.unit}`);
    plan.counts.forEach((count, j) => { if (count) lines.push(`・${item.packs[j].label} (${item.packs[j].quantity}${item.unit}/${yen(item.packs[j].price)}) × ${count} = ${yen(item.packs[j].price * count)}`); });
    if (!plan.packCount) lines.push('・購入なし');
    lines.push(`購入${plan.quantity}${item.unit} / 購入分の余り${plan.surplus}${item.unit} / 在庫残り${Math.max(0, item.stock - result.required)}${item.unit}`, `小計 ${yen(plan.cost)}`, '');
  });
  lines.push(`税込合計 ${yen(results.totals[mode])}`, '送料・クーポン・セット割・店舗間の条件・購入上限は含みません。', '入力候補内の最適解です。購入前に価格・在庫を確認してください。');
  return lines.join('\n');
}
function download(text, filename, type) {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const link = el('a', {href: url, download: filename}); document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function renderResults() {
  const focusedMode = document.activeElement?.dataset.mode;
  const results = calculateProject(project);
  project.items.forEach((item, i) => { const result = results.items[i]; const n = [...document.querySelectorAll('[data-need]')].find(n => n.dataset.need === item.id); if (n) n.replaceChildren(el('span', {}, `${project.participants}人 × ${item.perPerson}${item.unit} − 在庫${item.stock}${item.unit}`), el('strong', {}, `あと ${result.need}${item.unit}`)); });
  $('#minus').disabled = project.participants <= 0; $('#plus').disabled = project.participants >= LIMITS.participants;
  const comparison = el('div', {class: 'comparison', role: 'group', 'aria-label': '購入方針'});
  for (const [key, title, subtitle] of [['minPrice', '最安プラン', '金額を最優先に'], ['minSurplus', '余り最少プラン', '余りを最優先に']]) {
    comparison.append(el('button', {class: `choice${mode === key ? ' selected' : ''}`, 'aria-pressed': mode === key ? 'true' : 'false', 'data-mode': key, onclick: () => { mode = key; renderResults(); }}, el('span', {class: 'check', 'aria-hidden': true}, mode === key ? '✓' : ''), el('span', {class: 'choice-label'}, title), el('span', {class: 'price'}, el('small', {}, '¥'), results.totals[key].toLocaleString('ja-JP')), el('span', {class: 'choice-note'}, subtitle)));
  }
  const delta = results.totals.minSurplus - results.totals.minPrice;
  const shopping = el('section', {class: 'shopping', 'aria-label': '買い物リスト'}, el('h3', {}, '買い物リスト'), el('p', {class: 'shopping-subtitle'}, `${project.title} · ${project.participants}人 · ${mode === 'minPrice' ? '最安' : '余り最少'}`));
  project.items.forEach((item, i) => {
    const result = results.items[i], plan = result[mode];
    const row = el('div', {class: 'shopping-item'}, el('h4', {}, item.name));
    plan.counts.forEach((count, j) => { if (count) row.append(el('div', {class: 'shopping-line'}, el('span', {}, `${item.packs[j].label} × ${count}`), el('strong', {}, yen(count * item.packs[j].price)))); });
    if (!plan.packCount) row.append(el('div', {class: 'shopping-line'}, '手持ち在庫で足ります', el('strong', {}, '0円')));
    row.append(el('div', {class: 'shopping-meta'}, `購入 ${plan.quantity}${item.unit} / 購入分の余り ${plan.surplus}${item.unit}`, el('br'), `在庫残り ${Math.max(0, item.stock - result.required)}${item.unit} · 必要 ${result.required}${item.unit}`)); shopping.append(row);
  });
  shopping.append(el('div', {class: 'shopping-total'}, '税込合計', el('strong', {}, yen(results.totals[mode]))), el('button', {class: 'download-list', id: 'download-list', onclick: () => download(shoppingText(results), 'packmix-shopping-list.txt', 'text/plain;charset=utf-8')}, '買い物リストを保存 ↓'), el('button', {class: 'print-list', onclick: () => window.print()}, 'このリストを印刷する'), el('p', {class: 'shopping-disclaimer'}, '送料・クーポン・セット割は含みません。入力候補内の最適解です。購入前に価格・在庫を確認してください。'));
  $('#results').replaceChildren(comparison, el('p', {class: 'delta-note'}, delta ? `余りを最少にするための差額は、合計 ${yen(delta)}。品目ごとの余りはリストで確認できます。` : 'どちらの方針でも合計金額は同じです。'), shopping);
  renderThresholds();
  if (focusedMode) restoreFocus({mode: focusedMode});
}
function renderThresholds() {
  $('#thresholds').replaceChildren(...project.items.map(item => {
    const cacheKey = JSON.stringify([item.perPerson, item.stock, item.packs.map(p => [p.quantity, p.price])]);
    let ranges = thresholdCache.get(cacheKey);
    if (!ranges) { ranges = participantThresholds(item); if (thresholdCache.size > 25) thresholdCache.clear(); thresholdCache.set(cacheKey, ranges); }
    const current = ranges.findIndex(r => r.from <= project.participants && project.participants <= r.to);
    const range = ranges[current], next = ranges[current + 1];
    const createTable = () => el('table', {class: 'threshold-table'}, el('thead', {}, el('tr', {}, el('th', {}, '人数'), el('th', {}, '最安'), el('th', {}, '余り最少'))), el('tbody', {}, ranges.map((r, i) => el('tr', {class: i === current ? 'current' : undefined}, el('td', {}, `${r.from}〜${r.to}人`), el('td', {}, mix(item, r.minPrice), el('br'), yen(r.minPrice.cost)), el('td', {}, mix(item, r.minSurplus), el('br'), yen(r.minSurplus.cost))))));
    return el('article', {class: 'threshold-item'}, el('div', {class: 'threshold-heading'}, el('h3', {}, item.name), el('span', {class: 'threshold-pill'}, `今の組み合わせ: ${range.from}〜${range.to}人`)), el('p', {class: 'threshold-description'}, next ? `次は ${next.from}人で組み合わせが変わります。最安: ${yen(next.minPrice.cost)} / 余り最少: ${yen(next.minSurplus.cost)}` : '500人まで、この組み合わせは変わりません。'), el('details', {ontoggle: event => { const details = event.currentTarget; if (details.open && !details.querySelector('table')) details.append(el('div', {class: 'table-scroll'}, createTable())); }}, el('summary', {}, `すべての境目を見る (${ranges.length}区間)`)));
  }));
}
function renderAll() { const savedFocus = rememberFocus(); valid = true; thresholdCache.clear(); $('#export').disabled = false; renderEditor(); renderResults(); setStatus(''); restoreFocus(savedFocus); }
$('#items').addEventListener('input', () => update()); $('#participants').addEventListener('input', () => update()); $('#title').addEventListener('input', () => update());
$('#minus').addEventListener('click', () => { if (!acceptDraft()) return; project.participants = Math.max(0, project.participants - 1); $('#participants').value = project.participants; update(); });
$('#plus').addEventListener('click', () => { if (!acceptDraft()) return; project.participants = Math.min(500, project.participants + 1); $('#participants').value = project.participants; update(); });
$('#add-item').addEventListener('click', () => { if (!acceptDraft() || project.items.length >= 5) return; project.items.push({id: `item${Date.now()}_${serial++}`, name: '新しい備品', unit: '個', perPerson: 1, stock: 0, packs: [{id: 'first', label: '10個パック', quantity: 10, price: 300}]}); renderAll(); });
$('#export').addEventListener('click', () => { if (acceptDraft()) { download(JSON.stringify(project, null, 2), 'packmix-plan.json', 'application/json'); setStatus('計画をJSONファイルとして保存しました。'); } });
$('#demo').addEventListener('click', () => { if (window.confirm('現在の入力を、架空のデモ計画に置き換えますか？')) { project = demoProject(); mode = 'minPrice'; renderAll(); } });
const dialog = $('#import-dialog');
$('#import').addEventListener('click', () => { $('#import-file').value = ''; $('#import-error').textContent = ''; dialog.showModal(); });
$('#close-import').addEventListener('click', () => dialog.close()); $('#cancel-import').addEventListener('click', () => dialog.close());
let importGeneration = 0;
dialog.addEventListener('close', () => { importGeneration++; });
$('#import-file').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  const generation = ++importGeneration;
  try {
    if (file.size > LIMITS.bytes) throw new Error('JSONは64 KiB以下にしてください');
    const parsed = parseProject(await file.text());
    if (generation !== importGeneration || !dialog.open) return;
    project = parsed; renderAll(); dialog.close(); setStatus('計画を読み込みました。');
  } catch (error) { if (generation === importGeneration && dialog.open) $('#import-error').textContent = error.message; }
});
renderAll();
