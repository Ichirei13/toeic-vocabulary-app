// モデル（座標なし）→ 座標。Node 上の d3-force で、種つき乱数と固定の tick 数により、
// 同じ入力から同じ出力になる。出力は整数に丸めた { x: number[], y: number[] }。
// 力の定義は src/graph-force.js（アプリの実行時の力学と共有）。d3-force は tools/node_modules にある。
import * as d3 from 'd3-force';
import { createRequire } from 'node:module';
import { LAYOUT } from './layout-config.mjs';

const GF = createRequire(import.meta.url)('../../src/graph-force.js');
export const mulberry32 = GF.mulberry32;

export function layout(model, config = LAYOUT) {
  const n = model.id.length;
  const kindName = model.kind.map(k => model.kinds[k]);
  const edges = model.edges.flat();
  const bookOf = GF.bookOfNodes(model.id, kindName, edges);

  // 初期位置: 本の中心（概念・Trap は原点）のまわりに、種つきの乱数でばらまく
  const rand = GF.mulberry32(config.seed);
  const x0 = new Array(n), y0 = new Array(n);
  for (let i = 0; i < n; i++) {
    const anchor = bookOf[i] ? (config.anchors[bookOf[i]] || [0, 0]) : [0, 0];
    const r = (bookOf[i] ? config.startRadius : config.hubStartRadius) * Math.sqrt(rand());
    const th = rand() * 2 * Math.PI;
    x0[i] = anchor[0] + r * Math.cos(th);
    y0[i] = anchor[1] + r * Math.sin(th);
  }

  const { sim, nodes } = GF.createSimulation(d3, { kindName, edges, bookOf, x: x0, y: y0 }, config, null);
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
