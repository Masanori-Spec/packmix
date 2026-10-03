export function demoProject() {
  return {version: 1, title: '週末ワークショップ', participants: 32, items: [
    {id: 'badge', name: '名札カード', unit: '枚', perPerson: 1, stock: 0, packs: [
      {id: 'small', label: '12枚パック', quantity: 12, price: 400},
      {id: 'medium', label: '20枚パック', quantity: 20, price: 500},
      {id: 'large', label: '50枚パック', quantity: 50, price: 800}
    ]},
    {id: 'pen', name: '水性ペン', unit: '本', perPerson: 1, stock: 8, packs: [
      {id: 'six', label: '6本セット', quantity: 6, price: 420},
      {id: 'ten', label: '10本セット', quantity: 10, price: 650}
    ]}
  ]};
}
