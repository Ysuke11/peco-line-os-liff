# PECO LINE OS — 飼い主向け LIFF（段階 2 検証用）

- `index.html` / `app.js`: モック v4.5 の画面と遷移をそのまま Web アプリにしたもの（判定は tag_engine v0.3 と同じ）。
- `data/pets.json`: 架空のテストデータ（T1〜T15）。段階 4 でカルテ／アプリの API に置き換える。
- `404.html`: `index.html` のコピー。静的ホストで `/now` などのパスを受けるため（GitHub Pages 対応）。
- LIFF ID は `app.js` の `LIFF_ID`（検証用 2012109884-ZXtQfryQ）。本番は別の LIFF ID に差し替える。
- ルート: `/now` `/all` `/cal` `/resv` `/rec` `/consults` `/link` `/nodata`（`?p=` でも可）。`?pet=T1` で対象ペット、`?dev=1` で検証用の切替バーを表示。
- ローカル確認: `.claude/launch.json` の `liff-preview`（8768）。
- 個人情報は扱わない。LINE のプロフィールは取得しない（`liff.init` のみ）。
