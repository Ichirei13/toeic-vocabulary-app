#!/usr/bin/env python3
"""動くポメラニアン SVG から、動きを減らす設定用の静止版 still/*.svg を作る。

ただ <style> を消すだけ（0% の初期位置）だと、拍手の手が離れていたり、
首かしげやジャンプ・ポンポン応援などの一番かわいい見せ場（キメポーズ）が
抜けてしまうため、各アニメーションのクライマックス位置（45%〜50% 等の見せ場フレーム、
ただし「まばたき」だけは目が開いた状態）を計算し、SVG 標準の transform 属性として
焼き込んだ静止画を生成する。

ポーズを足したり絵を直したりしたら、このスクリプトを実行し直す。
  python3 scripts/make-pomeranian-stills.py          # 書き出す
  python3 scripts/make-pomeranian-stills.py --check  # 最新か確かめる（ずれていたら終了コード 1）
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "assets" / "pomeranian"
STYLE_RE = re.compile(r"[ \t]*<style>(.*?)</style>[ \t]*\n?", re.DOTALL)
MEDIA_RE = re.compile(r"@media\s*\([^)]*\)\s*\{(?:[^{}]|\{[^{}]*\})*\}", re.DOTALL)
KEYFRAMES_RE = re.compile(r"@keyframes\s+([\w-]+)\s*\{((?:[^{}]|\{[^{}]*\})*)\}", re.DOTALL)
STOP_RE = re.compile(r"([0-9%,\s]+)\{([^}]*)\}")
RULE_RE = re.compile(r"\.([\w-]+)\s*\{([^}]*)\}")


def _fmt(n: float) -> str:
    if float(n).is_integer():
        return str(int(n))
    return f"{n:.2f}".rstrip("0").rstrip(".")


def _css_to_svg_transform(css_tf: str, origin, reverse: bool = False) -> str:
    ops = []
    for fn, arg in re.findall(r"([a-zA-Z]+)\(([^)]+)\)", css_tf):
        vals = [float(x) for x in re.findall(r"[-+]?\d*\.?\d+", arg)]
        if not vals:
            continue
        if reverse:
            if fn in ("rotate", "skewX", "translateX", "translateY", "translate"):
                vals = [-v for v in vals]
            elif fn == "scaleY" and len(vals) == 1:
                vals = [round(2.0 - vals[0], 3)]
            elif fn == "scaleX" and len(vals) == 1:
                vals = [round(2.0 - vals[0], 3)]
        if fn == "translateY":
            if vals[0] != 0:
                ops.append(("translate", (0.0, vals[0])))
        elif fn == "translateX":
            if vals[0] != 0:
                ops.append(("translate", (vals[0], 0.0)))
        elif fn == "translate":
            dx = vals[0]
            dy = vals[1] if len(vals) > 1 else 0.0
            if dx != 0 or dy != 0:
                ops.append(("translate", (dx, dy)))
        elif fn == "rotate":
            if vals[0] != 0:
                ops.append(("rotate", (vals[0],)))
        elif fn == "scale":
            sx = vals[0]
            sy = vals[1] if len(vals) > 1 else sx
            if sx != 1 or sy != 1:
                ops.append(("scale", (sx, sy)))
        elif fn == "scaleY":
            if vals[0] != 1:
                ops.append(("scale", (1.0, vals[0])))
        elif fn == "scaleX":
            if vals[0] != 1:
                ops.append(("scale", (vals[0], 1.0)))
        elif fn == "skewX":
            if vals[0] != 0:
                ops.append(("skewX", (vals[0],)))
    if not ops:
        return ""

    # 平行移動が連続する場合は 1 つの translate(dx dy) にまとめる
    merged = []
    for op, v in ops:
        if op == "translate" and merged and merged[-1][0] == "translate":
            px, py = merged[-1][1]
            nx, ny = px + v[0], py + v[1]
            if nx == 0 and ny == 0:
                merged.pop()
            else:
                merged[-1] = ("translate", (nx, ny))
        elif op == "scale" and merged and merged[-1][0] == "scale":
            psx, psy = merged[-1][1]
            nsx, nsy = round(psx * v[0], 4), round(psy * v[1], 4)
            merged[-1] = ("scale", (nsx, nsy))
        else:
            merged.append((op, v))
    if not merged:
        return ""

    def render_ops(items) -> str:
        out = []
        for op, v in items:
            if op == "translate":
                out.append(f"translate({_fmt(v[0])} {_fmt(v[1])})")
            elif op == "rotate":
                out.append(f"rotate({_fmt(v[0])})")
            elif op == "scale":
                out.append(f"scale({_fmt(v[0])})" if v[0] == v[1] else f"scale({_fmt(v[0])} {_fmt(v[1])})")
            elif op == "skewX":
                out.append(f"skewX({_fmt(v[0])})")
        return " ".join(out)

    if origin and any(op in ("rotate", "scale", "skewX") for op, _ in merged):
        cx, cy = origin
        if len(merged) == 1 and merged[0][0] == "rotate":
            return f"rotate({_fmt(merged[0][1][0])} {_fmt(cx)} {_fmt(cy)})"
        return f"translate({_fmt(cx)} {_fmt(cy)}) {render_ops(merged)} translate({_fmt(-cx)} {_fmt(-cy)})"
    return render_ops(merged)


def _extract_best_transforms(style_text: str) -> dict:
    clean = MEDIA_RE.sub("", style_text)
    keyframes = {}
    for km in KEYFRAMES_RE.finditer(clean):
        kname, kbody = km.groups()
        stops = {}
        for sm in STOP_RE.finditer(kbody):
            stops[sm.group(1).strip()] = sm.group(2).strip()
        keyframes[kname] = stops

    cls_transforms = {}
    for rm in RULE_RE.finditer(clean):
        cls, props = rm.groups()
        am = re.search(r"animation:\s*([\w-]+)([^;]*)", props)
        if not am:
            continue
        aname, aextra = am.group(1), am.group(2)
        if aname == "none" or "blink" in aname:
            # まばたきアニメ（eyes）は目がぱっちり開いた状態をベストとする
            continue
        om = re.search(r"transform-origin:\s*([-\d.]+)px\s+([-\d.]+)px", props)
        origin = (float(om.group(1)), float(om.group(2))) if om else None
        stops = keyframes.get(aname, {})
        # 45% または 50% のクライマックス位置（見せ場）を優先取得
        best_stop = next((v for k, v in stops.items() if "45%" in k or "50%" in k), None)
        if best_stop and aname == "pom-cheer-r":
            # チアの右ポンポンは左ポンポンと一緒に高く掲げた瞬間を採用
            best_stop = "transform: rotate(12deg) translateY(-6px);"
        elif not best_stop and "100%" in stops:
            if "swirl" in aname:
                best_stop = "transform: rotate(28deg);"
            elif "rain" in aname:
                best_stop = "transform: translateY(6px);"
        if not best_stop:
            continue
        tm = re.search(r"transform:\s*([^;]+)", best_stop)
        if not tm:
            continue
        svg_tf = _css_to_svg_transform(tm.group(1), origin, reverse=("reverse" in aextra))
        if svg_tf:
            cls_transforms[cls] = svg_tf
    return cls_transforms


def still_of(svg: str) -> str:
    m = STYLE_RE.search(svg)
    if not m:
        return svg
    cls_transforms = _extract_best_transforms(m.group(1))
    body = STYLE_RE.sub("", svg, count=1)

    def inject_transform(tag_match: re.Match) -> str:
        full_tag = tag_match.group(0)
        cls = tag_match.group(1)
        tf = cls_transforms.get(cls)
        if not tf:
            return full_tag
        if 'transform="' in full_tag:
            return re.sub(r'transform="([^"]+)"', lambda tm: f'transform="{tf} {tm.group(1)}"', full_tag, count=1)
        return full_tag.replace(f'class="{cls}"', f'class="{cls}" transform="{tf}"', 1)

    return re.sub(r'<[a-zA-Z0-9]+\s+[^>]*class="([\w-]+)"[^>]*>', inject_transform, body)


def main() -> int:
    check = "--check" in sys.argv[1:]
    stale = []
    for src in sorted(ROOT.glob("*.svg")):
        dst = ROOT / "still" / src.name
        want = still_of(src.read_text(encoding="utf-8"))
        if check:
            if not dst.exists() or dst.read_text(encoding="utf-8") != want:
                stale.append(src.name)
        else:
            dst.parent.mkdir(exist_ok=True)
            dst.write_text(want, encoding="utf-8")
    if check and stale:
        print("静止版が古い/無い:", ", ".join(stale))
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
