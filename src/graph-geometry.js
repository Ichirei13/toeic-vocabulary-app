// 文法グラフの画面幾何（カメラ・見える範囲・当たり判定）。DOM にも保存にも触れない純関数。
//
// カメラの規約:
//   Camera = { x, y, scale }
//   画面座標 = ワールド座標 * scale + (x, y)    （x, y は画面ピクセル単位の平行移動）
//   つまり ワールド原点が画面の (x, y) に出る。scale は「ワールド 1 単位が何 CSS ピクセルか」。
//   画面座標は CSS ピクセル、原点は左上、y は下向き。ワールドも y は下向き（グラフの y をそのまま使う）。
//   この形にすると worldToScreen / screenToWorld / panBy が画面の幅・高さを知らずに済む。
//   カメラ関数はすべて純関数で、新しいオブジェクトを返し、入力を書き換えない。
//   不正な入力（NaN など）では例外を出さず、カメラは変えない／空・-1 を返す。
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else Object.assign(root.StudyCore = root.StudyCore || {}, api);
})(typeof self !== 'undefined' ? self : this, function () {
  const FIT_MARGIN = 0.08;       // 全体表示のとき、各辺に空ける余白（画面の割合）
  const ORDER_EPS = 1e-9;        // order をタイブレークに使う「ほぼ同距離」の幅

  const isNum = v => typeof v === 'number' && Number.isFinite(v);
  const copy = cam => ({ x: cam.x, y: cam.y, scale: cam.scale });
  const camOk = cam => !!cam && isNum(cam.x) && isNum(cam.y) && isNum(cam.scale);

  // 外接矩形 bounds = { minX, maxX, minY, maxY } がちょうど余白つきで収まり、中央に来るカメラ。
  function createCamera(width, height, bounds) {
    const w = isNum(width) && width > 0 ? width : 0;
    const h = isNum(height) && height > 0 ? height : 0;
    const b = bounds || {};
    const ok = isNum(b.minX) && isNum(b.maxX) && isNum(b.minY) && isNum(b.maxY);
    const minX = ok ? Math.min(b.minX, b.maxX) : 0;
    const maxX = ok ? Math.max(b.minX, b.maxX) : 0;
    const minY = ok ? Math.min(b.minY, b.maxY) : 0;
    const maxY = ok ? Math.max(b.minY, b.maxY) : 0;
    const bw = maxX - minX, bh = maxY - minY;
    const k = 1 - 2 * FIT_MARGIN;
    let scale = Infinity;
    if (bw > 0) scale = Math.min(scale, (w * k) / bw);
    if (bh > 0) scale = Math.min(scale, (h * k) / bh);
    if (!isNum(scale) || scale <= 0) scale = 1; // 点だけ／画面が 0／不正な bounds
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return { x: w / 2 - cx * scale, y: h / 2 - cy * scale, scale };
  }

  function worldToScreen(cam, wx, wy) {
    return [wx * cam.scale + cam.x, wy * cam.scale + cam.y];
  }

  function screenToWorld(cam, sx, sy) {
    return [(sx - cam.x) / cam.scale, (sy - cam.y) / cam.scale];
  }

  // 画面の (sx, sy) の下にあるワールド点を動かさずに factor 倍する。
  // limits = { min, max } の範囲に倍率を収める（収まらなくても点は固定のまま）。
  // factor が 0 以下・NaN・無限大、座標が NaN ならカメラは変えない。
  function zoomAt(cam, sx, sy, factor, limits) {
    if (!camOk(cam) || cam.scale <= 0) return copy(cam || { x: 0, y: 0, scale: 1 });
    if (!isNum(sx) || !isNum(sy) || !isNum(factor) || factor <= 0) return copy(cam);
    let s = cam.scale * factor;
    if (limits) {
      if (isNum(limits.min) && s < limits.min) s = limits.min;
      if (isNum(limits.max) && s > limits.max) s = limits.max;
    }
    if (!isNum(s) || s <= 0) return copy(cam);
    const wx = (sx - cam.x) / cam.scale;
    const wy = (sy - cam.y) / cam.scale;
    return { x: sx - wx * s, y: sy - wy * s, scale: s };
  }

  // 画面ピクセルの差分 (dx, dy) だけ内容を動かす（右にドラッグすれば内容は右へ）。NaN の成分は 0 扱い。
  function panBy(cam, dx, dy) {
    return { x: cam.x + (isNum(dx) ? dx : 0), y: cam.y + (isNum(dy) ? dy : 0), scale: cam.scale };
  }

  // 画面（0..width, 0..height）を四方に margin ピクセル広げた範囲に入るノードの添字（昇順、境界を含む）。
  function visibleIndices(xs, ys, cam, width, height, margin) {
    const n = Math.min(xs ? xs.length : 0, ys ? ys.length : 0);
    if (!n || !camOk(cam) || cam.scale <= 0 || !isNum(width) || !isNum(height)) return new Int32Array(0);
    const m = isNum(margin) && margin > 0 ? margin : 0;
    const s = cam.scale, ox = cam.x, oy = cam.y;
    const x0 = -m, x1 = width + m, y0 = -m, y1 = height + m;
    const out = new Int32Array(n);
    let k = 0;
    for (let i = 0; i < n; i++) {
      const sx = xs[i] * s + ox;
      if (!(sx >= x0 && sx <= x1)) continue; // NaN もここで落ちる
      const sy = ys[i] * s + oy;
      if (sy >= y0 && sy <= y1) out[k++] = i;
    }
    return out.slice(0, k);
  }

  // 当たり判定用の格子。cellSize 四方のセルごとにノード添字（昇順）を持つ。
  // Grid = { cellSize, minCx, minCy, cols, cells: Map(key -> number[]) }
  //   key = (cy - minCy) * cols + (cx - minCx)  （セルの範囲内で一意。衝突しない）
  // 座標が有限でないノードは入れない。cellSize が不正なら 1。
  function buildGrid(xs, ys, cellSize) {
    const cs = isNum(cellSize) && cellSize > 0 ? cellSize : 1;
    const n = Math.min(xs ? xs.length : 0, ys ? ys.length : 0);
    let minCx = Infinity, maxCx = -Infinity, minCy = Infinity, maxCy = -Infinity;
    for (let i = 0; i < n; i++) {
      if (!isNum(xs[i]) || !isNum(ys[i])) continue;
      const cx = Math.floor(xs[i] / cs), cy = Math.floor(ys[i] / cs);
      if (cx < minCx) minCx = cx;
      if (cx > maxCx) maxCx = cx;
      if (cy < minCy) minCy = cy;
      if (cy > maxCy) maxCy = cy;
    }
    const cells = new Map();
    if (minCx === Infinity) return { cellSize: cs, minCx: 0, minCy: 0, cols: 0, rows: 0, cells };
    const cols = maxCx - minCx + 1, rows = maxCy - minCy + 1;
    for (let i = 0; i < n; i++) {
      if (!isNum(xs[i]) || !isNum(ys[i])) continue;
      const key = (Math.floor(ys[i] / cs) - minCy) * cols + (Math.floor(xs[i] / cs) - minCx);
      const list = cells.get(key);
      if (list) list.push(i); else cells.set(key, [i]);
    }
    return { cellSize: cs, minCx, minCy, cols, rows, cells };
  }

  // ワールド座標 (wx, wy) から radiusWorld 以内にある中心のうち、最も近いノードの添字。なければ -1。
  //   - 半径ちょうどは当たり。radiusWorld < 0 や NaN は -1。
  //   - 同じ距離（order なしのときは厳密に等しい距離）なら添字が小さい方。
  //   - order（添字 → 優先度。Int32Array や配列）を渡すと、最短距離から ORDER_EPS(1e-9) 以内の
  //     ノードどうしに限り、order の値が大きい方を優先する（それも同じなら添字が小さい方）。
  //     距離が明確に違うときは order を見ない（重なったら中心が近い方、が基本）。
  //   - radiusWorld はセルより大きくてもよい。半径が届くセルだけを見る（格子より広ければ全セル）。
  function hitTest(grid, xs, ys, wx, wy, radiusWorld, order) {
    if (!grid || !grid.cells || !grid.cells.size) return -1;
    if (!isNum(wx) || !isNum(wy) || !isNum(radiusWorld) || radiusWorld < 0) return -1;
    const cs = grid.cellSize;
    const r2 = radiusWorld * radiusWorld;

    // 半径が届くセルの範囲（格子の範囲に切り詰める）
    const cx0 = Math.max(Math.floor((wx - radiusWorld) / cs), grid.minCx);
    const cx1 = Math.min(Math.floor((wx + radiusWorld) / cs), grid.minCx + grid.cols - 1);
    const cy0 = Math.max(Math.floor((wy - radiusWorld) / cs), grid.minCy);
    const cy1 = Math.min(Math.floor((wy + radiusWorld) / cs), grid.minCy + grid.rows - 1);
    if (cx0 > cx1 || cy0 > cy1) return -1;

    const span = (cx1 - cx0 + 1) * (cy1 - cy0 + 1);
    const eps = order ? ORDER_EPS : 0;

    // 1 回目: 半径内の最短距離を求める。2 回目: 最短距離から eps 以内で優先度が最も高いものを選ぶ。
    let bestD2 = Infinity;
    let best = -1;
    const scan = (pass, list) => {
      for (let j = 0; j < list.length; j++) {
        const i = list[j];
        const dx = xs[i] - wx, dy = ys[i] - wy;
        const d2 = dx * dx + dy * dy;
        if (!(d2 <= r2)) continue;
        if (pass === 0) {
          if (d2 < bestD2) bestD2 = d2;
        } else {
          if (Math.sqrt(d2) > Math.sqrt(bestD2) + eps) continue;
          if (best < 0) best = i;
          else if (order && order[i] > order[best]) best = i;
          else if (i < best && (!order || order[i] === order[best])) best = i;
        }
      }
    };
    const visit = pass => {
      if (span > grid.cells.size) {
        // 対象セルの数より登録セルが少ないなら、登録セルを直接なめる（巨大な半径でも速い）
        for (const [key, list] of grid.cells) {
          const cx = grid.minCx + (key % grid.cols), cy = grid.minCy + Math.floor(key / grid.cols);
          if (cx >= cx0 && cx <= cx1 && cy >= cy0 && cy <= cy1) scan(pass, list);
        }
      } else {
        for (let cy = cy0; cy <= cy1; cy++) {
          const row = (cy - grid.minCy) * grid.cols - grid.minCx;
          for (let cx = cx0; cx <= cx1; cx++) {
            const list = grid.cells.get(row + cx);
            if (list) scan(pass, list);
          }
        }
      }
    };
    visit(0);
    if (bestD2 === Infinity) return -1;
    visit(1);
    return best;
  }

  return { createCamera, worldToScreen, screenToWorld, zoomAt, panBy, visibleIndices, buildGrid, hitTest };
});
