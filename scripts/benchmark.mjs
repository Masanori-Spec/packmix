import {performance} from 'node:perf_hooks';
import os from 'node:os';
import {calculateProject, participantThresholds} from '../src/optimizer.mjs';
import {demoProject} from '../src/demo.mjs';
const worst = {version: 1, title: 'Declared limit', participants: 500, items: Array.from({length: 5}, (_, i) => ({id: `item${i}`, name: 'Synthetic', unit: '個', perPerson: 20, stock: 0, packs: [1, 17, 97, 233, 499, 1000].map((q, j) => ({id: `p${j}`, label: `Pack ${q}`, quantity: q, price: [1000000, 899, 3999, 8900, 18000, 35000][j]}))}))};
function bench(name, project) {
  const samples = [];
  for (let i = 0; i < 55; i++) { const start = performance.now(); calculateProject(project); for (const item of project.items) participantThresholds(item, 0, 500); const elapsed = performance.now() - start; if (i >= 5) samples.push(elapsed); }
  samples.sort((a, b) => a - b);
  return {name, samples: samples.length, medianMs: +samples[25].toFixed(2), p95Ms: +samples[47].toFixed(2), maxMs: +samples.at(-1).toFixed(2), targetMs: 200, targetMet: samples[47] < 200};
}
console.log(JSON.stringify({measuredAt: new Date().toISOString(), node: process.version, platform: `${os.platform()} ${os.arch()}`, cpu: os.cpus()[0]?.model, scope: 'Synchronous calculation + full 0..500 participant thresholds for each item, excluding DOM/render and I/O. 5 warmups then 50 samples.', results: [bench('demo: 2 items, 32 people', demoProject()), bench('limits: 5 items, 6 candidates, 500 people × 20 units, 1000-pack maximum', worst)]}, null, 2));
