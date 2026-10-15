# FT Salesforce 不備チェック補助

Salesforce上で表示されたauひかりプラスの申込情報を、社内のDBマニュアルを基準に確認する**目視チェック補助ツール**です。最終的な確認・差戻し判断は担当者が行います。

**現在のバージョン：v1.5.0**

## 初回インストール

1. Chrome/EdgeのTampermonkeyを有効にしてください。
2. [FT Salesforce 不備チェック補助をインストール](https://raw.githubusercontent.com/fttmgotanda-blip/ft-salesforce-audit/main/ft-salesforce-audit.user.js) を開きます。
3. Tampermonkeyのインストール確認画面が表示されたら、内容を確認してインストールしてください。
4. 以前のv1.4以下のスクリプトを**無効化**し、Salesforceの画面を再読み込みしてください。

インストール確認が表示されない場合は、Tampermonkeyの「ユーティリティ」からURLインポートを利用してください。

## 自動更新

このスクリプトは **@updateURL / @downloadURL** を設定しています。管理者が`main`上の`ft-salesforce-audit.user.js`のバージョン番号を増やして更新すると、Tampermonkey側の更新確認時に新しい版を取得します。

- 更新は即時反映ではありません。ブラウザやTampermonkeyの設定で確認間隔が変わります。
- 更新後、Salesforceのページを再読み込みして反映してください。
- 現在の版を確認したい場合は、Tampermonkeyのダッシュボードを確認してください。

## 利用上の注意

- ツールは試験運用版です。**ツールが適合候補と表示しても、必ず人が最終確認してください。**
- Salesforceの画面情報を読み取る補助であり、Salesforceへの編集・保存や自動差戻しは行いません。
- OP料金とAC備考の照合はチェック対象外です。
- クライアント側画面構造が変更されると、読み取り結果が変化する場合があります。
- このリポジトリは公開されているため、顧客名・電話番号・案件ID・Salesforce画面の実データ・認証情報をコミットしないでください。

## 配布ファイル

- [ft-salesforce-audit.user.js](https://raw.githubusercontent.com/fttmgotanda-blip/ft-salesforce-audit/main/ft-salesforce-audit.user.js)
