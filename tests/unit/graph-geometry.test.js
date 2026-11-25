const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const G = require('../../src/graph-geometry.js');

const near = (a, b, eps = 1e-9) =>
  assert.ok(Math.abs(a - b) <= eps, `expected ${a} ≈ ${b}`);

// 決定的な乱数（mulberry32）
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const W = 400, H = 300;
const BOUNDS = { minX: -673, maxX: 709, minY: -608, maxY: 479 };
const LIMITS = { min: 0.1, max: 8 };

// ---- カメラ ----

test('worldToScreen / screenToWorld: 往復で元に戻る・向きが正しい', () => {
  const cam = { x: 120, y: -40, scale: 2.5 };
  const [sx, sy] = G.worldToScreen(cam, 10, 20);
  assert.deepStrictEqual([sx, sy], [145, 10]);
  const [wx, wy] = G.screenToWorld(cam, sx, sy);
  near(wx, 10); near(wy, 20);
  const rnd = rng(1);
  for (let i = 0; i < 200; i++) {
    const c = { x: rnd() * 800 - 400, y: rnd() * 800 - 400, scale: 0.05 + rnd() * 10 };
    const px = rnd() * 2000 - 1000, py = rnd() * 2000 - 1000;
    const [qx, qy] = G.worldToScreen(c, px, py);
    const [rx, ry] = G.screenToWorld(c, qx, qy);
    near(rx, px, 1e-7); near(ry, py, 1e-7);
  }
});

test('createCamera: 外接矩形全体が余白つきで収まり、中心が画面中央に来る', () => {
  const cam = G.createCamera(W, H, BOUNDS);
  assert.ok(cam.scale > 0);
  const corners = [
    [BOUNDS.minX, BOUNDS.minY], [BOUNDS.maxX, BOUNDS.minY],
    [BOUNDS.minX, BOUNDS.maxY], [BOUNDS.maxX, BOUNDS.maxY],
  ];
  for (const [wx, wy] of corners) {
    const [sx, sy] = G.worldToScreen(cam, wx, wy);
    assert.ok(sx > 0 && sx < W, `sx=${sx}`);
    assert.ok(sy > 0 && sy < H, `sy=${sy}`);
  }
  // 余白がある（ぎりぎりではない）
  const [l] = G.worldToScreen(cam, BOUNDS.minX, 0);
  const [r] = G.worldToScreen(cam, BOUNDS.maxX, 0);
  const [, t] = G.worldToScreen(cam, 0, BOUNDS.minY);
  const [, b] = G.worldToScreen(cam, 0, BOUNDS.maxY);
  assert.ok(l > 0 && W - r > 0 && t > 0 && H - b > 0);
  // 長い方向がほぼ画面いっぱい（無駄に小さくない）
  assert.ok(Math.max(r - l, b - t) > 0.8 * Math.min(W, H) - 1);
  // 中心
  const [cx, cy] = G.worldToScreen(cam, (BOUNDS.minX + BOUNDS.maxX) / 2, (BOUNDS.minY + BOUNDS.maxY) / 2);
  near(cx, W / 2); near(cy, H / 2);
});

test('createCamera: 縦長・横長の画面でも収まる / 退化した入力でも例外なし', () => {
  for (const [w, h] of [[300, 900], [900, 300], [1, 1]]) {
    const cam = G.createCamera(w, h, BOUNDS);
    const [sx0, sy0] = G.worldToScreen(cam, BOUNDS.minX, BOUNDS.minY);
    const [sx1, sy1] = G.worldToScreen(cam, BOUNDS.maxX, BOUNDS.maxY);
    assert.ok(sx0 >= 0 && sy0 >= 0 && sx1 <= w && sy1 <= h, `${w}x${h}`);
  }
  // 点だけの bounds / 幅 0 / NaN
  for (const args of [
    [W, H, { minX: 5, maxX: 5, minY: 5, maxY: 5 }],
    [0, 0, BOUNDS],
    [W, H, { minX: NaN, maxX: 1, minY: 0, maxY: 1 }],
    [W, H, null],
    [W, H, undefined],
  ]) {
    const cam = G.createCamera(...args);
    assert.ok(Number.isFinite(cam.x) && Number.isFinite(cam.y));
    assert.ok(Number.isFinite(cam.scale) && cam.scale > 0);
  }
});

test('zoomAt: 指の下のワールド座標が動かない', () => {
  const rnd = rng(2);
  for (let i = 0; i < 200; i++) {
    const cam = { x: rnd() * 400 - 200, y: rnd() * 400 - 200, scale: 0.2 + rnd() * 3 };
    const sx = rnd() * W, sy = rnd() * H;
    const f = 0.3 + rnd() * 3;
    const [wx0, wy0] = G.screenToWorld(cam, sx, sy);
    const z = G.zoomAt(cam, sx, sy, f, LIMITS);
    const [wx1, wy1] = G.screenToWorld(z, sx, sy);
    near(wx1, wx0, 1e-7); near(wy1, wy0, 1e-7);
  }
});

test('zoomAt: 倍率が factor 倍になる / 上限・下限で止まる（止まっても指の下は固定）', () => {
  const cam = { x: 10, y: 20, scale: 1 };
  near(G.zoomAt(cam, 100, 100, 2, LIMITS).scale, 2);
  const up = G.zoomAt({ x: 10, y: 20, scale: 7 }, 50, 60, 5, LIMITS);
  assert.strictEqual(up.scale, LIMITS.max);
  const down = G.zoomAt({ x: 10, y: 20, scale: 0.15 }, 50, 60, 0.1, LIMITS);
  assert.strictEqual(down.scale, LIMITS.min);
  // クランプされても点は固定
  for (const [c, f] of [[{ x: 10, y: 20, scale: 7 }, 5], [{ x: 10, y: 20, scale: 0.15 }, 0.1]]) {
    const [a, b] = G.screenToWorld(c, 50, 60);
    const z = G.zoomAt(c, 50, 60, f, LIMITS);
    const [a2, b2] = G.screenToWorld(z, 50, 60);
    near(a2, a, 1e-7); near(b2, b, 1e-7);
  }
  // すでに上限にいてさらに拡大 → 何も動かない
  const atMax = { x: 3, y: 4, scale: LIMITS.max };
  assert.deepStrictEqual(G.zoomAt(atMax, 77, 88, 2, LIMITS), atMax);
});

test('zoomAt: factor が 0 以下・NaN・座標が NaN ならカメラは変わらない（新しいオブジェクト）', () => {
  const cam = { x: 10, y: 20, scale: 1.5 };
  for (const [sx, sy, f] of [[5, 5, 0], [5, 5, -2], [5, 5, NaN], [NaN, 5, 2], [5, NaN, 2], [5, 5, Infinity]]) {
    const z = G.zoomAt(cam, sx, sy, f, LIMITS);
    assert.deepStrictEqual(z, cam);
    assert.notStrictEqual(z, cam);
  }
  // limits なしでも例外なし
  near(G.zoomAt(cam, 0, 0, 2).scale, 3);
});

test('panBy: ドラッグした向きに内容が動く', () => {
  const cam = { x: 10, y: 20, scale: 2 };
  const p = G.panBy(cam, 30, -15);
  assert.deepStrictEqual(p, { x: 40, y: 5, scale: 2 });
  const [sx0, sy0] = G.worldToScreen(cam, 7, 9);
  const [sx1, sy1] = G.worldToScreen(p, 7, 9);
  near(sx1 - sx0, 30); near(sy1 - sy0, -15);
  // NaN は無視
  assert.deepStrictEqual(G.panBy(cam, NaN, 5), { x: 10, y: 25, scale: 2 });
});

test('カメラ関数は入力を書き換えない（凍結オブジェクトでも動く）', () => {
  const cam = Object.freeze({ x: 1, y: 2, scale: 1 });
  assert.doesNotThrow(() => G.zoomAt(cam, 10, 10, 2, LIMITS));
  assert.doesNotThrow(() => G.panBy(cam, 5, 5));
  assert.deepStrictEqual(cam, { x: 1, y: 2, scale: 1 });
});

// ---- 見える範囲 ----

test('visibleIndices: 画面内だけ。境界は含み、margin で広がる', () => {
  const cam = { x: 0, y: 0, scale: 1 }; // ワールド = 画面
  const xs = [-1, 0, 10, 400, 401, 200, 200, 200, -50];
  const ys = [10, 10, 10, 10, 10, -1, 300, 301, 10];
  const v0 = Array.from(G.visibleIndices(xs, ys, cam, W, H, 0));
  assert.deepStrictEqual(v0, [1, 2, 3, 6]);
  const v10 = Array.from(G.visibleIndices(xs, ys, cam, W, H, 10));
  assert.deepStrictEqual(v10, [0, 1, 2, 3, 4, 5, 6, 7]);
  const v60 = Array.from(G.visibleIndices(xs, ys, cam, W, H, 60));
  assert.deepStrictEqual(v60, [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok(G.visibleIndices(xs, ys, cam, W, H, 0) instanceof Int32Array);
});

test('visibleIndices: カメラの移動・拡大が反映される', () => {
  const xs = [0, 100, 1000];
  const ys = [0, 0, 0];
  // scale 2: 画面 400px は世界 200 単位。中心 (0,0)
  const cam = { x: W / 2, y: H / 2, scale: 2 };
  assert.deepStrictEqual(Array.from(G.visibleIndices(xs, ys, cam, W, H, 0)), [0, 1]);
  const panned = G.panBy(cam, -2000, 0); // 内容を左へ → 1000 が見える
  assert.deepStrictEqual(Array.from(G.visibleIndices(xs, ys, panned, W, H, 0)), [2]);
});

test('visibleIndices: 空配列・幅高さ 0・NaN で例外なし', () => {
  const cam = { x: 0, y: 0, scale: 1 };
  assert.strictEqual(G.visibleIndices([], [], cam, W, H, 0).length, 0);
  assert.strictEqual(G.visibleIndices(new Float64Array(0), new Float64Array(0), cam, W, H, 5).length, 0);
  assert.doesNotThrow(() => G.visibleIndices([1], [1], cam, 0, 0, 0));
  assert.deepStrictEqual(Array.from(G.visibleIndices([0, 5], [0, 5], cam, 0, 0, 0)), [0]);
  assert.strictEqual(G.visibleIndices([1], [1], cam, NaN, NaN, 0).length, 0);
  assert.strictEqual(G.visibleIndices([1], [1], { x: NaN, y: 0, scale: 1 }, W, H, 0).length, 0);
  assert.strictEqual(G.visibleIndices([NaN, 5], [5, 5], cam, W, H, 0).length, 1);
  assert.strictEqual(G.visibleIndices([1], [1], cam, W, H, NaN).length, 1); // margin NaN → 0 扱い
  assert.strictEqual(G.visibleIndices([-5], [1], cam, W, H, -10).length, 0); // 負の margin → 0 扱い
});

// ---- 当たり判定 ----

test('hitTest: 重なった 2 ノードの中間をタップすると中心が近い方', () => {
  const xs = [0, 4], ys = [0, 0];
  const grid = G.buildGrid(xs, ys, 10);
  assert.strictEqual(G.hitTest(grid, xs, ys, 1, 0, 20), 0);
  assert.strictEqual(G.hitTest(grid, xs, ys, 3, 0, 20), 1);
  assert.strictEqual(G.hitTest(grid, xs, ys, 2, 0, 20), 0); // 同距離 → 添字が小さい方
  assert.strictEqual(G.hitTest(grid, xs, ys, 2.0001, 0, 20), 1);
  // 完全に同じ位置
  const g2 = G.buildGrid([5, 5, 5], [5, 5, 5], 10);
  assert.strictEqual(G.hitTest(g2, [5, 5, 5], [5, 5, 5], 5, 5, 3), 0);
});

test('hitTest: 何もない場所と半径の外は -1、半径ちょうどは当たり', () => {
  const xs = [0, 100], ys = [0, 100];
  const grid = G.buildGrid(xs, ys, 10);
  assert.strictEqual(G.hitTest(grid, xs, ys, 50, 50, 10), -1);
  assert.strictEqual(G.hitTest(grid, xs, ys, 1000, -1000, 10), -1);
  assert.strictEqual(G.hitTest(grid, xs, ys, 11, 0, 10), -1);
  assert.strictEqual(G.hitTest(grid, xs, ys, 10, 0, 10), 0);
  assert.strictEqual(G.hitTest(grid, xs, ys, 7, 7, 10), 0); // 距離 9.9
  assert.strictEqual(G.hitTest(grid, xs, ys, 8, 8, 10), -1); // 距離 11.3（セルは同じでも半径の外）
});

test('hitTest: radius が cellSize より大きくても正しい（隣のセルより遠くまで探す）', () => {
  const xs = [0, 95], ys = [0, 0];
  const grid = G.buildGrid(xs, ys, 10);
  assert.strictEqual(G.hitTest(grid, xs, ys, 90, 0, 6), 1);
  assert.strictEqual(G.hitTest(grid, xs, ys, 50, 0, 46), 1); // 45 離れ、セル 4 個分
  assert.strictEqual(G.hitTest(grid, xs, ys, 50, 0, 44), -1);
  assert.strictEqual(G.hitTest(grid, xs, ys, 40, 0, 1e9), 0); // 巨大な半径でも固まらず、近い方
  // 負の座標・セル境界
  const xn = [-10, -0.0001, 10], yn = [-10, -0.0001, 10];
  const gn = G.buildGrid(xn, yn, 10);
  assert.strictEqual(G.hitTest(gn, xn, yn, -0.5, -0.5, 1), 1);
  assert.strictEqual(G.hitTest(gn, xn, yn, 10, 10, 0), 2);
  assert.strictEqual(G.hitTest(gn, xn, yn, -10, -10, 0), 0);
});

test('hitTest: order は距離がほぼ同じときだけのタイブレーク（大きい値が優先）', () => {
  const xs = [0, 0, 3], ys = [0, 0, 0];
  const grid = G.buildGrid(xs, ys, 10);
  // 0 と 1 は同位置。order が高い方が勝つ
  assert.strictEqual(G.hitTest(grid, xs, ys, 0, 0, 5, [1, 5, 0]), 1);
  assert.strictEqual(G.hitTest(grid, xs, ys, 0, 0, 5, [5, 1, 0]), 0);
  assert.strictEqual(G.hitTest(grid, xs, ys, 0, 0, 5, [3, 3, 9]), 0); // order も同じなら添字
  // 距離が明確に違えば order は無視される
  assert.strictEqual(G.hitTest(grid, xs, ys, 2.9, 0, 5, [0, 0, 0]), 2);
  assert.strictEqual(G.hitTest(grid, xs, ys, 2.9, 0, 5, [9, 9, 0]), 2);
  // 1e-9 以内の差は同距離扱い
  const xe = [0, 1e-10], ye = [0, 0];
  const ge = G.buildGrid(xe, ye, 10);
  assert.strictEqual(G.hitTest(ge, xe, ye, 0, 0, 5, [0, 1]), 1);
  assert.strictEqual(G.hitTest(ge, xe, ye, 0, 0, 5), 0); // order なしは厳密比較
  // Int32Array でも使える
  assert.strictEqual(G.hitTest(grid, xs, ys, 0, 0, 5, Int32Array.from([1, 5, 0])), 1);
});

test('buildGrid / hitTest: 空・不正入力で例外なし', () => {
  const g0 = G.buildGrid([], [], 10);
  assert.strictEqual(G.hitTest(g0, [], [], 0, 0, 10), -1);
  const xs = [1, NaN, 3], ys = [1, 2, NaN];
  for (const cs of [10, 0, -5, NaN, undefined]) {
    const g = G.buildGrid(xs, ys, cs);
    assert.strictEqual(G.hitTest(g, xs, ys, 1, 1, 1), 0);
    assert.strictEqual(G.hitTest(g, xs, ys, 3, 3, 1), -1); // NaN 座標のノードは当たらない
  }
  const g = G.buildGrid([1], [1], 10);
  for (const [wx, wy, r] of [[NaN, 1, 5], [1, NaN, 5], [1, 1, NaN], [1, 1, -1]]) {
    assert.strictEqual(G.hitTest(g, [1], [1], wx, wy, r), -1);
  }
  assert.strictEqual(G.hitTest(null, [1], [1], 1, 1, 5), -1);
});

test('buildGrid: 決定的（同じ入力 → 同じ結果）', () => {
  const rnd = rng(7);
  const xs = [], ys = [];
  for (let i = 0; i < 300; i++) { xs.push(Math.round(rnd() * 200)); ys.push(Math.round(rnd() * 200)); }
  const a = G.buildGrid(xs, ys, 12), b = G.buildGrid(xs, ys, 12);
  for (let k = 0; k < 500; k++) {
    const wx = rnd() * 200, wy = rnd() * 200;
    assert.strictEqual(G.hitTest(a, xs, ys, wx, wy, 9), G.hitTest(b, xs, ys, wx, wy, 9));
  }
});

// ---- 実データ ----

function loadReal() {
  const src = fs.readFileSync(path.join(__dirname, '../../data/grammar_graph.js'), 'utf8');
  return vm.runInNewContext(src + ';GRAMMAR_GRAPH');
}
const REAL = loadReal();

// 総当たりの基準実装（order なし：最近・同距離は小さい添字）
function bruteForce(xs, ys, wx, wy, r, order) {
  let best = -1, bestD = Infinity;
  const hits = [];
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - wx, dy = ys[i] - wy;
    if (dx * dx + dy * dy <= r * r) hits.push([i, Math.sqrt(dx * dx + dy * dy)]);
  }
  if (!hits.length) return -1;
  for (const [, d] of hits) if (d < bestD) bestD = d;
  const eps = order ? 1e-9 : 0;
  for (const [i, d] of hits) {
    if (d > bestD + eps) continue;
    if (best < 0 || (order && order[i] > order[best])) best = i;
  }
  return best;
}

test('実データ: hitTest は総当たりと完全に一致する（乱数点 2000 個 × 複数の半径）', () => {
  const xs = REAL.x, ys = REAL.y;
  assert.strictEqual(xs.length, 1210);
  const rnd = rng(20261108);
  const radii = [0, 0.5, 3, 8, 14, 30, 100, 400];
  const grids = [8, 14, 40].map(cs => G.buildGrid(xs, ys, cs));
  let hitCount = 0, missCount = 0;
  for (let k = 0; k < 2000; k++) {
    // 範囲より少し外側まで含めてばらまく。半分はノード付近を狙う
    let wx, wy;
    if (k % 2 === 0) { wx = -750 + rnd() * 1500; wy = -680 + rnd() * 1250; }
    else {
      const i = Math.floor(rnd() * xs.length);
      wx = xs[i] + (rnd() - 0.5) * 20; wy = ys[i] + (rnd() - 0.5) * 20;
    }
    const r = radii[k % radii.length];
    const want = bruteForce(xs, ys, wx, wy, r);
    for (const grid of grids) {
      const got = G.hitTest(grid, xs, ys, wx, wy, r);
      assert.strictEqual(got, want, `k=${k} r=${r} (${wx},${wy})`);
    }
    if (want >= 0) hitCount++; else missCount++;
  }
  assert.ok(hitCount > 300 && missCount > 300, `hit=${hitCount} miss=${missCount}`);
});

test('実データ: order つきでも総当たりと一致する（種別優先度）', () => {
  const xs = REAL.x, ys = REAL.y;
  const order = Int32Array.from(REAL.kind, k => k); // 種別番号をそのまま優先度に
  const grid = G.buildGrid(xs, ys, 14);
  const rnd = rng(99);
  for (let k = 0; k < 1000; k++) {
    const i = Math.floor(rnd() * xs.length);
    const wx = xs[i] + (rnd() - 0.5) * 6, wy = ys[i] + (rnd() - 0.5) * 6;
    const r = 5 + rnd() * 30;
    assert.strictEqual(G.hitTest(grid, xs, ys, wx, wy, r, order), bruteForce(xs, ys, wx, wy, r, order));
  }
});

test('実データ: ノード中心をタップすればそのノード（同座標の重なりがあれば同座標のどれか）', () => {
  const xs = REAL.x, ys = REAL.y;
  const grid = G.buildGrid(xs, ys, 14);
  for (let i = 0; i < xs.length; i++) {
    const got = G.hitTest(grid, xs, ys, xs[i], ys[i], 1);
    assert.ok(got >= 0);
    assert.strictEqual(xs[got], xs[i]);
    assert.strictEqual(ys[got], ys[i]);
    assert.ok(got <= i);
  }
});

test('実データ: visibleIndices は総当たりと一致し、全体表示なら全ノードが入る', () => {
  const xs = REAL.x, ys = REAL.y;
  const b = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (let i = 0; i < xs.length; i++) {
    b.minX = Math.min(b.minX, xs[i]); b.maxX = Math.max(b.maxX, xs[i]);
    b.minY = Math.min(b.minY, ys[i]); b.maxY = Math.max(b.maxY, ys[i]);
  }
  const fit = G.createCamera(W, H, b);
  assert.strictEqual(G.visibleIndices(xs, ys, fit, W, H, 0).length, xs.length);
  // ズームインした視点は総当たりと一致
  const rnd = rng(5);
  for (let k = 0; k < 50; k++) {
    let cam = G.zoomAt(fit, rnd() * W, rnd() * H, 1 + rnd() * 6, LIMITS);
    cam = G.panBy(cam, rnd() * 400 - 200, rnd() * 400 - 200);
    const margin = rnd() * 30;
    const got = Array.from(G.visibleIndices(xs, ys, cam, W, H, margin));
    const want = [];
    for (let i = 0; i < xs.length; i++) {
      const [sx, sy] = G.worldToScreen(cam, xs[i], ys[i]);
      if (sx >= -margin && sx <= W + margin && sy >= -margin && sy <= H + margin) want.push(i);
    }
    assert.deepStrictEqual(got, want);
  }
});

test('実データ: hitTest 1 回あたりの時間（目安 0.1ms 未満）', () => {
  const xs = REAL.x, ys = REAL.y;
  const grid = G.buildGrid(xs, ys, 14);
  const rnd = rng(3);
  const N = 20000;
  const pts = new Float64Array(N * 2);
  for (let i = 0; i < N; i++) { pts[2 * i] = -700 + rnd() * 1420; pts[2 * i + 1] = -620 + rnd() * 1110; }
  let sink = 0;
  for (let i = 0; i < 2000; i++) sink += G.hitTest(grid, xs, ys, pts[2 * i], pts[2 * i + 1], 20); // ウォームアップ
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) sink += G.hitTest(grid, xs, ys, pts[2 * i], pts[2 * i + 1], 20);
  const perCallMs = Number(process.hrtime.bigint() - t0) / 1e6 / N;
  console.log(`# hitTest: ${(perCallMs * 1000).toFixed(2)} µs/call (sink=${sink})`);
  assert.ok(perCallMs < 0.1, `${perCallMs} ms/call`);

  const tg = process.hrtime.bigint();
  for (let i = 0; i < 20; i++) G.buildGrid(xs, ys, 14);
  const buildMs = Number(process.hrtime.bigint() - tg) / 1e6 / 20;
  console.log(`# buildGrid: ${buildMs.toFixed(3)} ms`);
  assert.ok(buildMs < 20, `${buildMs} ms`);
});
