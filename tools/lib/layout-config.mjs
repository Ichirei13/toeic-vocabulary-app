// 配置の調整値。実体は src/graph-force.js（アプリの実行時の力学と共有するため）。調整はそちらで行う。
import { createRequire } from 'node:module';

export const LAYOUT = createRequire(import.meta.url)('../../src/graph-force.js').GRAPH_LAYOUT;
