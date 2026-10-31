// 複数のファイルから使う小さな関数。他のファイルの最上位コードからも呼ばれるので、最初に読み込む

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
