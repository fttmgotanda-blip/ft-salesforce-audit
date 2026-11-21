// ==UserScript==
// @name         FT | Salesforce 不備チェック補助 v1.4（パネル移動対応）
// @name:ja      FTシステム | Salesforce 不備チェック
// @namespace    https://firstteam.local/userscripts
// @version      1.7.9
// @updateURL    https://raw.githubusercontent.com/fttmgotanda-blip/ft-salesforce-audit/main/ft-salesforce-audit.user.js
// @downloadURL  https://raw.githubusercontent.com/fttmgotanda-blip/ft-salesforce-audit/main/ft-salesforce-audit.user.js
// @description  Salesforceの画面表示値をブラウザ内でマニュアル条件と照合する試作版。外部送信・編集・保存なし。
// @match        https://*.lightning.force.com/*
// @match        https://*.my.salesforce.com/*
// @match        https://*.salesforce.com/*
// @noframes
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  // 埋め込みPhone/CTIおよび別システム内では起動しない。
  if (window.self !== window.top) return;
  if (!/(?:^|\.)(?:lightning\.force\.com|my\.salesforce\.com|salesforce\.com)$/.test(location.hostname)) return;

  // Salesforce Lightningの Shadow DOMにある項目ラベルを探す。
  // フィールドの値や個人情報は、起動可否の判定には利用しない。
  const requiredLabels = new Set(['獲得ID', '投入備考', 'お申し込みメニュー', 'プロバイダOP1']);
  function isRecordDetailPage() {
    if (!document.body) return false;
    const stack = [document];
    const visited = new WeakSet();
    const hits = new Set();
    let rootsVisited = 0;
    while (stack.length && rootsVisited < 4000) {
      const root = stack.pop();
      if (!root || visited.has(root)) continue;
      visited.add(root); rootsVisited++;
      try {
        for (const el of root.querySelectorAll(
          '.test-id__field-label,.slds-form-element__label,[data-field-label],.test-id__field-label-container'
        )) {
          if (!el.getClientRects().length) continue;
          const s = (el.textContent || '').replace(/[\s\u3000]+/g, ' ').trim().replace(/[:：]$/, '');
          if (requiredLabels.has(s)) hits.add(s);
          if (hits.size >= 2 && (hits.has('獲得ID') || hits.has('お申し込みメニュー'))) return true;
        }
        for (const el of root.querySelectorAll('*')) {
          if (el.shadowRoot) stack.push(el.shadowRoot);
          // iframe内には絶対に入らない。
        }
      } catch { /* 部品側で走査できない場合は起動せず待機 */ }
    }
    return false;
  }

  let started = false;
  let debounce = null;
  let observer = null;
  let timer = null;
  function checkAndStart() {
    if (started || !isRecordDetailPage()) return;
    started = true;
    if (observer) observer.disconnect();
    if (timer !== null) clearInterval(timer);
    if (debounce !== null) clearTimeout(debounce);
    startAudit();
  }
  function observeUntilReady() {
    if (!document.body) return;
    observer = new MutationObserver(() => {
      if (started) return;
      if (debounce !== null) clearTimeout(debounce);
      debounce = setTimeout(checkAndStart, 700);
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // Lightningの遅延表示・タブ切り替えにも対応する保険。
    timer = setInterval(checkAndStart, 4000);
    checkAndStart();
  }
  if (document.body) observeUntilReady();
  else document.addEventListener('DOMContentLoaded', observeUntilReady, { once: true });

  function startAudit() {
    'use strict';
    // 利用許可のある Salesforce 環境でのみご利用ください。
    // Salesforceレコードの更新、APIアクセス、外部送信、端末保存はしません。
    // ユーザーがチェックを開始した場合のみ、項目セクションを一時展開し閉じ直します。
    // 読み取った入力値は実行中の照合にのみ利用し、UIの判定結果オブジェクトやコピーに保持しません。
    const HOST_ID = 'ft-sf-audit-v14';
    if (!document.body || document.getElementById(HOST_ID)) return;
    const LABEL_SELECTOR = '.slds-form-element__label,.test-id__field-label,.test-id__field-label-container,[data-field-label],dt,.labelCol,.fieldLabel';
    const FIELD_SELECTOR = 'records-record-layout-item,force-record-layout-item,lightning-output-field,.test-id__field-container,.slds-form-element,.slds-form__item,.forcePageBlockItem,.pageBlockItem';
    const VALUE_SELECTORS = [
      '.test-id__field-value','.slds-form-element__static','dd','.dataCol',
      'lightning-formatted-text','lightning-formatted-number','lightning-formatted-date-time',
      'lightning-formatted-date','lightning-formatted-phone','lightning-formatted-email',
      'lightning-formatted-url','lightning-formatted-address','lightning-formatted-name',
      '.slds-form-element__control','[data-output-element-id]'
    ];
    const SKIP_SELECTOR = [
      LABEL_SELECTOR,'button','svg','script','style','noscript','lightning-helptext',
      '.slds-assistive-text','.slds-icon_container','[aria-hidden="true"]','[hidden]',
      '.test-id__field-label-container'
    ].join(',');
    const clean = (s) => String(s ?? '').replace(/\u00a0/g, ' ').replace(/[\s\u3000]+/g, ' ').trim();
    // Salesforceの値表示欄にあるプレースホルダー文字は入力値として数えない。
    // 『なし』『無』は選択肢として有効な場合があるため空欄扱いしない。
    const hasFieldValue = (v) => {
      const t = clean(v);
      return !!t && !/^(?:[-－ー—–―]+|未選択|未設定|未指定|選択してください)$/.test(t);
    };
    const isElement = (n) => !!n && n.nodeType === 1;
    const parentOf = (n) => n?.parentElement || n?.getRootNode?.()?.host || null;
    const inTool = (n) => {
      let p = n;
      for (let i = 0; i < 15 && p; i++, p = parentOf(p)) if (p.id === HOST_ID) return true;
      return false;
    };
    function visible(el) {
      if (!isElement(el) || !el.isConnected || inTool(el) || !el.getClientRects().length) return false;
      for (let p = el, i = 0; isElement(p) && i < 18; p = parentOf(p), i++) {
        if (p.hidden || p.getAttribute('aria-hidden') === 'true') return false;
        const st = getComputedStyle(p);
        if (st.display === 'none' || st.visibility === 'hidden' || st.visibility === 'collapse') return false;
      }
      return true;
    }
    function titleText(n) {
      const s = clean(n?.innerText ?? n?.textContent ?? '').replace(/[:：]$/, '');
      return (s.length >= 1 && s.length <= 90 && !/^[-‐ー]+$/.test(s)) ? s : '';
    }
    function getRoots() {
      const roots = [], visited = new WeakSet();
      const stats = { shadows: 0, iframes: 0, framesAccessible: 0, framesBlocked: 0, labelCandidates: 0, labelsVisible: 0, sectionsClosed: 0 };
      function add(root, depth) {
        if (!root || visited.has(root) || depth > 12) return;
        visited.add(root); roots.push(root);
        let nodes;
        try { nodes = root.querySelectorAll('*'); } catch { return; }
        for (const el of nodes) {
          if (inTool(el)) continue;
          if (el.shadowRoot) { stats.shadows++; add(el.shadowRoot, depth + 1); }
          if (el.tagName === 'IFRAME') {
            // 電話/CTIなど埋め込みシステムのDOMは読み取らない。
            // Salesforce本体の（同一ドキュメント内の）値のみ対象。
            stats.iframes++;
          }
        }
      }
      add(document, 0);
      for (const root of roots) {
        stats.sectionsClosed += [...root.querySelectorAll('button[aria-expanded="false"]')]
          .filter((b) => visible(b) && b.closest('.slds-accordion,.slds-section,records-record-layout-block')).length;
      }
      return { roots, stats };
    }
    function ownerContainer(labelNode) {
      if (labelNode.matches('dt,.labelCol')) return labelNode.parentElement || labelNode;
      let p = labelNode;
      for (let i = 0; i < 12 && p; i++, p = parentOf(p)) {
        if (!p.matches?.(FIELD_SELECTOR)) continue;
        // 内部に異なる項目ラベルが多数ある大きな親要素は対象外。
        const labelCount = p.querySelectorAll?.(LABEL_SELECTOR).length || 0;
        if (labelCount <= 2) return p;
      }
      // 取得不能とするより、隣接兄弟に値がある場合に備え小さな親を探索する。
      return labelNode.parentElement?.parentElement || labelNode.parentElement || labelNode;
    }
    function elementDescriptor(el) {
      if (!el) return 'none';
      const tag = el.tagName?.toLowerCase() || '?';
      // タグと、一般的なLightningクラス名のみ。顧客の値や属性は取り出さない。
      const cls = Array.from(el.classList || []).filter((c) => /^(slds-form-element__|test-id__field)/.test(c)).slice(0, 2).join('.');
      return tag + (cls ? '.' + cls : '');
    }
    // Salesforce編集ボタンの「編集」やariaラベルを、フィールドの値と誤認しない。
    // 読み取りは、専用の表示値コンテナと入力部品だけを値の根拠とする。
    // 重点項目だけDOM構造の型を診断。テキスト/値/ID/URL/属性値は一切含めない。
    function structureShape(root) {
      if (!root) return 'none';
      const results = [];
      let count = 0;
      function visit(e, depth) {
        if (!e || depth > 3 || count++ > 26) return;
        if (e.nodeType === Node.ELEMENT_NODE) {
          let type = e.tagName.toLowerCase();
          const cls = [...(e.classList || [])].filter(c => /^(slds-|test-id__)/.test(c)).slice(0,2).map(c => '.'+c).join('');
          results.push('·'.repeat(depth)+type+cls);
          for (const child of e.children) visit(child, depth + 1);
          if (e.shadowRoot) {
            results.push('·'.repeat(depth+1)+'#shadow');
            for (const child of e.shadowRoot.children) visit(child, depth+2);
          }
        }
      }
      visit(root,0);
      return results.join(' > ');
    }
    function getComposedValue(root) {
      if (!root) return '';
      const seen = new WeakSet();
      let visited = 0;
      function collect(n, depth) {
        if (!n || depth > 26 || visited++ > 1800 || seen.has(n)) return '';
        seen.add(n);
        if (n.nodeType === Node.TEXT_NODE) return n.textContent || '';
        if (n.nodeType !== Node.ELEMENT_NODE && n.nodeType !== Node.DOCUMENT_FRAGMENT_NODE) return '';
        if (n.nodeType === Node.ELEMENT_NODE) {
          const e = n;
          if (e !== root && e.matches(SKIP_SELECTOR + ',[role="button"],.slds-button,[contenteditable="true"]')) return '';
          if (e.hidden || e.getAttribute('aria-hidden') === 'true') return '';
          // 隠れているUI要素・読み上げ専用文言を取得値に混ぜない。
          if (e !== root && (e.style?.display === 'none' || e.style?.visibility === 'hidden')) return '';
          if (e.matches('input:not([type="hidden"]),textarea,select')) {
            if (e.type === 'checkbox' || e.type === 'radio') return e.checked ? 'checked' : '';
            return e.tagName === 'SELECT' ? (e.value ? e.selectedOptions?.[0]?.textContent || '' : '') : (e.value || '');
          }
          if (e.tagName === 'SLOT') {
            const assigned = e.assignedNodes?.({ flatten: true }) || [];
            if (assigned.length) return assigned.map(n => collect(n, depth + 1)).join(' ');
          }
          if (e.shadowRoot) {
            const sh = collect(e.shadowRoot, depth + 1);
            if (clean(sh)) return sh;
          }
          let childrenText = '';
          for (const child of e.childNodes) childrenText += ' ' + collect(child, depth + 1);
          if (clean(childrenText)) return childrenText;
          if (e.tagName?.startsWith('LIGHTNING-FORMATTED-')) {
            const v = typeof e.value === 'string' || typeof e.value === 'number' ? e.value : e.getAttribute('value');
            if (v != null) return String(v);
          }
          return '';
        }
        let childrenText = '';
        for (const child of n.childNodes || []) childrenText += ' ' + collect(child, depth + 1);
        return childrenText;
      }
      return clean(collect(root, 0));
    }
    function fieldResult(container, labelNode) {
      // 先に仕様が明確なテーブル形式を判定する。
      if (labelNode.matches('dt')) {
        const dd = labelNode.nextElementSibling;
        if (dd?.matches('dd') && visible(dd))
          return { state: hasFieldValue(getComposedValue(dd)) ? '値あり' : '空欄候補', method: 'dt/dd', target: dd };
      }
      if (labelNode.matches('.labelCol')) {
        const td = container.querySelector('.dataCol');
        if (td && visible(td))
          return { state: hasFieldValue(getComposedValue(td)) ? '値あり' : '空欄候補', method: 'table', target: td };
      }
      // 型が明確な入力コントロール（値が空のときのみ空欄候補）。
      const input = [...container.querySelectorAll('input:not([type="hidden"]),textarea,select')]
        .find(e => visible(e) && !e.closest('[role="button"],button'));
      if (input) {
        if (input.type === 'checkbox' || input.type === 'radio')
          return { state: '要確認', method: 'boolean-control', target: input };
        const value = input.tagName === 'SELECT' ? (input.value ? input.selectedOptions?.[0]?.textContent || '' : '') : input.value;
        return { state: hasFieldValue(value) ? '値あり' : '空欄候補', method: 'input', target: input };
      }
      // 表示値専用の要素を最優先。コントロール枠自体は編集ボタンを含み得るため、絶対に値とみなさない。
      const selectors = [
        '.test-id__field-value', '.slds-form-element__static',
        'lightning-formatted-text','lightning-formatted-number','lightning-formatted-date-time',
        'lightning-formatted-date','lightning-formatted-phone','lightning-formatted-email',
        'lightning-formatted-url','lightning-formatted-address','lightning-formatted-name',
        '[data-output-element-id]'
      ];
      const candidates = [], used = new Set();
      for (const selector of selectors) {
        for (const el of container.querySelectorAll(selector)) {
          if (!used.has(el) && visible(el) && el !== labelNode && !el.contains(labelNode)) {
            used.add(el); candidates.push(el);
          }
        }
      }
      // 値専用の要素がある場合、値があれば値あり・なければ空欄候補。
      for (const el of candidates) {
        const value = getComposedValue(el);
        if (hasFieldValue(value)) return { state: '値あり', method: 'explicit-value', target: el };
      }
      if (candidates.length) return { state: '空欄候補', method: 'empty-value-holder', target: candidates[0] };
      // ここがv0.3の主な誤判定箇所。controlの「編集」を値として扱わない。
      const controls = [...container.querySelectorAll('.slds-form-element__control')].filter(visible);
      if (controls.length) return { state: '要確認', method: 'control-unverified', target: controls[0] };
      return { state: '要確認', method: 'no-holder', target: null };
    }
    function sectionOf(el) {
      let p = el;
      for (let i = 0; i < 15 && p; i++, p = parentOf(p)) {
        if (!p.matches?.('.slds-accordion__section,.slds-section,records-record-layout-block,.pbSubsection')) continue;
        const h = p.querySelector('.slds-accordion__summary-heading,.slds-section__title,.slds-accordion__summary-content,h3');
        if (h) return titleText(h).slice(0, 65);
      }
      return '';
    }
    // 閉じたLightningの項目セクションを一時展開し、表示後に画面から読み取る。
    // ボタンの絞り込みを厳格にし、保存・承認・外部リンク等の操作を行わない。
    const waitForDom = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    function isSectionToggle(el) {
      if (!isElement(el) || inTool(el) || !el.matches('button[aria-expanded],a[aria-expanded],[role="button"][aria-expanded]')) return false;
      return el.matches('.slds-accordion__summary-action,.slds-section__title-action') ||
        !!el.closest('.slds-accordion__summary,.slds-accordion__summary-heading,.slds-section__title');
    }
    function closedSectionButtons() {
      const { roots } = getRoots();
      const buttons = [];
      for (const root of roots) {
        for (const btn of root.querySelectorAll('button[aria-expanded="false"],a[aria-expanded="false"],[role="button"][aria-expanded="false"]')) {
          if (isSectionToggle(btn) && visible(btn) && !/タイプ\s*[12](?!\d)/.test(clean(btn.textContent).normalize('NFKC'))) buttons.push(btn);
        }
      }
      return buttons;
    }
    async function openSectionsForAudit() {
      const opened = [], attempted = new WeakSet();
      // 親セクションを開くと内側のトグルが現れるため段階的に展開する。
      for (let round = 0; round < 6; round++) {
        const buttons = closedSectionButtons().filter(b => !attempted.has(b));
        if (!buttons.length) break;
        for (const button of buttons) {
          attempted.add(button);
          const controls = button.getAttribute('aria-controls');
          try { button.click(); opened.push({button, controls}); } catch { /* 読取不可として扱う */ }
        }
        await waitForDom(400);
      }
      return { opened, unopened: closedSectionButtons().length };
    }
    function restoreSections(opened) {
      // 子→親の順で元の状態へ。利用者が元から開いていた部分は操作しない。
      for (const {button, controls} of [...opened].reverse()) {
        let target = button;
        if (!target.isConnected && controls) {
          const { roots } = getRoots();
          target = null;
          for (const root of roots) {
            target = [...root.querySelectorAll('[aria-controls]')].find(b =>
              b.getAttribute('aria-controls') === controls && isSectionToggle(b)) || null;
            if (target) break;
          }
        }
        if (target?.isConnected && target.getAttribute('aria-expanded') === 'true') {
          try { target.click(); } catch { /* 利用者が手動で閉じられる */ }
        }
      }
    }

    function scan() {
      const { roots, stats } = getRoots();
      const fields = [], signatures = new Set();
      for (const root of roots) {
        for (const label of root.querySelectorAll(LABEL_SELECTOR)) {
          if (inTool(label)) continue;
          if (label.children && [...label.children].some((kid) => kid.matches?.(LABEL_SELECTOR))) continue;
          stats.labelCandidates++;
          if (!visible(label)) continue;
          stats.labelsVisible++;
          const name = titleText(label);
          if (!name || /^(編集|削除|保存|キャンセル|閉じる|ヘルプ|読み込み中)$/.test(name)) continue;
          const owner = ownerContainer(label);
          if (!visible(owner)) continue;
          const rect = label.getBoundingClientRect();
          const section = sectionOf(owner);
          const key = [section,name,Math.round(rect.left / 4),Math.round(rect.top / 4)].join('|');
          if (signatures.has(key)) continue;
          signatures.add(key);
          const r = fieldResult(owner, label);
          fields.push({ name, section, state: r.state, method: r.method, value: r.state === '値あり' ? getComposedValue(r.target) : '', labelNode: label });
        }
      }
      return { fields, stats, roots: roots.length };
    }
    function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
    // 2026-11-20版「DB不備チェック」マニュアルのP列（BIG）／Q列（KDDI）を参照する補助チェック。
    // Salesforceの顧客入力値はブラウザ内だけで比較し、一覧・コピー文面には出さない。
    // マニュアルの全項目・通話記録・他システムとの整合性を保証するものではありません。
    const normalize = (v) => clean(v).normalize('NFKC');
    // 姓と名の間のスペースだけによる誤判定を避ける。音や漢字の違いを曖昧一致とはしない。
    const nameKey = (v) => normalize(v).replace(/[\s\u3000]+/g, '');
    // 原本の2026/11/20版「DB不備チェック」シート。P=BIG、Q=KDDI。
    // 項目ごとに「必須」「選択不要」「条件によって」を区別し、条件付きは専用判定で評価。
    const manualEntryRules=new Map([["申込者名",{"row":30,"big":"必須","kddi":"必須"}],["性別",{"row":33,"big":"必須","kddi":"必須"}],["申込者生年月日",{"row":35,"big":"必須","kddi":"必須"}],["携帯電話番号(日中連絡先)",{"row":36,"big":"必須","kddi":"必須"}],["携帯電話番号",{"row":37,"big":"必須","kddi":"必須"}],["申込者メールアドレス",{"row":38,"big":"条件によって","kddi":"条件によって"}],["説明書面進捗",{"row":48,"big":"必須","kddi":"必須"}],["説明書面発送日",{"row":51,"big":"必須","kddi":"必須"}],["選択ルート",{"row":55,"big":"タイプ③必須","kddi":"タイプ③必須"}],["対応拠点",{"row":56,"big":"タイプ③必須","kddi":"タイプ③必須"}],["固定電話番号",{"row":123,"big":"条件によって","kddi":"条件によって"}],["契約タイプ",{"row":124,"big":"必須","kddi":"必須"}],["契約者性別",{"row":125,"big":"必須","kddi":"必須"}],["契約者名(姓カナ)",{"row":126,"big":"必須","kddi":"必須"}],["契約者名(名カナ)",{"row":128,"big":"必須","kddi":"必須"}],["契約者名(姓)",{"row":130,"big":"必須","kddi":"必須"}],["契約者名(名)",{"row":132,"big":"必須","kddi":"必須"}],["契約者生年月日",{"row":134,"big":"必須","kddi":"必須"}],["契約者連絡先電話番号1",{"row":135,"big":"必須","kddi":"必須"}],["契約者連絡先電話番号2",{"row":137,"big":"任意","kddi":"条件によって"}],["契約者メールアドレス",{"row":138,"big":"任意","kddi":"条件によって"}],["郵便番号",{"row":145,"big":"必須","kddi":"必須"}],["都道府県",{"row":146,"big":"必須","kddi":"必須"}],["市区郡",{"row":147,"big":"必須","kddi":"必須"}],["町村",{"row":148,"big":"必須","kddi":"必須"}],["丁目",{"row":149,"big":"必須","kddi":"必須"}],["番地",{"row":150,"big":"必須","kddi":"必須"}],["建物",{"row":151,"big":"任意","kddi":"条件によって"}],["棟",{"row":152,"big":"任意","kddi":"条件によって"}],["部屋番号",{"row":153,"big":"任意","kddi":"条件によって"}],["トス成功",{"row":160,"big":"条件によって","kddi":"条件によって"}],["CB案内用メールアドレス",{"row":167,"big":"条件によって","kddi":"条件によって"}],["CB理由",{"row":168,"big":"条件によって","kddi":"条件によって"}],["CB金額",{"row":173,"big":"条件によって","kddi":"条件によって"}],["CB備考※なくても不備ではない",{"row":174,"big":"条件によって","kddi":"条件によって"}],["申込書番号",{"row":181,"big":"記載不可","kddi":"記載不可"}],["設置先住所と異なる",{"row":188,"big":"選択不要","kddi":"必須"}],["設置先入居予定日",{"row":189,"big":"引越しがある場合記載必須","kddi":"条件によって"}],["契約者住所_郵便番号",{"row":190,"big":"引越しがある場合記載必須","kddi":"条件によって"}],["契約者住所_都道府県",{"row":191,"big":"引越しがある場合記載必須","kddi":"条件によって"}],["契約者住所_市区町村",{"row":192,"big":"引越しがある場合記載必須","kddi":"条件によって"}],["契約者住所_番地",{"row":193,"big":"引越しがある場合記載必須","kddi":"条件によって"}],["契約者住所_建物・棟",{"row":195,"big":"任意","kddi":"条件によって"}],["契約者住所_部屋番号",{"row":196,"big":"任意","kddi":"条件によって"}],["お申し込みのプロバイダ",{"row":203,"big":"必須","kddi":"必須"}],["お申し込みメニュー",{"row":212,"big":"必須","kddi":"必須"}],["回線速度",{"row":213,"big":"\"タイプ1","kddi":"タイプ3の場合必須\""}],["お申し込み内容",{"row":215,"big":"選択不要","kddi":"必須"}],["プロバイダID",{"row":216,"big":"BIGLOBE会員が「既存会員」の場合必須","kddi":"条件によって"}],["メールアドレス",{"row":221,"big":"選択不要","kddi":"条件によって"}],["Wi-Fiパック",{"row":226,"big":"必須","kddi":"必須"}],["Wi-Fiメッシュ子機",{"row":227,"big":"メッシュ子機申込有無が「申込有」の場合必須","kddi":"条件によって"}],["KDDI使用欄",{"row":228,"big":"必須","kddi":"条件によって"}],["プロバイダOP1",{"row":236,"big":"必須","kddi":"必須"}],["プロバイダOP2",{"row":240,"big":"必須","kddi":"条件によって"}],["プロバイダOP3",{"row":241,"big":"必須","kddi":"条件によって"}],["プロバイダOP4",{"row":242,"big":"必須","kddi":"条件によって"}],["プロバイダOP5",{"row":243,"big":"必須","kddi":"条件によって"}],["プロバイダOP6",{"row":244,"big":"必須","kddi":"条件によって"}],["プロバイダOP7",{"row":245,"big":"必須","kddi":"条件によって"}],["プロバイダOP8",{"row":246,"big":"必須","kddi":"条件によって"}],["プロバイダOP9",{"row":247,"big":"必須","kddi":"条件によって"}],["プロバイダOP10",{"row":248,"big":"必須","kddi":"条件によって"}],["プロバイダOP11",{"row":249,"big":"必須","kddi":"条件によって"}],["プロバイダOP12",{"row":250,"big":"必須","kddi":"条件によって"}],["プロバイダOP13",{"row":251,"big":"必須","kddi":"条件によって"}],["プロバイダOP14",{"row":252,"big":"必須","kddi":"条件によって"}],["プロバイダOP15",{"row":253,"big":"必須","kddi":"条件によって"}],["電話サービス申込方法",{"row":260,"big":"必須","kddi":"必須"}],["電話(K)-電話番号選択",{"row":262,"big":"5G電話申込有無が「申込有」の場合","kddi":"条件によって"}],["電話(K)-番ポ旧事業者コード",{"row":263,"big":"0AB-J番号取得方法が「ポータビリティ」の場合必須","kddi":"条件によって"}],["電話(K)-電話番号",{"row":264,"big":"条件によって","kddi":"条件によって"}],["電話(K)-ご契約者名姓カナ",{"row":265,"big":"電話(K)申込ありかつ、ポータビリティの場合必須","kddi":"条件によって"}],["電話(K)-ご契約者名名カナ",{"row":266,"big":"電話(K)申込ありかつ、ポータビリティの場合必須","kddi":"条件によって"}],["電話(K)-ご契約者名姓漢字",{"row":267,"big":"電話(K)申込ありかつ、ポータビリティの場合必須","kddi":"条件によって"}],["電話(K)-ご契約者名名漢字",{"row":268,"big":"電話(K)申込ありかつ、ポータビリティの場合必須","kddi":"条件によって"}],["電話(K)-紙明細出力申込有無",{"row":269,"big":"5G電話申込有無が「申込有」の場合","kddi":"条件によって"}],["電話(K)-割込通話申込有無",{"row":270,"big":"5G電話申込有無が「申込有」の場合","kddi":"条件によって"}],["電話(K)-発信番号表示申込有無",{"row":271,"big":"5G電話申込有無が「申込有」の場合","kddi":"条件によって"}],["電話(K)-番号通知リクエスト申込有無",{"row":272,"big":"5G電話申込有無が「申込有」の場合","kddi":"条件によって"}],["電話(K)-迷惑電話撃退申込有無",{"row":273,"big":"5G電話申込有無が「申込有」の場合","kddi":"条件によって"}],["電話(K)-割込番号表示申込有無",{"row":274,"big":"5G回線電話申込有無が「申込有」、かつ割込通話サービス申込有無が「申込有」、かつ発信番号表示サービス申込有無が「申込有」の場合必須","kddi":"条件によって"}],["電話(K)-着信転送申込有無",{"row":275,"big":"5G回線電話申込有無が「申込有」の場合必須","kddi":"条件によって"}],["電話(K)-迷惑電話発着信ブロック申込有無",{"row":276,"big":"5G回線電話申込有無が「申込有」の場合必須","kddi":"条件によって"}],["電話(K)-発信者番号通知",{"row":277,"big":"5G電話申込有無が「申込有」の場合","kddi":"条件によって"}],["電話(K)-番号案内電話帳掲載",{"row":278,"big":"5G電話申込有無が「申込有」の場合","kddi":"条件によって"}],["タイプ1-所有区分",{"row":285,"big":"選択不要","kddi":"条件によって"}],["タイプ1-設置先階数",{"row":286,"big":"選択不要","kddi":"条件によって"}],["タイプ1-auひかりテレビお申し込み",{"row":287,"big":"選択不要","kddi":"条件によって"}],["タイプ1-チャンネルパック",{"row":288,"big":"選択不要","kddi":"条件によって"}],["タイプ1-ご利用中の光回線",{"row":289,"big":"選択不要","kddi":"必須"}],["タイプ1-光回線再利用有無",{"row":290,"big":"選択不要","kddi":"条件によって"}],["タイプ1-光回線再利用承諾番号",{"row":291,"big":"選択不要","kddi":"条件によって"}],["タイプ1-特記事項(開通部門引継)",{"row":292,"big":"選択不要","kddi":"条件によって"}],["タイプ1-工事予約ID",{"row":295,"big":"選択不要","kddi":"-"}],["タイプ1-工事希望日1",{"row":296,"big":"選択不要","kddi":"条件によって"}],["タイプ1-工事希望時間帯1",{"row":297,"big":"選択不要","kddi":"条件によって"}],["タイプ1-工事希望日2",{"row":298,"big":"選択不要","kddi":"条件によって"}],["タイプ1-工事希望時間帯2",{"row":299,"big":"選択不要","kddi":"条件によって"}],["タイプ1-工事希望日3",{"row":300,"big":"選択不要","kddi":"条件によって"}],["タイプ1-工事希望時間帯3",{"row":301,"big":"選択不要","kddi":"条件によって"}],["タイプ1-廃止済回線流用希望",{"row":302,"big":"選択不要","kddi":"条件によって"}],["販社名(不動産代理店用)",{"row":309,"big":"条件によって","kddi":"条件によって"}],["販社名(不動産代理店用)ID",{"row":310,"big":"条件によって","kddi":"条件によって"}],["タイプ3-回線設置先建物種別",{"row":311,"big":"必須","kddi":"必須"}],["タイプ3-回線設置先建物",{"row":312,"big":"必須","kddi":"選択不要"}],["タイプ3-回線設置先建物(戸数)",{"row":313,"big":"必須","kddi":"選択不要"}],["タイプ3-NTT東西",{"row":314,"big":"選択不要","kddi":"必須"}],["タイプ3-申し込み区分",{"row":315,"big":"必須","kddi":"必須"}],["タイプ3-既存プロバイダ契約有無",{"row":316,"big":"必須","kddi":"必須"}],["タイプ3-他社光コラボ利用有無",{"row":317,"big":"選択不要","kddi":"必須"}],["タイプ3-現在利用中の回線",{"row":318,"big":"選択不要","kddi":"条件によって"}],["タイプ3-既設回線有無",{"row":319,"big":"任意","kddi":"選択不要"}],["タイプ3-変更元事業者",{"row":320,"big":"任意","kddi":"条件によって"}],["タイプ3-利用中回線名義(カナ)(姓)",{"row":321,"big":"転用or事業者変更の場合、漢字かカナどちらか必須","kddi":"条件によって"}],["タイプ3-利用中回線名義(カナ)(名)",{"row":322,"big":"転用or事業者変更の場合、漢字かカナどちらか必須","kddi":"条件によって"}],["タイプ3-利用中回線名義(漢字)(姓)",{"row":323,"big":"転用or事業者変更の場合、漢字かカナどちらか必須","kddi":"条件によって"}],["タイプ3-利用中回線名義(漢字)(名)",{"row":324,"big":"転用or事業者変更の場合、漢字かカナどちらか必須","kddi":"条件によって"}],["タイプ3-転用事業者承諾番号",{"row":325,"big":"回線が「転用」「事業者変更」の場合必須","kddi":"条件によって"}],["タイプ3-ひかり電話利用状況",{"row":326,"big":"選択不要","kddi":"必須"}],["電話(N)-電話プラン",{"row":329,"big":"コラボ電話「申込有」の場合必須","kddi":"選択不要"}],["電話(N)-電話番号選択",{"row":330,"big":"選択不要","kddi":"条件によって"}],["電話(N)-電話番号",{"row":337,"big":"コラボ電話「申込有」の場合必須","kddi":"条件によって"}],["電話(N)-番ポ旧事業者コード",{"row":338,"big":"電話申込ありかつ、ポータビリティの場合必須","kddi":"条件によって"}],["電話(N)-番号ポータビリティ元事業者名(その他詳細)",{"row":342,"big":"電話申込ありかつ、ポータビリティの場合必須","kddi":"条件によって"}],["電話(N)-番ポ契約者姓カナ",{"row":343,"big":"電話(N)申込ありかつ、ポータビリティの場合必須","kddi":"条件によって"}],["電話(N)-番ポ契約者名カナ",{"row":344,"big":"電話(N)申込ありかつ、ポータビリティの場合必須","kddi":"条件によって"}],["電話(N)-番ポ契約者姓漢字",{"row":345,"big":"電話(N)申込ありかつ、ポータビリティの場合必須","kddi":"条件によって"}],["電話(N)-番ポ契約者名漢字",{"row":346,"big":"電話(N)申込ありかつ、ポータビリティの場合必須","kddi":"条件によって"}],["電話(N)-電話加入権",{"row":347,"big":"コラボ電話「申込有」かつ、コラボ電話ポータビリティの場合必須","kddi":"条件によって"}],["電話(N)-割込電話申込有無",{"row":348,"big":"コラボ電話「申込有」の場合必須","kddi":"条件によって"}],["電話(N)-番号表示申込有無",{"row":349,"big":"コラボ電話「申込有」の場合必須","kddi":"条件によって"}],["電話(N)-ナンバーリクエスト申込有無",{"row":350,"big":"コラボ電話「申込有」の場合必須","kddi":"条件によって"}],["電話(N)-迷惑電話撃退申込有無",{"row":351,"big":"コラボ電話「申込有」の場合必須","kddi":"条件によって"}],["電話(N)-複数チャネルサービス申込有無",{"row":352,"big":"コラボ電話「申込有」の場合必須","kddi":"条件によって"}],["電話(N)-着信お知らせメール申込有無",{"row":353,"big":"コラボ電話「申込有」の場合必須","kddi":"条件によって"}],["電話(N)-発信者番号通知",{"row":354,"big":"コラボ電話「申込有」の場合必須","kddi":"条件によって"}],["電話(N)-国際電話の発信制限",{"row":356,"big":"回線が「回線新規」の場合かつ、コラボ電話「申込有」の場合必須","kddi":"選択不要"}],["電話(N)-着信転送申込有無",{"row":357,"big":"コラボ電話「申込有」の場合必須","kddi":"選択不要"}],["電話(N)-FAXお知らせメール申込有無",{"row":358,"big":"コラボ電話「申込有」の場合必須","kddi":"選択不要"}],["タイプ3-コラボ光テレビお申し込み",{"row":359,"big":"必須","kddi":"必須"}],["タイプ3-ISP使用欄",{"row":364,"big":"選択不要","kddi":"条件によって"}],["タイプ3-工事希望日(西暦)",{"row":365,"big":"選択不要","kddi":"条件によって"}],["タイプ3-工事希望時間帯",{"row":367,"big":"選択不要","kddi":"条件によって"}],["タイプ3-転用/事業者変更希望日",{"row":369,"big":"選択不要","kddi":"条件によって"}],["タイプ3-工事手配調整情報",{"row":371,"big":"任意","kddi":"選択不要"}],["タイプ3-お客様と連絡の取りやすい曜日・時間帯",{"row":373,"big":"任意","kddi":"選択不要"}],["タイプ3-備考・修正箇所",{"row":375,"big":"任意","kddi":"選択不要"}],["本人確認方法(携帯法用)",{"row":382,"big":"選択不要","kddi":"必須"}],["本人確認種別(犯収法用)",{"row":383,"big":"選択不要","kddi":"条件によって"}],["本人確認日(犯収法用)",{"row":385,"big":"選択不要","kddi":"条件によって"}],["本人確認時刻(犯収法用)",{"row":387,"big":"選択不要","kddi":"条件によって"}],["本人確認実施担当者氏名(携帯法/犯収法用)",{"row":389,"big":"選択不要","kddi":"条件によって"}],["職業",{"row":393,"big":"電話申込希望有無が「希望有」の場合必須","kddi":"条件によって"}],["職業備考欄",{"row":398,"big":"任意","kddi":"条件によって"}],["利用用途(個人)",{"row":400,"big":"電話申込希望有無が「希望有」の場合必須","kddi":"条件によって"}],["疑わしい取引該当フラグ",{"row":405,"big":"選択不要","kddi":"条件によって"}],["必要項目備考欄",{"row":407,"big":"選択不要","kddi":"条件によって"}],["初期費用請求区分",{"row":415,"big":"\"タイプ1","kddi":"タイプ3の場合必須\""}],["KDDI紙請求書",{"row":418,"big":"選択不要","kddi":"必須"}],["特記事項2",{"row":449,"big":"","kddi":"-"}],["対応日",{"row":456,"big":"-","kddi":"-"}],["対応者",{"row":457,"big":"-","kddi":"-"}],["FC待ち日",{"row":458,"big":"-","kddi":"-"}],["対応進捗",{"row":459,"big":"必須","kddi":"必須"}],["前後確転送",{"row":460,"big":"-","kddi":"-"}],["対応商材",{"row":461,"big":"必須","kddi":"必須"}],["失注リスト獲得拠点",{"row":462,"big":"-","kddi":"-"}],["前後確一本化案件",{"row":463,"big":"条件によって","kddi":"条件によって"}],["スタートサポート書類",{"row":470,"big":"必須","kddi":"必須"}],["工事担当共有事項",{"row":471,"big":"-","kddi":"-"}],["待ちエントリ日",{"row":472,"big":"記載不可","kddi":"記載不可"}],["携帯トス成功可否",{"row":479,"big":"選択不要","kddi":"必須"}],["携帯トス失敗理由",{"row":480,"big":"選択不要","kddi":"条件によって"}],["トス時携帯キャリア",{"row":481,"big":"選択不要","kddi":"条件によって"}],["携帯トス投入日",{"row":482,"big":"選択不要","kddi":"条件によって"}],["バレッドライフコンシェルジュ成功可否",{"row":489,"big":"選択不要","kddi":"必須"}],["バレッドライフコンシェルジュ失敗理由",{"row":490,"big":"選択不要","kddi":"条件によって"}],["バレッドライフコンシェルジュ投入日",{"row":491,"big":"選択不要","kddi":"条件によって"}]]);

    // マニュアル2026/11/20「エントリ先判断」：
    // タイプ3 nifty→KDDI / BIG+本人限定郵便→KDDI / BIG+eKYC→BIG。
    // BIGでスマホ所持が確認できた場合はBIG候補。選択済の本人確認方法を最優先する。
    // マニュアルの条件をSalesforce画面で確認できない場合は自動選択しない。
    function inferEntryRoute(fields){
      const labelKey=v=>normalize(v).replace(/[\s\u3000]/g,'');
      const selected=(f)=>f && f.state==='値あり' && hasFieldValue(f.value);
      const vals=fields.filter(selected);
      const menu=vals.filter(f=>/^(?:お申し込みメニュー|お申込みメニュー)$/.test(labelKey(f.name)));
      if(!menu.some(f=>/タイプ(?:3|③)/.test(normalize(f.value)))){
        return {route:null,reason:'タイプ3の申込メニューを確認できません。',signal:'unresolved'};
      }
      const providerLabels=/^(?:お申し込みのプロバイダ|お申込みのプロバイダ|申込ISP|申込みISP|ISP|ISP名|申込プロバイダ|申込みプロバイダ|プロバイダ名)$/i;
      let providerFields=vals.filter(f=>providerLabels.test(labelKey(f.name)));
      // ISP専用項目が読み取れないときのみ、タイプ3のメニュー名を補助的に参照。
      if(!providerFields.length)providerFields=menu;
      const p=providerFields.map(f=>normalize(f.value)).join(' ');
      const nifty=/(?:@?nifty|ニフティ)/i.test(p);
      const big=/(?:biglobe|ビッグローブ|(?:^|[^a-z])big(?:$|[^a-z]))/i.test(p);
      if(nifty&&big||!nifty&&!big){
        return {route:null,reason:'ISPをBIGまたはniftyとして確定できません。',signal:'unresolved'};
      }
      if(nifty)return {route:'KDDI',reason:'タイプ3・ISP nifty',signal:'nifty'};
      const methodLabels=/(?:本人確認|本人認証|本人限定|電子認証|認証方式|e[\s-]*kyc|エントリ(?:先|方式|方法))/i;
      const methodValues=vals.filter(f=>methodLabels.test(labelKey(f.name))&&
        !/(?:氏名|担当者|生年月日|確認日|時刻|備考|ログ|履歴)/.test(labelKey(f.name)));
      let mail=false,ekyc=false;
      for(const f of methodValues){
        const val=normalize(f.value).replace(/[\s\u3000]+/g,'');
        // 申込方法を表す実際の選択値だけを利用。否定的な記載は根拠にしない。
        if(/(?:不可|対象外|未実施|しない|申込なし|利用しない|不使用|NG)$/.test(val))continue;
        if(/本人限定(?:受取)?郵便/.test(val))mail=true;
        if(/(?:e-?kyc|オンライン本人確認|電子本人確認)/i.test(val))ekyc=true;
      }
      if(mail&&ekyc)return {route:null,reason:'本人限定郵便とeKYCの両方が検出されました。確認方式を目視確認してください。',signal:'conflict'};
      if(mail)return {route:'KDDI',reason:'タイプ3・ISP BIG・本人限定郵便',signal:'mail'};
      if(ekyc)return {route:'BIG',reason:'タイプ3・ISP BIG・eKYC',signal:'ekyc'};
      const smartphoneLabels=/(?:スマホ|スマートフォン|smartphone).*(?:持|保有|所持|所有|有無|利用可否|使用可否)|(?:端末所持|端末保有)/i;
      const yes=/^(?:有|有り|あり|はい|YES|持っている|所持あり|保有あり|利用可能|利用可|使用可|可能|スマホあり|スマートフォンあり)$/i;
      const smartphone=vals.some(f=>{
        const fieldName=labelKey(f.name);
        return smartphoneLabels.test(fieldName) && yes.test(normalize(f.value).trim());
      });
      if(smartphone)return {route:'BIG',reason:'タイプ3・ISP BIG・スマホ所持あり（確認方式は未特定）',signal:'smartphone'};
      return {route:null,reason:'BIG案件ですが、本人限定郵便・eKYC・スマホ所持のいずれも画面から判定できません。',signal:'unresolved'};
    }
    function runRules(fields,entryRoute) {
      if(entryRoute!=='BIG'&&entryRoute!=='KDDI') throw new Error('エントリー経由未選択');
      const byName = new Map();
      for (const f of fields) {
        if (!byName.has(f.name)) byName.set(f.name, []);
        byName.get(f.name).push(f);
      }
      function field(label) {
        const list=byName.get(label)||[];
        if(!list.length) return {name:label,state:'要確認',value:'',missing:true};
        if(list.length===1) return list[0];
        if(list.every(f=>f.state===list[0].state &&
          (label==='申込者名' ? nameKey(f.value)===nameKey(list[0].value) : normalize(f.value)===normalize(list[0].value)))) return list[0];
        // 「申込者名」のような同名フィールドは、全表示箇所に値があれば
        // 必須入力だけは判定可能。ただし内容一致は別のルールで保留にする。
        if(label==='申込者名' && list.every(f=>f.state==='値あり' && hasFieldValue(f.value)))
          return {...list[0], duplicatedDifferent:true};
        return {name:label,state:'要確認',value:'',ambiguous:true,labelNode:list[0].labelNode};
      }
      const results=[];
      const seen=new Set();
      function emit(label,row,status,reason,targetLabel=label) {
        const spec=manualEntryRules.get(nameKey(targetLabel));
        const requirement=spec?(entryRoute==='BIG'?spec.big:spec.kddi):null;
        // 「任意」「選択不要」「-」の欄は旧必須チェックの対象外。記載不可は空欄チェック。
        if(requirement&&/^(?:任意|選択不要|-)$/.test(requirement))return;
        const actualRow=spec?.row||row;
        const key=label+'|'+actualRow;
        if(seen.has(key))return;
        seen.add(key);
        const f=field(targetLabel);
        results.push({label,row:actualRow,status,reason,target:f.labelNode||null,targetLabel,targetSection:f.section||''});
      }
      function unknown(f){return f.state==='要確認'||f.missing||f.ambiguous;}
      function isValue(label){return field(label).state==='値あり'&&!unknown(field(label));}
      function val(label){return isValue(label)?normalize(field(label).value):null;}
      function required(label,row,why='マニュアルで入力必須です。') {
        const f=field(label);
        emit(label,row,unknown(f)?'判定保留':f.state==='値あり'?'適合候補':'要修正候補',
          unknown(f)?'画面から入力状態を確認できません。':f.state==='値あり'?'入力があることを確認しました（内容の正確性は別途確認）。':'未入力の可能性があります。'+why);
      }
      function empty(label,row,why='マニュアルで記載不可です。') {
        const f=field(label);
        emit(label,row,unknown(f)?'判定保留':f.state==='空欄候補'?'適合候補':'要修正候補',
          unknown(f)?'画面から入力状態を確認できません。':f.state==='空欄候補'?'未入力を確認しました。':'入力されている可能性があります。'+why);
      }
      function condition(label,row,test,why) {
        const f=field(label);
        if(unknown(f)) return emit(label,row,'判定保留','画面から選択内容を確認できません。');
        if(f.state!=='値あり') return emit(label,row,'要修正候補','必須の選択内容が空欄の可能性があります。');
        const result=test(normalize(f.value));
        emit(label,row,result===null?'判定保留':result?'適合候補':'要修正候補',
          result===null?'選択肢の表記を解釈できません。目視確認してください。':result?'該当する選択ルールと一致しています。':why);
      }
      function sizeLimit(labels,row,max,text) {
        const a=labels.map(x=>field(x));
        if(a.some(unknown)) return emit(text,row,'判定保留','関連項目の読み取りができず合計文字数を検証できません。',labels[0]);
        const n=a.reduce((sum,f)=>sum+(f.state==='値あり'?[...normalize(f.value)].length:0),0);
        emit(text,row,n>max?'要修正候補':'適合候補',n>max?`入力済み項目の合計が${max}文字を超えています。`:`入力済み項目の合計が${max}文字以内です。`,labels[0]);
      }
      function pending(label,row,reason,targetLabel=label){emit(label,row,'判定保留',reason,targetLabel);}
      function yesWord(v){return /^(?:有り|あり|有|申込あり|申込する)$/.test(v.replace(/^\d+\./,''));}
      const menu=val('お申し込みメニュー');
      const type3=menu!==null && /タイプ3/.test(menu);
      // 業務対象はタイプ3のみ。タイプ1/2専用のルールは実行しない。
      const knownType=type3;
      const apartment=menu!==null && /マンション/.test(menu);

      // 基本入力。システム上の項目名の差は正確に対応付け、見つからない場合は判定保留。
      // 「丁目」は存在しない住所もあるため必須から除外。記載があれば住所文字数チェックには含める。
      [
        ['申込者名',18],['性別',21],['申込者生年月日',23],['携帯電話番号(日中連絡先)',24],
        ['説明書面進捗',38],['契約者性別',88],['契約者名(姓カナ)',89],['契約者名(名カナ)',90],
        ['契約者名(姓)',91],['契約者名(名)',92],['契約者生年月日',94],['契約者連絡先電話番号1',95],
        ['郵便番号',109],['都道府県',110],['市区郡',111],['町村',112],['番地',114],
        ['設置先住所と異なる',152],['お申し込みのプロバイダ',167],['お申し込みメニュー',176],
        ['お申し込み内容',179],['Wi-Fiパック',182],['電話サービス申込方法',212],
        ['本人確認方法（携帯法用）',302],['KDDI紙請求書',332],['スタートサポート書類',384]
      ].forEach(([label,row])=>required(label,row));
      // 同名「申込者名」の存在チェックと、表示内容の一致チェックは分離。
      // 重複表示だけで必須入力を「未取得」としない（値そのものはコピーしない）。
      const applicantCopies=byName.get('申込者名')||[];
      if(applicantCopies.length>1){
        const allFilled=applicantCopies.every(f=>f.state==='値あり' && hasFieldValue(f.value));
        const identical=allFilled && applicantCopies.every(f=>nameKey(f.value)===nameKey(applicantCopies[0].value));
        emit('申込者名［複数表示の一致］',18,
          !allFilled?'判定保留':identical?'適合候補':'判定保留',
          !allFilled?'同名欄の一部が未入力または読み取り不可です。確認してください。':
          identical?'複数の申込者名欄が一致しています。':
          '同名欄の内容が一致しません。どの欄が正しいか目視確認してください。',
          '申込者名');
      }
      // 申込者・契約者の氏名を、姓名間スペースを無視して比較。入力が別人の可能性もあるため差戻しではなく保留。
      const applicantNames=(byName.get('申込者名')||[]).filter(f=>f.state==='値あり'&&hasFieldValue(f.value)).map(f=>nameKey(f.value));
      const holderSurname=val('契約者名(姓)'),holderGiven=val('契約者名(名)');
      if(!applicantNames.length || holderSurname===null || holderGiven===null){
        pending('申込者名と契約者氏名［整合］',91,'氏名を一部取得できないため照合できません。','契約者名(姓)');
      }else{
        const holder=nameKey(holderSurname+holderGiven);
        const ok=applicantNames.every(n=>n===holder);
        emit('申込者名と契約者氏名［整合］',91,ok?'適合候補':'判定保留',
          ok?'表示されている氏名の文字列が一致しています（本人確認の代替ではありません）。':
          '申込者名と契約者の姓名を結合した文字列が一致しません。代理申込などの事情を含めて確認してください。','契約者名(姓)');
      }
      // カナ氏名は単純な文字列だけ照合（生年月日・本人確認情報の外部送信なし）。
      const appKana=val('申込者カナ'), holderKana1=val('契約者名(姓カナ)'), holderKana2=val('契約者名(名カナ)');
      if(appKana!==null && holderKana1!==null && holderKana2!==null){
        const ok=nameKey(appKana)===nameKey(holderKana1+holderKana2);
        emit('申込者カナと契約者カナ［整合］',89,ok?'適合候補':'判定保留',
          ok?'カナの文字列が一致しています。':'申込者カナと契約者カナの文字列に差があります。表記・入力内容を確認してください。','契約者名(姓カナ)');
      }else pending('申込者カナと契約者カナ［整合］',89,'カナ氏名をすべて取得できないため照合できません。','契約者名(姓カナ)');
      condition('契約タイプ',87,v=>v==='個人'?true:v==='法人'?false:null,'auひかりプラスは法人の受付対象外です。');
      condition('対応進捗',373,v=>v==='受注','対応進捗は「受注」である必要があります。');
      condition('対応商材',375,v=>v==='auひかりプラス','「auひかりプラス」である必要があります。');
      empty('申込書番号',145,'キャリア連携時に入力する項目です。');
      empty('待ちエントリ日',386,'この段階では記載不可です。');

      // 携帯トス成功可否（行393）は運用変更によりチェック対象外とする。
      // 失敗理由・投入日は引き続き空欄指定。
      [
        ['携帯トス失敗理由',394],['携帯トス投入日',396]
      ].forEach(([label,row])=>empty(label,row,'10/9版のマニュアルでは入力・選択禁止です。'));

      // 一時対象外：バレッドライフコンシェルジュ成功可否（403行）は判定しない。
      // 案内禁止への運用変更につき、バレッドライフコンシェルジュ関連（403～405行）のチェックは全て対象外。

      // 共通形式チェック。入力は無い時点で必須ルール側が指摘するので形式判定は対象外。
      for(const [label,row,rx,message] of [
        ['郵便番号',109,/^\d{7}$/,'郵便番号はハイフンなし7桁です。'],
        ['契約者連絡先電話番号1',95,/^\d{10,11}$/,'電話番号はハイフンなし10～11桁です。']
      ]) {
        const f=field(label);
        if(unknown(f)) pending(label+'［形式］',row,'入力値を取得できません。',label);
        else if(f.state!=='値あり') emit(label+'［形式］',row,'対象外','空欄のため形式判定を実施していません。',label);
        else emit(label+'［形式］',row,rx.test(normalize(f.value))?'適合候補':'要修正候補',rx.test(normalize(f.value))?'入力形式と一致しています。':message,label);
      }
      sizeLimit(['都道府県','市区郡','町村','丁目','番地','建物','棟','階数','部屋番号'],110,50,'設置先住所［50文字以内］');
      sizeLimit(['市区郡','町村','丁目','番地'],111,30,'市区町村～番地［30文字以内］');
      if(apartment){
        [['建物',115],['部屋番号',117]].forEach(([name,row])=>required(name,row,'マンションタイプで必須とされています。'));
        // 棟（116行）の単独必須チェックは一時対象外。ホーム集合住宅のA/B照合は維持。
      } else if(menu===null || !knownType){
        pending('マンション住所の必須条件',115,'申込メニューを判別できません。','お申し込みメニュー');
      }

      // DB不備チェック 115～117行：
      // ホームで集合住宅を受け付けた場合、A（棟名と部屋番号を専用欄に入力）か
      // B（いずれか不明なら番地に判明している住所情報すべてを入力）のどちらか。
      // 番地に「全情報」が入っているかは自動確定できないため、Bは原則目視保留。
      if(type3 && menu !== null && /ホーム/i.test(menu)){
        const category=field('タイプ3-回線設置先建物種別');
        if(unknown(category) || category.state!=='値あり'){
          pending('ホーム集合住宅［住所記載方式］',115,
            '建物種別を読み取れないため、集合住宅かどうか確認してください。集合住宅の場合は棟名・部屋番号、または番地欄への全情報記載が必要です。',
            'タイプ3-回線設置先建物種別');
        }else if(/(?:集合住宅|共同住宅|マンション|アパート)/.test(normalize(category.value))){
          const tower=field('棟');
          const room=field('部屋番号');
          const lot=field('番地');
          if([tower,room,lot].some(unknown)){
            pending('ホーム集合住宅［住所記載方式］',115,
              '棟・部屋番号・番地のいずれかを読み取れません。AまたはBの形式で記載されているか確認してください。',
              '番地');
          }else if(tower.state==='値あり' && room.state==='値あり'){
            emit('ホーム集合住宅［住所記載方式］',115,'適合候補',
              'A方式：棟名と部屋番号の入力を確認しました。住所内容の正確性は目視確認してください。','棟');
          }else if(lot.state!=='値あり'){
            emit('ホーム集合住宅［住所記載方式］',115,'要修正候補',
              'A方式の棟名・部屋番号が揃っておらず、B方式の番地欄にも記載がありません。','番地');
          }else{
            const lotText=nameKey(lot.value);
            // A方式の片方だけが専用欄に記載されている場合、
            // B方式の番地欄にその既知情報も記載されているか比較する。
            const known=[
              ['棟名',tower],
              ['部屋番号',room]
            ].filter(([,f])=>f.state==='値あり');
            const notInLot=known.filter(([,f])=>!lotText.includes(nameKey(f.value))).map(([n])=>n);
            if(notInLot.length){
              emit('ホーム集合住宅［住所記載方式］',115,'要修正候補',
                'B方式では番地欄に全情報を記載する必要があります。専用欄の'+notInLot.join('・')+'にある情報が番地欄で確認できません。','番地');
            }else{
              pending('ホーム集合住宅［住所記載方式］',115,
                'B方式の可能性があります。番地欄に棟名・部屋番号など、判明している住所情報がすべて記載されているか目視確認してください。',
                '番地');
            }
          }
        }
      }

      // マニュアル38～44行の説明書面フロー。
      const progress=val('説明書面進捗');
      if(progress!==null){
        if(/メール説明|書面手配済/.test(progress))required('説明書面発送日',41,'メール送信・書面手配済では日付が必要です。');
        else if(/電話説明|書面送付待ち/.test(progress))empty('説明書面発送日',41,'現在のフローでは日付を記載しません。');
        else pending('説明書面発送日',41,'説明書面進捗の選択肢を識別できません。','説明書面進捗');
        const a=val('契約者年齢');
        if(a===null)pending('65歳以上の書面フロー',39,'年齢を読み取れません。','契約者年齢');
        else {
          const m=a.match(/^\d+/),age=m?Number(m[0]):NaN;
          if(!Number.isFinite(age))pending('65歳以上の書面フロー',39,'年齢の表記を識別できません。','契約者年齢');
          else if(age<65)emit('65歳以上の書面フロー',39,'対象外','65歳未満です。','説明書面進捗');
          else emit('65歳以上の書面フロー',39,/書面送付待ち|書面手配済/.test(progress)?'適合候補':'要修正候補',
            /書面送付待ち|書面手配済/.test(progress)?'書面フローが選択されています。':'65歳以上は書面フローが必須です。','説明書面進捗');
        }
      } else pending('説明書面発送日・高齢者フロー',41,'説明書面進捗を確認できません。','説明書面進捗');

      // 前後確一本化案件が「対象」の場合だけ、OP1とOP2～16の照合を実行。
      // 未取得や想定外の値の場合は、誤ったOP警告を出さず保留にする。
      const unification=field('前後確一本化案件');
      const unificationChoice=!unknown(unification)&&unification.state==='値あり'
        ? normalize(unification.value).replace(/^[0-9]+[.．、]\s*/,'').trim() : null;
      const opCheckEnabled=unificationChoice==='対象';
      if(!opCheckEnabled){
        if(unificationChoice==='対象外'){
          emit('OPチェック［前後確一本化案件］',192,'対象外',
            '前後確一本化案件が「対象外」のため、OP関連チェックを実施しません。','前後確一本化案件');
        } else {
          pending('OPチェック［前後確一本化案件］',192,
            '前後確一本化案件の「対象」を確認できないため、OP関連のチェックは保留です。','前後確一本化案件');
        }
      }
      // 前後確一本化案件「対象」ならFC完了日と担当者の両方が必須。
      // 「対象外」なら両方空欄。区分が未確認の場合はOP判定側で保留にする。
      if(unificationChoice==='対象'){
        required('FC完了日',0,'前後確一本化案件が「対象」のためFC完了日の入力が必要です。');
        required('FC担当者',0,'前後確一本化案件が「対象」のためFC担当者の入力が必要です。');
      }else if(unificationChoice==='対象外'){
        empty('FC完了日',0,'前後確一本化案件が「対象外」の場合はFC完了日を空欄にしてください。');
        empty('FC担当者',0,'前後確一本化案件が「対象外」の場合はFC担当者を空欄にしてください。');
      }

      // 一本化対象外では、初回FC架電希望時間が空欄ならこちらで時間入力が必要。
      // これはデータ不備ではなく現場の追加作業なので、別の「業務アラート」として示す。
      if(unificationChoice==='対象外'){
        const firstCallTime=field('初回FC架電希望時間');
        if(unknown(firstCallTime)){
          pending('初回FC架電希望時間［入力要否］',0,
            '初回FC架電希望時間を読み取れません。一本化対象外の案件のため、時間入力が必要か画面で確認してください。','初回FC架電希望時間');
        }else if(firstCallTime.state==='空欄候補'){
          emit('初回FC架電希望時間［入力依頼］',0,'業務アラート',
            '前後確一本化案件が「対象外」で、初回FC架電希望時間が空欄です。弊社側で時間の入力が必要です（不備判定とは別）。','初回FC架電希望時間');
        }else{
          emit('初回FC架電希望時間［入力依頼］',0,'適合候補',
            '前後確一本化案件が「対象外」ですが、初回FC架電希望時間は入力されています。','初回FC架電希望時間');
        }
      }

      // P列のBIG経由にだけ必須となったタイプ3項目。
      if(entryRoute==='BIG'&&type3){
        required('タイプ3-回線設置先建物',0,'BIG経由のP列では必須です。');
        required('タイプ3-回線設置先建物(戸数）',0,'BIG経由のP列では必須です。');
        required('KDDI使用欄',0,'BIG経由のP列では必須です。');
      }
      // OP2～16は投入備考の実申込サービスと照合して判断する。
      // P列の「必須」を全OP欄の一律入力必須と解釈しない（未申込OP欄は空欄可）。
      // OP1の「おトクプラン」は下の独立した必須チェックを維持する。

      if(opCheckEnabled){
        const op=field('プロバイダOP1');
        if(unknown(op))pending('プロバイダOP1［おトクプラン］',192,'表示値を読み取れません。','プロバイダOP1');
        else if(op.state!=='値あり')emit('プロバイダOP1［おトクプラン］',192,'要修正候補','必須のおトクプラン（2年契約）が未選択の可能性があります。','プロバイダOP1');
        else {
          const txt=normalize(op.value);
          const ok=/おトクプラン/.test(txt)&&/2年/.test(txt);
          emit('プロバイダOP1［おトクプラン］',192,ok?'適合候補':'要修正候補',ok?'必須プランの表示が確認できました。':'おトクプラン（2年契約）を選択してください。','プロバイダOP1');
        }
      }

      // プロバイダ許可リストをタイプ別に適用。未対応の選択肢は判定保留。
      if(knownType){
        const name=val('お申し込みのプロバイダ');
        if(name!==null){
          const t=name.toLowerCase();
          const brand=t.includes('biglobe')?'biglobe':t.includes('nifty')?'nifty':t.includes('so-net')?'so-net':'unknown';
          const pattern=t.match(/\b(kwe|kof|kcm)\b/i)?.[1]?.toLowerCase()||'';
          let acceptable=null;
          if(brand==='nifty')acceptable=true;
          else if(brand==='so-net')acceptable=false;
          else if(brand==='biglobe') {
            acceptable=['kwe','kof','kcm'].includes(pattern);
            if(!pattern)acceptable=null;
          }
          emit('プロバイダ［タイプ別許可］',167,acceptable===null?'判定保留':acceptable?'適合候補':'要修正候補',
            acceptable===null?'選択肢表記とタイプ別許可リストを照合できません。':acceptable?'マニュアルのタイプ別候補と一致しています。':'申込タイプでは利用不可のプロバイダ選択です。','お申し込みのプロバイダ');
        } else pending('プロバイダ［タイプ別許可］',167,'表示値を読み取れません。','お申し込みのプロバイダ');
      }

      if(type3){
        [ ['選択ルート',45],['対応拠点',46],['回線速度',177],
          ['タイプ3-回線設置先建物種別',261],['タイプ3-NTT東西',262],
          ['タイプ3-申し込み区分',263],['タイプ3-既存プロバイダ契約有無',264],
          ['タイプ3-他社光コラボ利用有無',265],['タイプ3-ひかり電話利用状況',271],
          ['タイプ3-コラボ光テレビお申し込み',287]
        ].forEach(([label,row])=>required(label,row,'タイプ3の必須項目です。'));
        const speed=val('回線速度');
        if(speed===null)pending('回線速度［選択値］',177,'回線速度の選択を取得できません。','回線速度');
        else emit('回線速度［選択値］',177,['1ギガ','10ギガ'].includes(speed)?'適合候補':'要修正候補', ['1ギガ','10ギガ'].includes(speed)?'速度が1ギガ／10ギガです。':'タイプ3の速度は1ギガ／10ギガです。','回線速度');
      } else pending('申込プラン別条件',176,'メニューからタイプ3を判別できません。','お申し込みメニュー');

      if(type3){

      // 設置先都道府県の東西区分（ユーザー提供の17都道県／30府県）。
      // 市区町村の一部には都道府県区分と異なるNTT収容エリアがあるため、該当地区は保留。
      const eastPrefectures=[
        '北海道','青森県','岩手県','宮城県','秋田県','山形県','福島県',
        '茨城県','栃木県','群馬県','埼玉県','千葉県','東京都','神奈川県',
        '新潟県','山梨県','長野県'
      ];
      const westPrefectures=[
        '富山県','石川県','福井県','岐阜県','静岡県','愛知県','三重県',
        '滋賀県','京都府','大阪府','兵庫県','奈良県','和歌山県',
        '鳥取県','島根県','岡山県','広島県','山口県','徳島県','香川県',
        '愛媛県','高知県','福岡県','佐賀県','長崎県','熊本県','大分県',
        '宮崎県','鹿児島県','沖縄県'
      ];
      const prefectureRegion=new Map();
      for(const [names,region] of [[eastPrefectures,'東'],[westPrefectures,'西']]){
        for(const name of names){
          prefectureRegion.set(name,region);
          prefectureRegion.set(name.replace(/(都|府|県)$/,''),region);
        }
      }
      const prefectureField=field('都道府県');
      const nttField=field('タイプ3-NTT東西');
      const parsedPref=!unknown(prefectureField)&&prefectureField.state==='値あり'
        ? normalize(prefectureField.value).replace(/^[0-9]+[.．、]\s*/,'').trim():null;
      const prefectureArea=parsedPref?prefectureRegion.get(parsedPref)||null:null;
      const nttRaw=!unknown(nttField)&&nttField.state==='値あり'
        ? normalize(nttField.value).replace(/^[0-9]+[.．、]\s*/,'').replace(/\s+/g,'').trim():null;
      const nttArea=/^(?:NTT)?東(?:日本)?$/.test(nttRaw||'')?'東':
        /^(?:NTT)?西(?:日本)?$/.test(nttRaw||'')?'西':null;
      const locationDetail=[val('市区郡')||'',val('町村')||''].join(' ');
      const borderException=(parsedPref==='静岡県'||parsedPref==='静岡')&&/(?:熱海市|裾野市)/.test(locationDetail)
        ||(parsedPref==='富山県'||parsedPref==='富山')&&/立山町/.test(locationDetail)
        ||(parsedPref==='長野県'||parsedPref==='長野')&&/南木曽町.*田立/.test(locationDetail);
      if(unknown(prefectureField)||!prefectureArea) {
        pending('NTT東西［都道府県照合］',261,
          '都道府県が不明または47都道府県に該当しないため、NTT東西との一致を判定できません。','都道府県');
      } else if(unknown(nttField)||!nttArea) {
        pending('NTT東西［都道府県照合］',262,
          'NTT東西の選択を確認できません。都道府県から推定した東西区分と照合してください。','タイプ3-NTT東西');
      } else if(borderException) {
        pending('NTT東西［都道府県照合］',262,
          '県境・提供エリアの例外となり得る市区町村です。都道府県だけで東西を断定せず、住所単位でNTT提供エリアを確認してください。','タイプ3-NTT東西');
      } else {
        emit('NTT東西［都道府県照合］',262,
          nttArea===prefectureArea?'適合候補':'要修正候補',
          nttArea===prefectureArea
            ?'都道府県とNTT東西の区分が一致しています（個別住所の提供判定とは異なります）。'
            :'設置先の都道府県と「タイプ3-NTT東西」の東西区分が一致しません。選択内容をご確認ください。',
          'タイプ3-NTT東西');
      }
      // Salesforce選択肢の実画面を確認済み（2026/11/15）。
      // 東：(NTT東) 午前フリー：9～12時／午後フリー：13～17時
      // 西：(NTT西) AMフリー／PMフリー
      // 比較対象は「タイプ3-NTT東西」のみ。お客様が希望した午前・午後を照合する
      // 別の項目はないため、時間枠そのものの希望一致・妥当性は判定しない。
      // 選択肢は文字列を正規化して東西区分のみ確認し、未知の表示値は判定保留。
      const workKind=val('タイプ3-申し込み区分');
      if(workKind!==null&&workKind.includes('新規')&&
          !/転用|事業者変更/.test(workKind)){
        const timeField=field('タイプ3-工事希望時間帯');
        if(unknown(timeField)){
          pending('タイプ3-工事希望時間帯［東西照合］',292,
            '工事希望時間帯を読み取れません。東日本・西日本それぞれの選択肢を確認してください。',
            'タイプ3-工事希望時間帯');
        }else if(timeField.state==='値あり'){
          const choice=normalize(timeField.value)
            .replace(/^[0-9]+[.．、]\s*/,'')
            .replace(/[\s\u3000()（）]/g,'')
            .replace(/[：]/g,':');
          // 波ダッシュや全角チルダ、ハイフンの表記ゆれは同じ時間枠として扱う。
          const eastAM=/^NTT東午前フリー:9[~〜～－\-ー]12時$/.test(choice);
          const eastPM=/^NTT東午後フリー:13[~〜～－\-ー]17時$/.test(choice);
          const westAM=/^NTT西AMフリー$/i.test(choice);
          const westPM=/^NTT西PMフリー$/i.test(choice);
          const timeArea=eastAM||eastPM?'東':westAM||westPM?'西':null;
          if(!timeArea){
            pending('タイプ3-工事希望時間帯［東西照合］',292,
              '工事希望時間帯が確認済みの東日本2種・西日本2種のいずれにも一致しません。選択値を目視確認してください。',
              'タイプ3-工事希望時間帯');
          }else if(!nttArea){
            pending('タイプ3-工事希望時間帯［東西照合］',292,
              '時間帯の東西区分は確認できましたが「タイプ3-NTT東西」を読めないため、選択との一致を確認してください。',
              'タイプ3-NTT東西');
          }else{
            emit('タイプ3-工事希望時間帯［東西照合］',292,
              nttArea===timeArea?'適合候補':'要修正候補',
              nttArea===timeArea
                ?'NTT東西に対応する時間帯の選択肢です。お客様の希望した午前・午後と一致するかは比較対象がなく未確認です。'
                :'NTT東西と時間帯選択肢の東西区分が一致しません。東：午前/午後フリー、西：AM/PMフリーから選択してください。お客様の希望時間帯との照合は対象外です。',
              'タイプ3-工事希望時間帯');
          }
        }
        // 空欄の必須チェックは「タイプ3-工事希望時間帯」（292行）で実施する。
      }

        const appClass=val('タイプ3-申し込み区分');
        if(appClass===null)pending('タイプ3-新規／転用／事変',263,'申込区分を読み取れません。','タイプ3-申し込み区分');
        else {
          const fresh=appClass.includes('新規');
          const transfer=appClass.includes('転用');
          const switched=appClass.includes('事業者変更');
          if(fresh){
            if(entryRoute==='KDDI'){
              const phoneStatus=val('タイプ3-ひかり電話利用状況');
              if(phoneStatus!==null)
                emit('タイプ3-ひかり電話利用状況［新規］',0,
                  /利用していない/.test(phoneStatus)?'適合候補':'要修正候補',
                  /利用していない/.test(phoneStatus)?'新規の指定値です。':
                  '新規の場合は「現在ひかり電話を利用していない」を選択してください。',
                  'タイプ3-ひかり電話利用状況');
            }
            // 10/17改定：新規の工事希望日は記載可だが空欄でも問題なし.
            required('タイプ3-工事希望時間帯',292,'新規では工事希望時間帯が必須です。');
            empty('タイプ3-転用/事業者変更希望日',295,'新規では不要です。');
            required('初期費用請求区分',329,'新規では初期費用請求区分が必須です。');
          }else if(transfer||switched){
            empty('タイプ3-工事希望日(西暦)',291,'転用／事業者変更では記載不可です。');
            empty('タイプ3-工事希望時間帯',293,'転用／事業者変更では記載不可です。');
            required('タイプ3-転用/事業者変更希望日',294,'転用／事業者変更では必須です。');
            if(entryRoute==='KDDI')empty('初期費用請求区分',330,'転用／事業者変更では記載不可です。');
            else required('初期費用請求区分',0,'BIG経由はP列のタイプ3必須項目です。');
            [ ['タイプ3-現在利用中の回線',266],['タイプ3-利用中回線名義(カナ)（姓）',268],
              ['タイプ3-利用中回線名義(カナ)（名）',269],['タイプ3-転用事業者承諾番号',270]
            ].forEach(([label,row])=>required(label,row,'転用／事業者変更の場合は必須です。'));
            if(switched)required('タイプ3-変更元事業者',267,'事業者変更の場合は必須です。');
            const tv=val('タイプ3-コラボ光テレビお申し込み');
            if(tv===null)pending('転用／事業者変更［コラボテレビ］',288,'テレビ選択を確認できません。','タイプ3-コラボ光テレビお申し込み');
            else emit('転用／事業者変更［コラボテレビ］',288,yesWord(tv)?'要修正候補':'適合候補',yesWord(tv)?'転用・事変ではテレビ「有り」が禁止されています。':'テレビの選択禁止条件に該当しません。','タイプ3-コラボ光テレビお申し込み');
          }else pending('タイプ3-申し込み区分［条件］',263,'新規／転用／事業者変更の別を解釈できません。','タイプ3-申し込み区分');
        }
      }

      const content=val('お申し込み内容');
      if(content!==null && content.includes('同一プロバイダ') && content.includes('プラン変更')){
        const a=field('プロバイダID'),b=field('メールアドレス');
        if(unknown(a)||unknown(b))pending('プロバイダIDまたはメールアドレス',181,'双方の入力状態が取得できません。','プロバイダID');
        else emit('プロバイダIDまたはメールアドレス',181,a.state==='値あり'||b.state==='値あり'?'適合候補':'要修正候補',a.state==='値あり'||b.state==='値あり'?'いずれか入力済みです。':'同一プロバイダからのプラン変更で両方未入力です。','プロバイダID');
      }

      // 電話オプション：「有り(電話(K))」「有り(電話(N))」と読める場合に限って分岐。
      const phone=val('電話サービス申込方法');
      // 電話申込なしの選択値だけを厳格に分類。不明な値は空欄指定の対象にしない。
      const phoneText=phone===null?'':normalize(phone).replace(/^[0-9]+[.．、]\s*/,'').trim();
      const cleanedNoPhone=phoneText.replace(/^電話(?:サービス)?(?:の)?\s*/,'').replace(/^申込(?:み)?\s*/,'').trim();
      const phoneKSelected=phone!==null && /電話\s*\(?K\)?/i.test(phoneText) && !/電話\s*\(?N\)?/i.test(phoneText);
      const phoneNSelected=phone!==null && /電話\s*\(?N\)?/i.test(phoneText) && !/電話\s*\(?K\)?/i.test(phoneText);
      const phoneNoneSelected=phone!==null && /^(?:なし|無し|無|未申込|申込なし|対象外)$/.test(cleanedNoPhone);
      const noPhoneK=phoneNSelected||phoneNoneSelected;
      if(phone!==null){
        const isK=/電話\s*\(?K\)?/i.test(phone),isN=/電話\s*\(?N\)?/i.test(phone);
        const yesK=isK&&!isN,yesN=isN&&!isK;
        if(yesK){
          [ ['電話(K)-電話番号選択',213], ['電話(K)-割込通話申込有無',220],
            ['電話(K)-発信番号表示申込有無',221],['電話(K)-番号通知リクエスト申込有無',222],
            ['電話(K)-迷惑電話撃退申込有無',223],['電話(K)-割込番号表示申込有無',224],
            ['電話(K)-着信転送申込有無',225],['電話(K)-迷惑電話発着信ブロック申込有無',226],
            ['電話(K)-発信者番号通知',227],['電話(K)-番号案内電話帳掲載',228],
            ['本人確認種別（犯収法用）',303],['本人確認日（犯収法用）',305],
            ['本人確認時刻（犯収法用）',307],
            ['職業',313],['利用用途(個人)',317],['疑わしい取引該当フラグ',319]
          ].forEach(([label,row])=>required(label,row,'電話(K)申込時に必要です。'));
          // 2026/11/10変更：職業備考欄は「その他」を選択した場合のみ必須。
          const occupation=val('職業');
          if(occupation!==null&&/その他/.test(occupation))
            required('職業備考欄',0,'職業で「その他」を選択した場合は備考欄の入力が必要です。');
          const suspect=val('疑わしい取引該当フラグ');
          if(suspect!==null && yesWord(suspect))required('必要項目備考欄',321,'該当理由の記載が必要です。');
        }else if(noPhoneK){
          [['本人確認種別（犯収法用）',303],['本人確認日（犯収法用）',305],['本人確認時刻（犯収法用）',307],
            ['職業',313],['職業備考欄',315],['利用用途(個人)',317],['疑わしい取引該当フラグ',319],['必要項目備考欄',321]]
            .forEach(([label,row])=>empty(label,row,'電話(K)申込なしでは原則空欄です。'));
          if(yesN){
            [ ['電話(N)-電話番号選択',272],['電話(N)-割込電話申込有無',279],
              ['電話(N)-番号表示申込有無',280],['電話(N)-ナンバーリクエスト申込有無',281],
              ['電話(N)-迷惑電話撃退申込有無',282],['電話(N)-複数チャネルサービス申込有無',283],
              ['電話(N)-着信お知らせメール申込有無',284],['電話(N)-発信者番号通知',285]
            ].forEach(([label,row])=>required(label,row,'電話(N)申込の場合は必須です。'));
            // 2026/10/27改定：電話(N)番号選択は回線区分と既存ひかり電話利用状態の組合せで判断。
            const pick=val('電話(N)-電話番号選択');
            if(entryRoute==='KDDI'){
              const kind=val('タイプ3-申し込み区分');
              const usage=val('タイプ3-ひかり電話利用状況');
              const fresh=kind!==null&&/新規/.test(kind)&&!/転用|事業者変更/.test(kind);
              const transfer=kind!==null&&/転用|事業者変更/.test(kind)&&!/新規/.test(kind);
              const active=usage!==null&&/利用している/.test(usage)&&!/利用していない/.test(usage);
              const inactive=usage!==null&&/利用していない/.test(usage);
              if(!kind||(!fresh&&!transfer)||(!active&&!inactive)||pick===null){
                pending('電話(N)［番号選択の申込区分照合］',0,
                  '申し込み区分・ひかり電話利用状況・番号選択のいずれかを確認できません。','電話(N)-電話番号選択');
              }else{
                const choice=normalize(pick).replace(/^[0-9]+[.．、]\s*/,'').trim();
                const newNo=choice==='新しい電話番号を希望';
                const keep=choice==='現在ご利用中の電話番号を継続';
                const move=choice==='現在ご利用中のひかり電話を転用';
                const valid=transfer&&active?move:(fresh||transfer&&inactive)?newNo||keep:false;
                emit('電話(N)［番号選択の申込区分照合］',0,valid?'適合候補':'要修正候補',
                  valid?'ひかり電話利用状況と番号選択が一致しています。':
                    '番号選択がマニュアル261120と一致しません。転用・事変で既存ひかり電話ありなら「ひかり電話を転用」、それ以外は新番または継続です。',
                  '電話(N)-電話番号選択');
              }
            }
            if(pick===null)pending('電話(N)-電話番号引継条件',273,'番号選択を確認できません。','電話(N)-電話番号選択');
            else if(pick.includes('現在')&&pick.includes('継続')){
              [ ['電話(N)-番ポ旧事業者コード',273],['電話(N)-電話番号',274],
                ['電話(N)-番ポ契約者姓カナ',275],['電話(N)-番ポ契約者名カナ',276],
                ['電話(N)-番ポ契約者姓漢字',277],['電話(N)-番ポ契約者名漢字',278]
              ].forEach(([label,row])=>required(label,row,'現在の電話番号を引き継ぐため必須です。'));
            }else if(pick.includes('新番')||pick.includes('新しい電話番号を希望')){
              [ ['電話(N)-番ポ契約者姓カナ',275],['電話(N)-番ポ契約者名カナ',276],
                ['電話(N)-番ポ契約者姓漢字',277],['電話(N)-番ポ契約者名漢字',278]
              ].forEach(([label,row])=>empty(label,row,'新番取得時は記載しません。'));
            }
          }
        }
        if(!yesN){
          [ ['電話(N)-電話番号選択',272],['電話(N)-番ポ旧事業者コード',273],
            ['電話(N)-電話番号',274], ['電話(N)-番ポ契約者姓カナ',275],['電話(N)-番ポ契約者名カナ',276],
            ['電話(N)-番ポ契約者姓漢字',277],['電話(N)-番ポ契約者名漢字',278]
          ].forEach(([label,row])=>empty(label,row,'電話(N)申込がない場合は空欄です。'));
        }
        if(yesN){
          [ ['電話(K)-電話番号選択',213],['電話(K)-番ポ旧事業者コード',214],
            ['電話(K)-電話番号',215],['電話(K)-ご契約者名姓カナ',216],
            ['電話(K)-ご契約者名名カナ',217],['電話(K)-ご契約者名姓漢字',218],
            ['電話(K)-ご契約者名名漢字',219],['電話(K)-割込通話申込有無',220],
            ['電話(K)-発信番号表示申込有無',221],['電話(K)-番号通知リクエスト申込有無',222],
            ['電話(K)-迷惑電話撃退申込有無',223],['電話(K)-割込番号表示申込有無',224],
            ['電話(K)-着信転送申込有無',225],['電話(K)-迷惑電話発着信ブロック申込有無',226],
            ['電話(K)-発信者番号通知',227],['電話(K)-番号案内電話帳掲載',228]
          ].forEach(([label,row])=>empty(label,row,'電話(N)申込時は電話(K)欄を使用しません。'));
        }
        if(!yesK&&!yesN&&!/無し|なし|無|申込なし/.test(phone)){
          pending('電話申込方法［詳細条件］',212,'K/N/無しの区分を解釈できないため電話別ルールは一部保留です。','電話サービス申込方法');
        }
      }else pending('電話申込方法［詳細条件］',212,'電話サービスの申込方法を取得できません。','電話サービス申込方法');

      if(opCheckEnabled){
      // 投入備考に名称があれば申込あり。名称の存在でOP2～16と双方向照合する。
      // 辞書はユーザー提供のBIGLOBE 8サービス。辞書外は安全側の「判定保留」。
      // 顧客入力の原文は結果やコピーへ含めない。料金・AC備考の照合は対象外。
      const catalog=[
        {name:'トータル・ネットセキュリティ',aliases:['トータル・ネットセキュリティ','トータルネットセキュリティ']},
        {name:'BIGLOBEお助けサポート＋',aliases:['BIGLOBEお助けサポート＋','BIGLOBEお助けサポート','お助けサポート＋']},
        {name:'エンジョイプラス',aliases:['エンジョイプラス']},
        {name:'BIGLOBEあんしんバックアップ',aliases:['BIGLOBEあんしんバックアップ','あんしんバックアップ']},
        {name:'暮らしのあんしん相談',aliases:['暮らしのあんしん相談']},
        {name:'生活かけつけレスキュー',aliases:['生活かけつけレスキュー','生活駆けつけレスキュー']},
        {name:'U-NEXT for BIGLOBE',aliases:['U-NEXT for BIGLOBE','U-NEXTforBIGLOBE']},
        {name:'BIGLOBEインターネット端末保証',aliases:['BIGLOBEインターネット端末保証','インターネット端末保証']}
      ];
      // 名前判定用の表記ゆれ吸収。非英数字記号だけ除去し、異なる商品は曖昧一致させない。
      const optKey = t => normalize(t).toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
      const offOption = t => /^(?:なし|無し|無|未申込|申込なし|未加入|非加入|対象外|不要|選択なし|0|off|false)$/i.test(normalize(t));
      const optionMatches = t => {
        const k=optKey(t);
        if(!k) return [];
        return catalog.filter(c=>c.aliases.some(a=>k.includes(optKey(a))));
      };
      const memoF=field('投入備考');
      const memoKnown=!unknown(memoF);
      const memoText=memoKnown&&memoF.state==='値あり'?normalize(memoF.value):'';
      const listed = new Set(memoKnown ? optionMatches(memoText).map(c=>c.name) : []);
      const opSlots=Array.from({length:15},(_,i)=>({label:'プロバイダOP'+(i+2),data:field('プロバイダOP'+(i+2))}));
      const selected=new Map(), unknownOptions=[], unreadable=[];
      for(const slot of opSlots){
        const v=slot.data;
        if(unknown(v)){unreadable.push(slot.label);continue;}
        if(v.state!=='値あり'||offOption(v.value))continue;
        // 有無だけの欄や、辞書にないサービスは勝手に特定しない。
        const matches=optionMatches(v.value);
        if(matches.length!==1){unknownOptions.push(slot.label);continue;}
        const match=matches[0];
        if(!selected.has(match.name))selected.set(match.name,[]);
        selected.get(match.name).push({label:slot.label});
      }

      // 新マニュアル：BIGLOBEあんしんパックとトータルネットセキュリティは重複申込不可。
      // 「BIGLOBEあんしんバックアップ」は別サービスなので、この判定に含めない。
      // 申込サービスのみ記載される投入備考と、実際の選択済OP2～16を照合する。
      {
        const activeTexts=opSlots.filter(slot=>!unknown(slot.data) &&
          slot.data.state==='値あり'&&!offOption(slot.data.value));
        const sources=[
          ...(memoKnown && memoF.state==='値あり'?[{label:'投入備考',text:memoText}]:[]),
          ...activeTexts.map(slot=>({label:slot.label,text:normalize(slot.data.value)}))
        ];
        const key=t=>normalize(t).replace(/[\s\u3000・･\-ー]/g,'').toLowerCase();
        const pack=sources.filter(src=>key(src.text).includes(key('BIGLOBEあんしんパック')));
        const security=sources.filter(src=>key(src.text).includes(key('トータルネットセキュリティ')));
        if(pack.length && security.length){
          // 異なる欄で検出した場合も、誤って適合扱いせず確認を促す。
          emit('OP重複申込｜BIGLOBEあんしんパック＋トータルネットセキュリティ',193,'要修正候補',
            'BIGLOBEあんしんパックとトータルネットセキュリティは重複申込不可です。申込内容を確認してください。',
            pack.find(x=>x.label!=='投入備考')?.label||security.find(x=>x.label!=='投入備考')?.label||'投入備考');
        }
      }
      if(!memoKnown){
        pending('投入備考［OP照合］',193,'投入備考を読み取れないため、OPとの双方向照合を実施できません。','投入備考');
      } else {
        let matchedCount=0;
        for(const c of catalog){
          const inMemo=listed.has(c.name), slots=selected.get(c.name)||[];
          if(!inMemo&&!slots.length) continue;
          const link=slots[0]?.label||'投入備考';
          const label='OP照合｜'+c.name;
          if(inMemo&&!slots.length){
            if(unknownOptions.length||unreadable.length){
              pending(label,193,'投入備考に申込記載がありますが、OP欄の一部が未識別のため選択漏れを断定できません。',link);
            }else{
              emit(label,193,'要修正候補','投入備考に申込記載がありますが、プロバイダOP2～16に同サービスの選択が見当たりません。','投入備考');
            }
          }else if(!inMemo){
            emit(label,193,'要修正候補','プロバイダOP2～16に選択がありますが、投入備考にサービスの申込記載が見当たりません。',link);
          }else if(slots.length>1){
            emit(label,193,'要修正候補','同じサービスがOP2～16の複数欄で選択されている可能性があります。',link);
          }else{
            matchedCount++;
            emit(label,193,'適合候補','投入備考とSalesforceのOP選択でサービス名称が一致しています。',link);
          }
        }
        if(!matchedCount&&!listed.size&&!selected.size&&!unknownOptions.length&&!unreadable.length){
          emit('プロバイダOP2～16［投入備考］',193,'対象外','登録済み8サービスについて、投入備考の記載・OP選択はありません。辞書外のOPは別途目視してください。','投入備考');
        }
      }
      for(const slotName of unknownOptions){
        pending('未識別OP選択｜'+slotName,193,'選択値が登録済み8サービスの名称に対応しません。投入備考と目視照合してください。',slotName);
      }
      if(unreadable.length){
        pending('読み取り不可OP欄',193,'一部のOP2～16を読み取れず、自動照合が不完全です。目視確認してください。',unreadable[0]);
      }
      // 光電話(K)とWi-FiパックはOP2～16とは別欄なので、専用選択と投入備考の記載を照合。
      if(memoKnown){
        const notePhone=/光電話\s*\(?K\)?/i.test(memoText);
        const chosenPhone=val('電話サービス申込方法');
        if(chosenPhone===null)pending('光電話(K)［投入備考照合］',212,'電話サービス申込方法の選択値を読み取れません。','電話サービス申込方法');
        else {
          const selectedK=/電話\s*\(?K\)?/i.test(chosenPhone);
          emit('光電話(K)［投入備考照合］',212,notePhone===selectedK?'適合候補':'要修正候補',
            notePhone===selectedK?'投入備考の光電話(K)記載と電話(K)選択の有無が一致しています。':
            '投入備考の光電話(K)記載とSalesforceの電話(K)選択が一致しません。','電話サービス申込方法');
        }
        const noteWifi=/wi[-\s]?fi\s*パック/i.test(memoText);
        const sfWifi=val('Wi-Fiパック');
        if(sfWifi===null)pending('Wi-Fiパック［投入備考照合］',182,'Wi-Fiパックの選択を読み取れません。','Wi-Fiパック');
        else {
          const wifiOff=offOption(sfWifi)||/^(?:無|なし|無し)\b/.test(sfWifi);
          const selectedWifi=!wifiOff&&/(?:有|あり|加入|wi[-\s]?fi\s*パック)/i.test(sfWifi);
          if(!selectedWifi&&!wifiOff)pending('Wi-Fiパック［投入備考照合］',182,'Wi-Fiパック欄の選択肢を判別できません。','Wi-Fiパック');
          else emit('Wi-Fiパック［投入備考照合］',182,noteWifi===selectedWifi?'適合候補':'要修正候補',
            noteWifi===selectedWifi?'投入備考のWi-Fiパック記載と専用欄の申込有無が一致しています。':
            '投入備考のWi-Fiパック記載と専用欄の申込有無が一致しません。','Wi-Fiパック');
        }
      }

      }
      // 行309：「受付時確認済」（携帯法）と「電話(K)申込あり」（犯収法）は独立条件。
      // どちらか一方でも該当する場合は必須。両方に該当しないことが明確なときのみ空欄指定。
      const identityField=field('本人確認方法（携帯法用）');
      const identityKnown=!unknown(identityField)&&identityField.state==='値あり';
      const identity=identityKnown?normalize(identityField.value):null;
      const identityAtReception=identity!==null && identity.includes('受付時確認済');
      const staffLabel='本人確認実施担当者氏名（携帯法/犯収法用）';
      if(identityAtReception||phoneKSelected){
        required(staffLabel,309,
          identityAtReception&&phoneKSelected
            ?'受付時確認済かつ電話(K)申込ありのため、携帯法・犯収法の両方で必須です。'
            :identityAtReception
              ?'受付時確認済の場合は、電話(K)申込なしでも担当者氏名が必要です。'
              :'電話(K)申込ありの場合は担当者氏名が必要です。');
      }else if(identityKnown && noPhoneK){
        empty(staffLabel,309,
          '受付時確認済ではなく、電話(K)申込もないため担当者氏名は空欄です。');
      }else{
        pending(staffLabel,309,
          '受付時確認済か電話(K)申込ありかの判断に必要な選択値を取得できません。担当者氏名の要否を目視確認してください。');
      }
      return results;
    }

    function esc(s) { return String(s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
    const host=document.createElement('div');
    host.id=HOST_ID;
    host.style.cssText='position:fixed;right:14px;bottom:14px;z-index:2147483646';
    const shadow=host.attachShadow({mode:'open'});
    shadow.innerHTML=`
      <style>
        *{box-sizing:border-box}
        .panel{width:440px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);max-height:calc(100dvh - 16px);min-height:0;display:flex;flex-direction:column;overflow:hidden;font:12px/1.55 -apple-system,BlinkMacSystemFont,Meiryo,sans-serif;color:#20384b;background:#fff;border:1px solid #ccd9e4;border-radius:10px;box-shadow:0 5px 23px #182f492f}
        .head{background:#183955;color:#fff;padding:8px 10px;display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:44px;flex:0 0 auto;font-weight:700;border-radius:9px 9px 0 0;cursor:move;touch-action:none;user-select:none;-webkit-user-select:none}
        .head>span{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
        .head>div{display:flex;align-items:center;gap:6px;flex:0 0 auto}
        button{font:inherit;cursor:pointer;padding:7px 9px;border:1px solid #b6c9d8;border-radius:5px;background:#f8fbfd;color:#20425e}
        button:focus-visible{outline:2px solid #136c9e;outline-offset:2px}
        .head button{display:inline-flex;align-items:center;justify-content:center;min-width:30px;min-height:30px;padding:0 5px;flex:0 0 auto;color:#fff;border:0;background:transparent;font-size:19px}
        .body{padding:10px;min-height:0;flex:1 1 auto;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scrollbar-width:thin}.note{font-size:11px;color:#506a7a}.buttons{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}.primary{background:#136c9e;color:white;border-color:#136c9e}
        .entryModeRow{display:flex;align-items:center;gap:6px;flex-wrap:wrap;padding:8px;margin:9px 0;background:#eff5fa;border-radius:5px;font-size:11px}
        .entryModeRow label{font-weight:700}
        .entryModeRow select{min-width:125px;flex:1 1 auto;padding:6px;border:1px solid #b6c9d8;border-radius:5px;background:#fff;font:inherit}
        .entryModeRow small{color:#667}
        .stats{display:flex;gap:5px;flex-wrap:wrap;margin:8px 0}.stat{background:#edf3f7;padding:5px 7px;border-radius:5px}.stat b{font-size:15px}
        .tablebox{max-height:350px;max-height:min(350px,40vh);overflow:auto;border:1px solid #dce5eb;border-radius:5px;margin-top:8px}
        table{width:100%;border-collapse:collapse;font-size:11px}td,th{padding:7px 6px;text-align:left;vertical-align:top;border-bottom:1px solid #e3e9ee}th{background:#edf3f8;position:sticky;top:0}.bad{color:#b42318;font-weight:700}.good{color:#136d3c}.pending{color:#9d670f}.skip{color:#667}
        .jump{display:block;text-align:left;border:0;background:transparent;color:#17648a;padding:0;text-decoration:underline}
        .review{display:flex;align-items:center;gap:4px;white-space:nowrap;cursor:pointer;color:#405668;font-size:11px}
        .review input{width:15px;height:15px;accent-color:#147d64;cursor:pointer}
        .opsummary{padding:8px;margin:8px 0;border:1px solid #bad4e7;border-radius:6px;background:#f4f9fc;font-size:11px}
        .opsummary strong{font-size:12px}
        .opsummary .small{display:block;color:#506a7a;margin-top:2px}
        .reviewed{background:#f3f7f6}.reviewed .review{color:#136d3c}
        .reviewNotice{background:#fff8e8;border:1px solid #f2d29a;color:#78520b;padding:7px 8px;border-radius:5px;font-size:11px;margin-top:8px}
        .resultBanner{display:none;padding:11px 12px;margin:10px 0;border:1px solid;border-radius:7px}
        .resultBanner.show{display:block}
        .resultBanner.ok{background:#eef8f1;border-color:#88c5a0;color:#176337}
        .resultBanner.review{background:#fffaee;border-color:#dfc57e;color:#77510f}
        .resultBanner.warning{background:#fff1ef;border-color:#e5aca4;color:#982b23}
        .resultBanner strong{display:block;font-size:15px;line-height:1.4}
        .resultBanner span{display:block;font-size:11px;margin-top:4px}
        .hidden .body{display:none}.hidden .head{border-radius:9px}textarea{width:100%;font:11px monospace;min-height:115px}
      </style>
      <div class="panel"><div class="head" title="ドラッグで移動できます"><span>auひかりプラス｜DB不備チェック v1.7.9</span><div><button id="fold" type="button" title="折りたたみ・展開">−</button><button id="close" type="button" title="閉じる">×</button></div></div>
      <div class="body">
        <div class="reviewNotice">このツールは確認箇所を示す補助です。「目視済」はその項目の確認記録であり、案件の合格・差戻し確定ではありません。最終判断は担当者がマニュアルをもとに実施してください。</div>
        <div class="entryModeRow"><label for="entryRoute">エントリー経由</label>
        <select id="entryRoute" aria-label="エントリー経由">
        <option value="AUTO">自動判定（推奨）</option><option value="BIG">BIG経由（P列・手動）</option>
        <option value="KDDI">KDDI経由（Q列・手動）</option></select><small>マニュアル 2026/11/20</small>
        <div id="entryRouteResult" role="status" style="width:100%;color:#445b6c">チェック時にISPと本人確認方式から判定します。</div></div>
        <div class="buttons"><button id="run" class="primary" type="button">不備候補を確認</button><button id="copy" type="button" disabled>要確認だけコピー</button><button id="copyAll" type="button" disabled>全結果コピー</button></div>
        <div id="status" role="status">詳細タブを開いて実行してください。閉じた項目セクションはチェック時に一時展開します。</div>
        <div id="resultBanner" class="resultBanner" role="status" aria-live="polite"></div>
        <div id="counts" class="stats"></div>
        <div id="opSummary" class="opsummary" aria-live="polite">OP名称照合は未実行です。</div>
        <div class="buttons" id="filters"><button type="button" data-filter="未確認">未確認（警告＋保留＋業務）</button><button type="button" data-filter="要修正候補">要修正候補</button><button type="button" data-filter="判定保留">判定保留</button><button type="button" data-filter="OP照合">OP名称照合</button><button type="button" data-filter="すべて">全ルール</button></div>
        <div class="tablebox"><table><thead><tr><th>対象（クリックで移動）</th><th>判定・理由</th><th>目視</th></tr></thead><tbody id="items"><tr><td colspan="3">未実行</td></tr></tbody></table></div>
        <div id="copyFallback" style="display:none;margin-top:8px"><div class="note">項目名・判定・理由のみ（顧客入力値なし）。必要なら全選択して Ctrl+C でコピーできます。</div><textarea id="backup" readonly></textarea></div>
        </div></div>`;
    document.body.appendChild(host);
    const $=id=>shadow.getElementById(id);
    let latest=null, filter='未確認', reviewed=new Set(), navigating=false;
    const colors={'要修正候補':'bad','適合候補':'good','判定保留':'pending','対象外':'skip','業務アラート':'pending'};
    const needsHumanReview = (r) => r.status==='要修正候補'||r.status==='判定保留'||r.status==='業務アラート';
    const reviewKey = (r) => String(r.row)+'|'+r.label+'|'+r.status+'|'+r.reason;

    function summarizeOp(results){
      const checks=results.filter(r=>r.label.startsWith('OP照合｜'));
      const count=status=>checks.filter(r=>r.status===status).length;
      const unknown=results.filter(r=>r.label.startsWith('未識別OP選択｜') || r.label==='読み取り不可OP欄').length;
      const unscanned=results.some(r=>r.label==='投入備考［OP照合］' && r.status==='判定保留');
      const gate=results.find(r=>r.label==='OPチェック［前後確一本化案件］');
      const namesMatch=count('適合候補');
      return {checked:checks.length,matched:namesMatch,mismatches:count('要修正候補'),pending:count('判定保留'),unknown,unscanned,gateStatus:gate?.status||null};
    }
    function opSummaryLine(op){
      if(op.gateStatus==='対象外') return 'OPチェック：前後確一本化案件が「対象外」のためスキップ';
      if(op.gateStatus==='判定保留') return 'OPチェック：前後確一本化案件の区分が未確認のため保留';
      if(op.unscanned) return 'OP照合：投入備考を取得できず判定保留';
      if(op.checked===0) return 'OP照合：登録8サービスについて照合対象がありません（辞書外OPは目視）';
      return `OP名称照合：対象${op.checked}件／名称一致${op.matched}件／不一致候補${op.mismatches}件／保留${op.pending}件／未識別・読取不可OP欄${op.unknown}件。`;
    }
    // チェック後に項目が閉じたり再描画された場合も、移動時に対象を再特定する。
    // 入力値は検索せず、表示中のフィールドラベルとセクション見出しのみで特定する。
    function composedContains(ancestor, child) {
      for(let p=child,n=0;p&&n<70;p=parentOf(p),n++) if(p===ancestor) return true;
      return false;
    }
    function findVisibleLabel(name, section) {
      if(!name) return null;
      const matched=[];
      for(const root of getRoots().roots){
        for(const el of root.querySelectorAll(LABEL_SELECTOR)){
          if(!inTool(el)&&visible(el)&&titleText(el)===name) matched.push(el);
        }
      }
      if(!matched.length) return null;
      if(section){
        const inSection=matched.filter(el=>sectionOf(el)===section);
        if(inSection.length===1) return inSection[0];
        // 同名欄が複数ある時は、間違った入力欄へ移動させない。
        return matched.length===1 ? matched[0] : null;
      }
      return matched.length===1 ? matched[0] : null;
    }
    // 特定の項目だけを探すため、関係ないトグルは検索後に元へ戻す。
    // Salesforceのアコーディオンは兄弟を開くと前のセクションを閉じる場合があるため、
    // 見つかった後には別のトグルを一切触らない。
    function toggleScope(button) {
      const section=button.closest('.slds-accordion__section,.slds-section,records-record-layout-block,.pbSubsection');
      if(section) return section;
      const id=button.getAttribute('aria-controls');
      if(!id) return null;
      for(const root of getRoots().roots) {
        const match=[...root.querySelectorAll('[id]')].find(el=>el.id===id);
        if(match) return match;
      }
      return null;
    }
    function toggleRelevance(button, r) {
      let priority=0;
      const original=r.target;
      if(original?.isConnected){
        const scope=toggleScope(button);
        if(scope && composedContains(scope,original)) priority+=100;
      }
      const heading=clean(button.textContent).normalize('NFKC');
      const sectionName=clean(r.targetSection).normalize('NFKC');
      if(sectionName && (heading===sectionName || heading.includes(sectionName))) priority+=30;
      return priority;
    }
    async function revealTarget(r){
      const resolved=()=> {
        const original=r.target;
        if(original?.isConnected && visible(original) && titleText(original)===r.targetLabel) return original;
        return findVisibleLabel(r.targetLabel,r.targetSection);
      };
      let target=resolved();
      if(target) return target;
      const tried=new WeakSet();
      let count=0;
      async function search(scope,depth){
        if(depth>6 || count>=45) return null;
        const candidates=closedSectionButtons()
          .filter(b=>!tried.has(b) && (!scope || composedContains(scope,b)))
          .sort((a,b)=>toggleRelevance(b,r)-toggleRelevance(a,r));
        for(const button of candidates){
          if(count>=45) break;
          if(!button.isConnected || !visible(button) || button.getAttribute('aria-expanded')!=='false') continue;
          tried.add(button);
          count++;
          try{ button.click(); }catch{ continue; }
          await waitForDom(250);
          target=resolved();
          if(target) return target;
          const innerScope=toggleScope(button);
          // まず開いたセクション内の入れ子トグルを探索。
          if(innerScope) {
            target=await search(innerScope,depth+1);
            if(target) return target;
          }
          // 違うセクションだった時だけ閉じる。見つかった側は必ず開いたまま。
          if(button.isConnected && button.getAttribute('aria-expanded')==='true'){
            try{button.click();}catch{ /* 開閉不可の場合は目視確認 */ }
            await waitForDom(75);
          }
        }
        return null;
      }
      return await search(null,0);
    }
    function emphasizeTarget(el){
      const prev={outline:el.style.outline,outlineOffset:el.style.outlineOffset,background:el.style.backgroundColor};
      el.style.outline='3px solid #e7a21a';
      el.style.outlineOffset='4px';
      el.style.backgroundColor='#fff1bd';
      setTimeout(()=>{
        if(!el.isConnected) return;
        if(el.style.outline==='3px solid rgb(231, 162, 26)' || el.style.outline==='3px solid #e7a21a'){
          el.style.outline=prev.outline;
          el.style.outlineOffset=prev.outlineOffset;
          el.style.backgroundColor=prev.background;
        }
      },3500);
    }
    async function jumpToResult(r){
      if(navigating || $('run').disabled) return;
      navigating=true;
      $('status').textContent='移動先の項目を探しています…';
      try{
        let target=await revealTarget(r);
        if(!target || !visible(target)){
          $('status').textContent='「'+r.targetLabel+'」へ移動できません。該当セクションを手動で開いて確認してください。';
          return;
        }
        // Lightning側の描画が落ち着いてから、別の開閉操作はせず移動する。
        await waitForDom(300);
        if(!target.isConnected || !visible(target)){
          target=findVisibleLabel(r.targetLabel,r.targetSection);
        }
        if(!target || !visible(target)){
          $('status').textContent='対象項目が再描画されたため移動できません。セクションを手動で開いてください。';
          return;
        }
        target.scrollIntoView({behavior:'auto',block:'center',inline:'nearest'});
        emphasizeTarget(target);
        $('status').textContent='「'+r.targetLabel+'」へ移動しました。該当セクションは開いたままです。';
      }catch{
        $('status').textContent='移動できませんでした。該当セクションを手動で開いてご確認ください。';
      }finally{
        navigating=false;
      }
    }

    function getAuditOutcome(results,unfinished=0){
      const bad=results.filter(r=>r.status==='要修正候補').length;
      const pendingCount=results.filter(r=>r.status==='判定保留').length;
      const actionCount=results.filter(r=>r.status==='業務アラート').length;
      if(bad>0)return {kind:'warning',title:'要修正候補あり：'+bad+'件',
        detail:pendingCount>0?'判定保留 '+pendingCount+'件もあります。各項目を確認してください。':'不備候補を確認してください。最終判断は担当者が行います。'};
      if(pendingCount>0||unfinished>0||!results.length||actionCount>0)return {kind:'review',title:actionCount>0?'不備候補0件・要業務対応：'+actionCount+'件':'要修正候補0件・要目視確認',
        detail:(pendingCount>0?'判定保留 '+pendingCount+'件。':'')+(unfinished>0?'展開できないセクション '+unfinished+'件。':'')+(actionCount>0?'入力が必要な業務アラート '+actionCount+'件。':'')+'確認が必要な項目があるため、作業完了とは断定できません。'};
      return {kind:'ok',title:'✓ 不備候補なし',
        detail:'自動チェック対象ルールでは不備候補を検出しませんでした。最終確認は担当者が行ってください。'};
    }
    function showAuditOutcome(){
      const banner=$('resultBanner');
      banner.className='resultBanner';banner.replaceChildren();
      if(!latest)return;
      const outcome=getAuditOutcome(latest.results,latest.unfinished||0);
      banner.className='resultBanner show '+outcome.kind;
      const title=document.createElement('strong');title.textContent=outcome.title;
      const detail=document.createElement('span');detail.textContent=outcome.detail;
      banner.append(title,detail);
    }
    function draw() {
      if(!latest) return;
      showAuditOutcome();
      $('counts').replaceChildren();
      const os=summarizeOp(latest.results);
      $('opSummary').replaceChildren();
      const strong=document.createElement('strong');strong.textContent=opSummaryLine(os);
      const small=document.createElement('span');small.className='small';small.textContent=os.gateStatus==='対象外' ? 'OP1・OP2～16・投入備考とのOP関連照合をスキップしました。電話・Wi-Fi等の通常入力チェックは継続します。' : os.gateStatus==='判定保留' ? '一本化区分を確認してからOPチェックを実施してください。' : '一致は登録8サービスの名称照合結果です。OP1・電話(K)・Wi-Fiパックは別ルール。料金・AC備考は本ツールのチェック対象外です。';
      $('opSummary').append(strong,small);
      const flags=latest.results.filter(needsHumanReview);
      const reviewedCount=flags.filter(r=>reviewed.has(reviewKey(r))).length;
      const set=[['検出ラベル',latest.fieldCount],['試作ルール',latest.results.length],['要修正候補',latest.results.filter(r=>r.status==='要修正候補').length],['判定保留',latest.results.filter(r=>r.status==='判定保留').length],['業務アラート',latest.results.filter(r=>r.status==='業務アラート').length],['目視済（警告）',reviewedCount+'/'+flags.length]];
      for(const [name,num] of set){const sp=document.createElement('span');sp.className='stat';sp.textContent=name+' ';const b=document.createElement('b');b.textContent=num;sp.appendChild(b);$('counts').appendChild(sp);}
      $('items').replaceChildren();
      const selected=latest.results.filter(r=>filter==='すべて'||(filter==='未確認' ? needsHumanReview(r)&&!reviewed.has(reviewKey(r)) : filter==='OP照合' ? r.label.startsWith('OP照合｜') || r.label.startsWith('OP重複申込｜') || r.label.startsWith('未識別OP選択｜') || r.label==='読み取り不可OP欄' || r.label==='投入備考［OP照合］' || r.label==='OPチェック［前後確一本化案件］' : r.status===filter));
      for(const r of selected){
        const tr=document.createElement('tr'),a=document.createElement('td'),b=document.createElement('td'),c=document.createElement('td');
        if(reviewed.has(reviewKey(r))) tr.classList.add('reviewed');
        const link=document.createElement('button');link.type='button';link.className='jump';link.textContent=r.label + (Number.isInteger(r.row)&&r.row>0?'（行'+r.row+'）':'');
        link.addEventListener('click',()=>{void jumpToResult(r);});
        a.appendChild(link);
        const st=document.createElement('div');st.className=colors[r.status]||'pending';st.textContent=r.status;
        const why=document.createElement('div');why.textContent=r.reason;b.append(st,why);
        if(needsHumanReview(r)) {
          const wrapper=document.createElement('label');wrapper.className='review';
          const checkbox=document.createElement('input');checkbox.type='checkbox';checkbox.checked=reviewed.has(reviewKey(r));
          const label=document.createElement('span');label.textContent='確認済';wrapper.append(checkbox,label);
          checkbox.addEventListener('change',()=>{
            const key=reviewKey(r);
            if(checkbox.checked) reviewed.add(key);else reviewed.delete(key);
            draw();
          });
          c.appendChild(wrapper);
        }else c.textContent='—';
        tr.append(a,b,c);$('items').appendChild(tr);
      }
      if(!selected.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=3;td.textContent=filter==='未確認'?'未確認の警告・判定保留はありません。ただし、案件全体の目視確認は必要です。':'この条件に該当する項目はありません。';tr.appendChild(td);$('items').appendChild(tr);}
    }
    function clearResults(message) {
      latest=null;reviewed.clear();
      showAuditOutcome();
      $('copy').disabled=true;$('copyAll').disabled=true;
      $('counts').replaceChildren();
      $('opSummary').textContent='対象外のため照合は実施していません。';
      $('items').replaceChildren();
      const tr=document.createElement('tr'),td=document.createElement('td');
      td.colSpan=3;td.textContent=message;tr.appendChild(td);$('items').appendChild(tr);
      $('copyFallback').style.display='none';$('status').textContent=message;
    }
    $('entryRoute').addEventListener('change',()=>{
      $('entryRouteResult').textContent=$('entryRoute').value==='AUTO'
        ?'チェック時にISPと本人確認方式から判定します。'
        :'手動選択中です。案件が変わったら経由を再確認してください。';
      if(latest)clearResults('エントリー経由の判定方式を変更しました。再チェックしてください。');
    });
    $('run').addEventListener('click',async()=>{
      const routeMode=$('entryRoute').value;
      if (!isRecordDetailPage()) {
        $('status').textContent='申込共通の案件詳細画面でのみ実行できます。対象画面を開いてください。';
        return;
      }
      const runButton=$('run');
      runButton.disabled=true;
      $('resultBanner').className='resultBanner';
      $('status').textContent='閉じたセクションを一時展開し、項目を読み取っています…';
      let opened=[];
      try{
        const expansion=await openSectionsForAudit();
        opened=expansion.opened;
        const d=scan();
        // auひかりプラス以外の商材へ誤って別マニュアルを適用しない。
        const product=d.fields.filter(f=>f.name==='商材'&&f.state==='値あり');
        if (product.length && !product.some(f=>/auひかりプラス/.test(f.value))) {
          clearResults('この案件はauひかりプラスではないため、チェックを実行しません。');
          return;
        }
        const menu=d.fields.find(f=>f.name==='お申し込みメニュー' && f.state==='値あり');
        if (menu && /タイプ[12]/.test(normalize(menu.value))) {
          clearResults('タイプ1・タイプ2は現在の業務対象外のため、チェックを実行しません。');
          return;
        }
        const inference=inferEntryRoute(d.fields);
        const entryRoute=routeMode==='AUTO'?inference.route:routeMode;
        const routeSummary=routeMode==='AUTO'
          ?(entryRoute?'自動判定：'+(entryRoute==='BIG'?'BIG経由（P列）':'KDDI経由（Q列）')+'｜'+inference.reason:'自動判定不可：'+inference.reason)
          :'手動指定：'+(entryRoute==='BIG'?'BIG経由（P列）':'KDDI経由（Q列）')+
            (inference.route&&inference.route!==entryRoute?'｜自動判定と不一致。確認してください。':'');
        $('entryRouteResult').textContent=routeSummary;
        if(!entryRoute){
          clearResults('エントリー経由を自動判定できませんでした。本人確認方式を確認し、BIG経由かKDDI経由を手動選択して再実行してください。');
          return;
        }
        const res=runRules(d.fields,entryRoute);
        if(routeMode!=='AUTO'&&inference.route&&inference.route!==entryRoute){
          const isp=d.fields.find(f=>/^(?:お申し込みのプロバイダ|ISP|申込ISP)$/.test(normalize(f.name)))||null;
          res.unshift({
            label:'エントリー経由［手動選択と自動判定の相違］',row:0,status:'判定保留',
            reason:'手動選択した経由と、ISP・本人確認方式から推定した経由が異なります。経由を確認してください。',
            target:isp?.labelNode||null,targetLabel:isp?.name||'お申し込みのプロバイダ',targetSection:isp?.section||''
          });
        }
        reviewed.clear();latest={fieldCount:d.fields.length,results:res,unfinished:expansion.unopened,entryRoute,routeMode};
        const unfinished=expansion.unopened;
        $('status').textContent=`${res.length}件の試作ルールを判定しました。${unfinished?'展開できないセクションが'+unfinished+'件あり、該当項目は目視確認が必要です。':'閉じていたセクションも読み取りました。'} 最終判断は目視でお願いします。再実行で目視済チェックはリセットされます。`;
        $('copy').disabled=false;$('copyAll').disabled=false;$('copyFallback').style.display='none';filter='未確認';draw();
      }catch(e){$('status').textContent='読み取りエラーです。詳細タブを開き直してから再試行してください。';}
      finally{
        restoreSections(opened);
        runButton.disabled=false;
      }
    });
    $('filters').addEventListener('click',e=>{const f=e.target?.dataset?.filter;if(f){filter=f;draw();}});
    async function copyResults(all){
      if(!latest)return;
      const chosen=all?latest.results:latest.results.filter(r=>r.status==='要修正候補'||r.status==='判定保留'||r.status==='業務アラート');
      const header='FTシステム | Salesforce 不備チェック v1.7.9｜'+(all?'全ルール':'要修正候補・判定保留のみ')+'（顧客入力値・URLなし）';
      const t=header+'\nエントリー経由：'+latest.entryRoute+'（'+(latest.entryRoute==='BIG'?'P':'Q')+'列・'+(latest.routeMode==='AUTO'?'自動判定':'手動指定')+'）\n'+opSummaryLine(summarizeOp(latest.results))+'\n'+chosen.map(r=>[r.label,Number.isInteger(r.row)&&r.row>0?'行'+r.row:'',r.status,r.reason].join('\t')).join('\n');
      $('copyFallback').style.display='block';$('backup').value=t;
      try{await navigator.clipboard.writeText(t);$('status').textContent=`${chosen.length}件をコピーしました。入力値・URLは含みません。`;}
      catch{$('backup').focus();$('backup').select();$('status').textContent='自動コピー不可：下のテキストを Ctrl+C でコピーしてください。';}
    }
    $('copy').addEventListener('click',()=>copyResults(false));
    $('copyAll').addEventListener('click',()=>copyResults(true));
    // タイトルバーのドラッグ移動。入力値・座標の永続保存はしない。
    // ボタン操作は妨げず、別ウィンドウや iframe にも影響しない。
    const dragHead = shadow.querySelector('.head');
    let dragging = null;
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const setPanelPosition = (left, top) => {
      const rect = host.getBoundingClientRect();
      const availableWidth = document.documentElement.clientWidth || window.innerWidth;
      const availableHeight = document.documentElement.clientHeight || window.innerHeight;
      const x = clamp(left, 0, Math.max(0, availableWidth - rect.width));
      const y = clamp(top, 0, Math.max(0, availableHeight - rect.height));
      host.style.left = x + 'px';
      host.style.top = y + 'px';
      host.style.right = 'auto';
      host.style.bottom = 'auto';
    };
    dragHead.addEventListener('pointerdown', (event) => {
      if (event.target.closest('button') || (event.pointerType === 'mouse' && event.button !== 0) || event.isPrimary === false) return;
      const rect = host.getBoundingClientRect();
      dragging = { id: event.pointerId, startX: event.clientX, startY: event.clientY, left: rect.left, top: rect.top };
      try { dragHead.setPointerCapture(event.pointerId); } catch { dragging = null; return; }
      event.preventDefault();
    });
    dragHead.addEventListener('pointermove', (event) => {
      if (!dragging || dragging.id !== event.pointerId) return;
      setPanelPosition(dragging.left + event.clientX - dragging.startX,
                       dragging.top + event.clientY - dragging.startY);
      event.preventDefault();
    });
    const finishDrag = (event) => {
      if (!dragging || dragging.id !== event.pointerId) return;
      dragging = null;
      try { if (dragHead.hasPointerCapture(event.pointerId)) dragHead.releasePointerCapture(event.pointerId); } catch { /* noop */ }
    };
    dragHead.addEventListener('pointerup', finishDrag);
    dragHead.addEventListener('pointercancel', finishDrag);
    dragHead.addEventListener('lostpointercapture', () => { dragging = null; });
    // 画面サイズが変わったら、表示領域からはみ出さない位置へ補正。
    window.addEventListener('resize', () => {
      if (!host.isConnected || host.style.left === '') return;
      const rect = host.getBoundingClientRect();
      setPanelPosition(rect.left, rect.top);
    });
    $('fold').addEventListener('click',()=>{const p=shadow.querySelector('.panel');p.classList.toggle('hidden');$('fold').textContent=p.classList.contains('hidden')?'+':'−';});
    $('close').addEventListener('click',()=>host.remove());

  }
})();
