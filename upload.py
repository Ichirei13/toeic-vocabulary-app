#!/usr/bin/env python3
"""ローカルのファイルを GitHub に push し、Pages で公開する。

Contents API は既存ファイルの更新時に現在の blob sha を要求するので、
PUT の前に GET して sha を取得する（初回は sha なしで作成）。
中身が変わっていないファイルはスキップする。
"""
import base64
import hashlib
import json
import os
import subprocess
import sys

REPO = "Ichirei13/toeic-vocabulary-app"
BRANCH = "main"
FILES = ["index.html", "upload.py"]
MESSAGE = "Add \"わからない\" button to vocab 4-choice modes; add grammar rule/chapter guide"


def gh(args, payload=None):
    """gh api を実行し (returncode, stdout, stderr) を返す。"""
    proc = subprocess.run(
        ["gh", "api"] + args,
        input=json.dumps(payload).encode("utf-8") if payload is not None else None,
        capture_output=True,
    )
    return proc.returncode, proc.stdout.decode("utf-8"), proc.stderr.decode("utf-8")


def blob_sha(data):
    """git のブロブ sha。リモートの sha と突き合わせて差分判定に使う。"""
    return hashlib.sha1(b"blob %d\0" % len(data) + data).hexdigest()


def remote_sha(path):
    """公開中のファイルの sha。未作成なら None。"""
    code, out, _ = gh(["/repos/%s/contents/%s?ref=%s" % (REPO, path, BRANCH)])
    if code != 0:
        return None
    try:
        return json.loads(out)["sha"]
    except (ValueError, KeyError):
        return None


def push(path):
    """1ファイルを push。変更なしなら False を返す。"""
    if not os.path.exists(path):
        print("  %s: ローカルに無いのでスキップ" % path)
        return False

    with open(path, "rb") as f:
        raw = f.read()

    sha = remote_sha(path)
    if sha and sha == blob_sha(raw):
        print("  %s: 変更なし" % path)
        return False

    payload = {
        "message": "%s (%s)" % (MESSAGE, path),
        "content": base64.b64encode(raw).decode("utf-8"),
        "branch": BRANCH,
    }
    if sha:
        payload["sha"] = sha

    code, out, err = gh(["-X", "PUT", "/repos/%s/contents/%s" % (REPO, path), "--input", "-"], payload)
    if code != 0:
        print("  %s: 失敗 %s" % (path, err.strip()), file=sys.stderr)
        raise SystemExit(1)

    commit = json.loads(out).get("commit", {})
    action = "更新" if sha else "新規"
    print("  %s: %s %s (%s bytes)" % (path, action, commit.get("sha", "")[:7], format(len(raw), ",")))
    return True


def main():
    print("push 先: %s (%s)" % (REPO, BRANCH))
    changed = [p for p in FILES if push(p)]

    if not changed:
        print("すべて最新です。")
    # Pages は有効化済みなら 409 が返るだけなので、そこは失敗扱いにしない。
    code, _, err = gh(["-X", "POST", "/repos/%s/pages" % REPO, "--input", "-"],
                      {"source": {"branch": BRANCH, "path": "/"}})
    if code != 0 and "already enabled" not in err:
        print("Pages 設定の警告: %s" % err.strip(), file=sys.stderr)

    code, out, _ = gh(["/repos/%s/pages" % REPO, "--jq", ".html_url"])
    if code == 0 and out.strip():
        print("公開URL: %s" % out.strip())
        if changed:
            print("反映まで1分ほどかかることがあります。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
