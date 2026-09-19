# 無料で使える価格データ

実データでの検証には、**bid/ask（スプレッド）が付いているか** が重要です。バイナリーオプションは
スプレッド分だけ不利な位置からスタートするため、スプレッドの無いデータで検証すると成績が実際より良く出ます。

| 提供元 | 対象 | 粒度 | bid/ask | APIキー | 本リポジトリの対応 |
| --- | --- | --- | --- | --- | --- |
| **Dukascopy** | FX / 指数 / 商品 | tick（ミリ秒） | **あり** | 不要 | 外部ツール（下記） |
| **HistData.com** | FX 66 通貨ペア | tick / 1 分足 | tick はあり | 不要（手動DL） | 手動ダウンロード |
| **TrueFX** | FX 主要ペア | tick | **あり** | 無料登録 | 手動ダウンロード |
| **Binance** | 暗号資産 | 1 秒足 / 約定 tick | なし | 不要 | `--source binance` |
| **Kraken** | 暗号資産 | 1 分足 / 約定 tick | なし | 不要 | `--source kraken` |
| **bitFlyer** | 暗号資産（日本） | 約定 tick | なし | 不要 | `--source bitflyer` |
| **Yahoo Finance** | FX / 株価指数 / 株 | 1 分足（直近 7〜8 日） | なし | 不要 | `--source yahoo` |
| **Stooq** | FX / 株価指数 / 株 | 日足 | なし | 不要 | `--source stooq` |

> どの提供元も利用規約があります。個人の検証目的での取得にとどめ、再配布や商用利用は各規約を確認してください。
> 取得したデータファイルは `data/` に保存され、`.gitignore` で除外されます。

## 1. アプリから直接取得する（最も手軽）

`npm run serve` でアプリを開き、**データ**タブの「オンラインから実データを取得」で提供元・銘柄・期間を
選んで取得します。取得後はそのまま系列として読み込まれ、「CSV として保存」で手元にも残せます。

ブラウザから直接叩けるのは CORS を許可している **Binance / Kraken / bitFlyer** です。
Yahoo と Stooq はブラウザからは取得できないため（選択肢が無効化されます）、次の CLI を使ってください。

## 2. 同梱スクリプトで取得する（APIキー不要）

```bash
# 暗号資産: 1 秒足を 1 日ぶん
node scripts/fetch-data.js --source binance --symbol BTCUSDT --interval 1s --days 1

# 暗号資産: 約定 tick を 2 時間ぶん
node scripts/fetch-data.js --source binance --symbol BTCUSDT --tick --hours 2

# FX: 1 分足を 7 日ぶん（Yahoo は 1 分足が直近 7〜8 日のみ）
node scripts/fetch-data.js --source yahoo --symbol USDJPY=X --interval 1m --days 7

# 日本の取引所の約定 tick
node scripts/fetch-data.js --source bitflyer --symbol BTC_JPY --tick --hours 1

# Binance が使えない地域では Kraken
node scripts/fetch-data.js --source kraken --symbol XBTUSD --interval 1 --days 1
```

`data/` に CSV が保存され、そのままアプリ（データタブにドロップ）や CLI で使えます。

```bash
node scripts/sim-cli.js data/binance_BTCUSDT_candle_1s_1d.csv --horizon 60 --window 60 --spread 2
```

**`--spread` を必ず指定してください。** 上記の提供元は bid/ask を含まないため、指定しないと
スプレッド 0（実際より有利な条件）で検証することになります。値は価格単位です。
例: BTCUSDT で 2 ドル → `--spread 2`、USD/JPY で 0.3 銭 → `--spread 0.003`。

### 銘柄名の例

| 提供元 | 書式 | 例 |
| --- | --- | --- |
| binance | 連結大文字 | `BTCUSDT` `ETHUSDT` `XRPUSDT` |
| kraken | Kraken 表記 | `XBTUSD` `ETHUSD` `XBTJPY` |
| bitflyer | product_code | `BTC_JPY` `ETH_JPY` `FX_BTC_JPY` |
| yahoo | Yahoo シンボル | `USDJPY=X` `EURUSD=X` `^N225` `AAPL` |
| stooq | Stooq シンボル | `usdjpy` `eurusd` `^spx` `7203.jp` |

### オプション

| オプション | 説明 |
| --- | --- |
| `--interval` | ローソク足の間隔（binance: `1s` `1m` `5m` …、kraken: 分数、yahoo: `1m` `5m` `1h`） |
| `--tick` | 約定単位で取得（binance / kraken / bitflyer） |
| `--days` / `--hours` | 取得期間（`--hours` が優先） |
| `--end <ISO>` | 終了時刻（既定は現在） |
| `--limit <n>` | 最大行数の安全弁 |
| `--out <file>` | 出力先 |
| `--base <url>` | API のベース URL 差し替え（検証用） |

レート制限には指数バックオフで自動リトライします。長期間の tick は数十万行になるため、
まず `--hours 1` 程度で試してから広げてください。

## 3. FX の tick データ（bid/ask 付き）を得る

バイナリーオプションが FX 中心なら、こちらが本命です。

### Dukascopy（推奨・無料・登録不要）

サードパーティ製 CLI を使うのが簡単です。

```bash
npx dukascopy-node@latest -i eurusd -from 2024-01-02 -to 2024-01-03 -t tick -f csv
```

出力 CSV は `timestamp,askPrice,bidPrice,askVolume,bidVolume` の形式です。Jev のデータタブに
そのままドロップし、列の割り当てで **Bid に `bidPrice`、Ask に `askPrice`** を選んでください
（自動判定も `bid` / `ask` を含む名前として認識します）。スプレッドは自動計算されます。

CLI 実行時の注意: 取得量が多いと時間がかかります。まずは 1 日ぶん、1 通貨ペアから試してください。

### HistData.com

[histdata.com](https://www.histdata.com/download-free-forex-data/) から月単位で手動ダウンロードします。
「Tick Data Quotes」を選ぶと bid/ask 付きの CSV（`YYYYMMDD HHMMSSMMM,bid,ask,volume`）が得られます。
ヘッダー行が無いため、Jev では列の割り当てで手動指定してください（col0=日時, col1=Bid, col2=Ask）。

### TrueFX

[truefx.com](https://www.truefx.com/) に無料登録すると、主要ペアの tick データ（bid/ask 付き）を
月単位でダウンロードできます。形式は `SYMBOL,YYYYMMDD HH:MM:SS.mmm,bid,ask`。

## 4. Binance の一括ダウンロード（大量データ向け）

API を何度も叩く代わりに、公式のアーカイブから ZIP で取得できます。

```bash
curl -O https://data.binance.vision/data/spot/daily/klines/BTCUSDT/1s/BTCUSDT-1s-2024-01-02.zip
unzip BTCUSDT-1s-2024-01-02.zip
```

展開される CSV はヘッダー無しで、1 列目が開始時刻（マイクロ秒）、2〜5 列目が OHLC です。
Jev のデータタブで列を手動割り当てすれば読み込めます（時刻はマイクロ秒も自動判別します）。
日次・月次、`klines` / `trades` / `aggTrades` が選べます。

## 5. APIキーが必要だが無料枠のある提供元

必要に応じて `src/tools/sources.js` に追加してください（URL 組み立てと変換関数を書くだけです）。

| 提供元 | 無料枠 | 特徴 |
| --- | --- | --- |
| Alpha Vantage | 25 リクエスト/日 | FX・株の分足。制限が厳しい |
| Twelve Data | 800 リクエスト/日 | FX・株・暗号資産の分足 |
| Finnhub | 60 リクエスト/分 | 株中心。FX は有料プラン寄り |
| Polygon.io | 5 リクエスト/分 | 米国株の tick。無料枠は遅延あり |
| OANDA / IG など | 口座開設 | 実際に取引する業者の API。**本番と同じスプレッド**が得られる |

最終的には「実際に取引する業者のデータ」で検証するのが最も正確です。多くの業者はデモ口座でも
API やヒストリカルデータを提供しています。

## 検証時のチェックリスト

1. **スプレッドを実際の値に合わせる**（データに bid/ask が無い場合は固定値を必ず設定）。
2. **取引時間帯を絞る**。FX の週末や薄商いの時間帯は値動きの性質が異なります。
3. **期間を分ける**。前半で設定を調整し、後半で確認する。
4. **ペイアウト率を業者の実際の値にする**（多くは 75〜95%）。
5. 較正表（アプリのシミュレーションタブ）で、確信度と実際の的中率がずれていないか確認する。
