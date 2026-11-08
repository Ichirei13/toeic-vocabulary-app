// 配置の調整値（調整はこのファイルだけで行う）。layout.mjs が読む。
// 座標系: 原点が中央、x は右、y は下。単位は任意（描画側で拡大縮小する）。
export const LAYOUT = {
  seed: 20261108,
  ticks: 400,            // 固定の tick 数（収束を待たない。同じ入力から同じ出力にするため）
  // リンクの強さ（forceLink）。親子は強く、概念・Trap は弱く
  parentStrength: 0.9,
  conceptStrength: 0.02,
  trapStrength: 0.02,
  // 親子リンクの目標距離（子の種類ごと）。概念・Trap のリンクの距離は linkDistance 側
  parentDistance: { chapter: 95, rule: 28, question: 14 },
  linkDistance: { concept: 220, trap: 220 },
  // 反発（forceManyBody）の強さ（負の値）。種類ごと
  charge: { book: -600, chapter: -260, rule: -34, concept: -700, trap: -700, question: -7 },
  chargeDistanceMax: 500,
  // 衝突半径（forceCollide）。種類ごと
  collideRadius: { book: 30, chapter: 20, rule: 7, concept: 30, trap: 28, question: 3.4 },
  collideStrength: 0.9,
  // 本ごとの塊の中心。概念・Trap は原点（本の間）に引き寄せる
  anchors: { kin: [-480, -280], sekai: [480, -280], polaris2: [-480, 320], toplevel: [480, 320] },
  anchorStrength: 0.13,  // 本の配下のノードを本の中心へ引く強さ
  hubStrength: 0.10,     // 概念・Trap を原点へ引く強さ
  startRadius: 150,      // 初期位置のばらつき（本の中心のまわり）
  hubStartRadius: 60,    // 概念・Trap の初期位置のばらつき（原点のまわり）
};
