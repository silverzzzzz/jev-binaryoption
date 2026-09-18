# シミュレーション

## 仕組み（ウォークフォワード）

```
for i in 0 .. N-1:
    predictor.push(data[i])
    # ホライズンに到達した予測を解決（時刻順）
    while pending[0].resolveIndex <= i:
        outcome = resolve(pred, price[resolveIndex])   # up / down / flat
        predictor.learn(pred, outcome)                 # オンライン学習はここで初めて更新
        records.append(...)
    if i >= warmup and i % stride == 0:
        resolveIndex = 最初に t_i + horizon 以上となる点
        pred = predictor.predict()
        pending.append({pred, resolveIndex})
```

- **結果判定**: ホライズン後の最初の点の仲値と、エントリー時の仲値 ± 判定帯 を比較。
- **リークなし**: 予測時点より後の価格は predict に渡らない。学習も結果判明後。
- **stride**: 大きなデータでは `stride` を上げて間引く（統計的には独立性も上がる）。
- **warmup**: 既定は `windowBars`。それ以前は予測を出さない。
- データ末尾のホライズン内は結果が確定しないため評価に含めない。

## 主な設定

| 設定 | 意味 |
| --- | --- |
| windowBars | 参照する過去点数。特徴量・ボラ推定に使う |
| horizonSeconds | 何秒後を予測するか（ローソク足ではバー間隔の倍数に） |
| spreadMode / spreadValue | データの bid/ask を使うか、固定値か |
| flatThreshold | 追加の判定帯 |
| payout | ペイアウト率（0.85 = 85%） |
| minProb / minEv | エントリー推奨の閾値 |
| predictors / weights | 使用モデルと重み |
| stride | 何点ごとに予測するか |

## 指標の読み方

| 指標 | 意味 | 目安 |
| --- | --- | --- |
| 3 クラス正解率 | direction と outcome が一致した割合 | **多数派ベースライン**（常に最多クラスを答えた場合）を上回っているか |
| エントリー回数 / 率 | `trade = true` の件数 | 少なすぎると統計的に不安定 |
| 勝率（エントリー時） | エントリーした予測のうち的中した割合 | **損益分岐勝率** 1/(1+payout) を上回るか。同値（flat）は負け扱い |
| 累積損益 | 掛け金 1 で、勝ち +payout、負け −1 | 右肩上がりか、ドローダウンが許容範囲か |
| 最大ドローダウン | 損益曲線のピークからの最大下落 | |
| 予想価格 MAE | \|expectedPrice − 実際\| の平均。「現在値据え置き」より小さいか | |
| 混同行列 | 行 = 予測、列 = 結果 | どのクラスを取り違えているか |
| 較正表 | 確信度 X% のときの実際の的中率 | 的中率 ≈ 確信度 なら確率が信頼できる。的中率 < 確信度 は過信 |
| モデル別 方向的中率 | 各モデルの μ の符号が結果と一致した割合（flat を除く） | 重み調整の手がかり |

## 出力ファイル

- **結果 CSV**: 1 行 = 1 予測（time, exit_time, mid, spread, band, direction, p_up, p_down, p_flat, confidence, expected_price, ev, trade, outcome, exit_mid, hit, pnl）
- **結果 JSON**: config, metrics, learners（オンライン学習の重み）, records

## 検証のベストプラクティス

1. 実データを **十分な期間**（数週間〜）用意し、業者と同じスプレッド・判定ルールを設定する。
2. 期間を分けて（例: 前半で重み調整、後半で確認）過学習を避ける。
3. 較正表を見て、確信度の高いゾーンだけ `minProb` で絞る。
4. ホライズンとウィンドウを変えて感度を見る。特定の組み合わせだけ良いなら偶然の可能性が高い。
5. リアルタイム再生タブで先頭から流し、オンライン学習が立ち上がるまでの成績も確認する。
