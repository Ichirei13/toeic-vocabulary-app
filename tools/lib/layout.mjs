// モデル（座標なし）→ 座標。Node 上の d3-force で、種つき乱数と固定の tick 数により、
// 同じ入力から同じ出力になる。出力は整数に丸めた { x: number[], y: number[] }。
// d3-force は tools/node_modules にある（アプリには含めない）。
import {
  forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY, forceCenter,
} from 'd3-force';
import { LAYOUT } from './layout-config.mjs';

// 32bit の種から [0,1) の乱数列を作る（mulberry32）。
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function layout(model, config = LAYOUT) {
  const n = model.id.length;
  const kindName = model.kind.map(k => model.kinds[k]);

  // 各ノードの本（親エッジをたどる）。概念・Trap は本を持たない（'' = 本の間のハブ）
  const parent = new Array(n).fill(-1);
  for (const [a, b, t] of model.edges) if (t === 0) parent[b] = a;
  const bookOf = new Array(n).fill('');
  for (let i = 0; i < n; i++) {
    if (kindName[i] === 'concept' || kindName[i] === 'trap') continue;
    let j = i;
    while (parent[j] !== -1) j = parent[j];
    bookOf[i] = model.id[j].startsWith('book:') ? model.id[j].slice(5) : '';
  }

  const rand = mulberry32(config.seed);
  const place = new Map(); // 本 → 本の中心
  const nodes = model.id.map((_, i) => {
    const anchor = bookOf[i] ? (config.anchors[bookOf[i]] || [0, 0]) : [0, 0];
    const r = (bookOf[i] ? config.startRadius : config.hubStartRadius) * Math.sqrt(rand());
    const th = rand() * 2 * Math.PI;
    place.set(i, anchor);
    return { index: i, x: anchor[0] + r * Math.cos(th), y: anchor[1] + r * Math.sin(th) };
  });

  const links = model.edges.map(([a, b, t]) => ({ source: a, target: b, type: t }));
  const linkForce = forceLink(links)
    .id(d => d.index)
    .strength(l => (l.type === 0 ? config.parentStrength : l.type === 1 ? config.conceptStrength : config.trapStrength))
    .distance(l => (l.type === 0
      ? config.parentDistance[kindName[l.target]] ?? 30
      : config.linkDistance[kindName[l.target]] ?? 200));

  const pullX = forceX(d => place.get(d.index)[0]).strength(d => (bookOf[d.index] ? config.anchorStrength : config.hubStrength));
  const pullY = forceY(d => place.get(d.index)[1]).strength(d => (bookOf[d.index] ? config.anchorStrength : config.hubStrength));

  const sim = forceSimulation(nodes)
    .randomSource(mulberry32(config.seed + 1))
    .stop()
    .alphaMin(0.001)
    .alphaDecay(1 - Math.pow(0.001, 1 / config.ticks))
    .force('link', linkForce)
    .force('charge', forceManyBody().strength(d => config.charge[kindName[d.index]]).distanceMax(config.chargeDistanceMax))
    .force('x', pullX)
    .force('y', pullY)
    .force('collide', forceCollide(d => config.collideRadius[kindName[d.index]]).strength(config.collideStrength).iterations(2))
    .force('center', forceCenter(0, 0));
  for (let t = 0; t < config.ticks; t++) sim.tick();

  // 整数に丸める。丸めで同じ座標になった組は、決まった順に 1 ずつずらして重ならないようにする
  const x = new Array(n), y = new Array(n);
  const used = new Set();
  for (let i = 0; i < n; i++) {
    let px = Math.round(nodes[i].x) + 0, py = Math.round(nodes[i].y) + 0; // + 0 で -0 を 0 にする
    if (!Number.isFinite(px) || !Number.isFinite(py)) throw new Error('座標が有限ではありません: ' + model.id[i]);
    while (used.has(px + ',' + py)) px += 1;
    used.add(px + ',' + py);
    x[i] = px; y[i] = py;
  }
  return { x, y };
}
