# データ形式

## 対応ファイル

| 形式 | 読み込み方法 | 備考 |
| --- | --- | --- |
| CSV / TSV / TXT | 内蔵パーサ | 区切り文字（`,` `;` `\t` `\|`）は自動判定。ダブルクォート対応。BOM 可。ヘッダーが数値だけなら「ヘッダーなし」と判断し `col0, col1, ...` を付与 |
| XLSX / XLS / XLSM | SheetJS（CDN から遅延ロード、または `npm run vendor` でローカル配置） | 先頭シートの 1 行目をヘッダーとして使用 |
| JSON | 内蔵 | オブジェクト配列 `[{time, bid, ask}, ...]`、配列の配列、`{data: [...]}` のいずれか |
| 貼り付け | 内蔵 | CSV でも JSON でも可 |
| DuckDB SQL | DuckDB-wasm（CDN） | 読み込んだ生データを `prices` テーブルに登録し、SQL の結果を系列として使う |

## 列の自動判定

列名は大文字小文字を無視して以下の別名から推定します（UI で手動修正可）。

| ロール | 認識する列名 |
| --- | --- |
| 日時 | `timestamp` `datetime` `date_time` `time` `ts` `epoch` `unix` `date` `日時` `時刻` `時間` `Gmt time` `Local time` |
| 日付 + 時刻（分離） | `<DATE>` + `<TIME>`（MT4/MT5 エクスポート）、`date` + `time`、`日付` + `時刻` |
| 始値/高値/安値/終値 | `open/high/low/close`、`<OPEN>` 等、`o/h/l/c`、`始値/高値/安値/終値`、`adj close` |
| Bid / Ask | `bid` `ask` `<BID>` `<ASK>` `bidprice` `askprice` `offer` `売値` `買値` `ビッド` `アスク` |
| 単一価格 | `price` `mid` `last` `rate` `value` `価格` `レート` `仲値` |
| 出来高 | `volume` `<VOL>` `<TICKVOL>` `vol` `tickvol` `qty` `出来高` |

### 系列の種類

- **tick**: 1 行 = 1 価格。`bid` と `ask` があれば仲値とスプレッドを持つ tick、無ければ単一価格の tick。
- **candle**: `open/high/low/close` が揃っている場合。`bid/ask` が併記されていればスプレッドも保持。

判定順序: OHLC が揃っていれば candle、それ以外は tick。UI の「種類」で強制できます。

## 時刻形式

`parseTime` が以下を受け付けます。

| 例 | 解釈 |
| --- | --- |
| `2024-01-05T09:30:00Z`, `2024-01-05T09:30:00+09:00` | ISO 8601（タイムゾーン付き） |
| `2024.01.05 09:30:00`, `2024/01/05 09:30`, `2024-01-05 09:30:00.123` | ローカル時刻として解釈 |
| `1704447000` | エポック秒（< 1e11） |
| `1704447000000` | エポックミリ秒（< 1e14） |
| `1704447000000000` | エポックマイクロ秒 |
| `45296.5` | Excel シリアル値（< 1e6） |

タイムゾーンはシミュレーションの結果に影響しません（相対時間だけを使います）。

## スプレッド

- データに `bid/ask` があれば各点のスプレッド `ask - bid` を使います（設定「データの bid/ask から」）。
- 無い場合は設定の「固定スプレッド」を使います（価格単位。pips なら pip サイズを掛けて入力: 例 USD/JPY 0.3 pips → 0.003）。
- 判定帯 = スプレッド ÷ 2 ＋ 追加帯。詳細は [prediction-model.md](prediction-model.md)。

## tick → ローソク足

「ローソク足に集計」で任意の間隔に集計できます。集計後は 1 歩 = 1 バーになるため、
ホライズン t 秒はバー間隔の倍数にしてください（例: 1 分足なら t = 60, 120, 300 …）。
ローソク足を tick より小さい間隔にはできません。

## 実データの入手

無料で価格データを取得する方法（同梱スクリプト、Dukascopy の bid/ask 付き tick など）は
[data-sources.md](data-sources.md) にまとめています。

## 同梱サンプル

- `samples/sample_ticks.csv` — `timestamp,bid,ask` の 1 秒 tick（合成、約 3.3 時間）
- `samples/sample_candles_m1.csv` — MT 形式 (`<DATE>,<TIME>,<OPEN>,...`) の 1 分足（合成、3 日）

`node scripts/make-sample.js` で再生成できます。合成データはトレンド局面を含み、実データより予測しやすい点に注意してください。
