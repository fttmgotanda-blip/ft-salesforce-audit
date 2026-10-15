// ==UserScript==
// @name         FT | Salesforce 不備チェック補助 v1.4（パネル移動対応）
// @name:ja      FTシステム | Salesforce 不備チェック
// @namespace    https://firstteam.local/userscripts
// @version      1.7.0
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
    // 以下は2026-10-09版「DB不備チェック」マニュアルの一部を用いた先行PoC。
    // Salesforceの顧客入力値はブラウザ内だけで比較し、一覧・コピー文面には出さない。
    // マニュアルの全項目・通話記録・他システムとの整合性を保証するものではありません。
    const normalize = (v) => clean(v).normalize('NFKC');
    // 姓と名の間のスペースだけによる誤判定を避ける。音や漢字の違いを曖昧一致とはしない。
    const nameKey = (v) => normalize(v).replace(/[\s\u3000]+/g, '');
    function runRules(fields) {
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
        const key=label+'|'+row;
        if(seen.has(key)) return;
        seen.add(key);
        const f=field(targetLabel);
        results.push({label,row,status,reason,target:f.labelNode||null,targetLabel,targetSection:f.section||''});
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

      // マニュアル192行はタイプ限定ではなく各ISP共通。
      const op=field('プロバイダOP1');
      if(unknown(op))pending('プロバイダOP1［おトクプラン］',192,'表示値を読み取れません。','プロバイダOP1');
      else if(op.state!=='値あり')emit('プロバイダOP1［おトクプラン］',192,'要修正候補','必須のおトクプラン（2年契約）が未選択の可能性があります。','プロバイダOP1');
      else {
        const txt=normalize(op.value);
        const ok=/おトクプラン/.test(txt)&&/2年/.test(txt);
        emit('プロバイダOP1［おトクプラン］',192,ok?'適合候補':'要修正候補',ok?'必須プランの表示が確認できました。':'おトクプラン（2年契約）を選択してください。','プロバイダOP1');
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
        const appClass=val('タイプ3-申し込み区分');
        if(appClass===null)pending('タイプ3-新規／転用／事変',263,'申込区分を読み取れません。','タイプ3-申し込み区分');
        else {
          const fresh=appClass.includes('新規');
          const transfer=appClass.includes('転用');
          const switched=appClass.includes('事業者変更');
          if(fresh){
            required('タイプ3-工事希望日(西暦)',290,'新規では工事希望日が必須です。');
            required('タイプ3-工事希望時間帯',292,'新規では工事希望時間帯が必須です。');
            empty('タイプ3-転用/事業者変更希望日',295,'新規では不要です。');
            required('初期費用請求区分',329,'新規では初期費用請求区分が必須です。');
          }else if(transfer||switched){
            empty('タイプ3-工事希望日(西暦)',291,'転用／事業者変更では記載不可です。');
            empty('タイプ3-工事希望時間帯',293,'転用／事業者変更では記載不可です。');
            required('タイプ3-転用/事業者変更希望日',294,'転用／事業者変更では必須です。');
            empty('初期費用請求区分',330,'転用／事業者変更では記載不可です。');
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
          const occupation=val('職業');
          if(occupation!==null){
            const job=normalize(occupation);
            // 複数の職業が明確な区切りで列挙されている場合は備考必須。
            // 「・」「／」は単一の職業区分名にも使われるため断定せず目視保留。
            if(/その他/.test(job) || /[、,，;；]/.test(job) || /(?:複数職業|兼業)/.test(job))
              required('職業備考欄',315,'職業が「その他」、または複数の職業が申告されている場合は備考が必要です。');
            else if(/[・／/+＋]/.test(job))
              pending('職業備考欄［複数職業の確認］',315,
                '職業欄の区切りが単一の選択肢か複数職業かを確認し、複数なら備考欄の入力を確認してください。','職業備考欄');
          }
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
            const pick=val('電話(N)-電話番号選択');
            if(pick===null)pending('電話(N)-電話番号引継条件',273,'番号選択を確認できません。','電話(N)-電話番号選択');
            else if(pick.includes('現在')&&pick.includes('継続')){
              [ ['電話(N)-番ポ旧事業者コード',273],['電話(N)-電話番号',274],
                ['電話(N)-番ポ契約者姓カナ',275],['電話(N)-番ポ契約者名カナ',276],
                ['電話(N)-番ポ契約者姓漢字',277],['電話(N)-番ポ契約者名漢字',278]
              ].forEach(([label,row])=>required(label,row,'現在の電話番号を引き継ぐため必須です。'));
            }else if(pick.includes('新番')){
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
        .hidden .body{display:none}.hidden .head{border-radius:9px}textarea{width:100%;font:11px monospace;min-height:115px}
      </style>
      <div class="panel"><div class="head" title="ドラッグで移動できます"><span>auひかりプラス｜DB不備チェック v1.7.0</span><div><button id="fold" type="button" title="折りたたみ・展開">−</button><button id="close" type="button" title="閉じる">×</button></div></div>
      <div class="body">
        <div class="reviewNotice">このツールは確認箇所を示す補助です。「目視済」はその項目の確認記録であり、案件の合格・差戻し確定ではありません。最終判断は担当者がマニュアルをもとに実施してください。</div>
        <div class="buttons"><button id="run" class="primary" type="button">不備候補を確認</button><button id="copy" type="button" disabled>要確認だけコピー</button><button id="copyAll" type="button" disabled>全結果コピー</button></div>
        <div id="status" role="status">詳細タブを開いて実行してください。閉じた項目セクションはチェック時に一時展開します。</div>
        <div id="counts" class="stats"></div>
        <div id="opSummary" class="opsummary" aria-live="polite">OP名称照合は未実行です。</div>
        <div class="buttons" id="filters"><button type="button" data-filter="未確認">未確認（警告＋保留）</button><button type="button" data-filter="要修正候補">要修正候補</button><button type="button" data-filter="判定保留">判定保留</button><button type="button" data-filter="OP照合">OP名称照合</button><button type="button" data-filter="すべて">全ルール</button></div>
        <div class="tablebox"><table><thead><tr><th>対象（クリックで移動）</th><th>判定・理由</th><th>目視</th></tr></thead><tbody id="items"><tr><td colspan="3">未実行</td></tr></tbody></table></div>
        <div id="copyFallback" style="display:none;margin-top:8px"><div class="note">項目名・判定・理由のみ（顧客入力値なし）。必要なら全選択して Ctrl+C でコピーできます。</div><textarea id="backup" readonly></textarea></div>
        </div></div>`;
    document.body.appendChild(host);
    const $=id=>shadow.getElementById(id);
    let latest=null, filter='未確認', reviewed=new Set(), navigating=false;
    const colors={'要修正候補':'bad','適合候補':'good','判定保留':'pending','対象外':'skip'};
    const needsHumanReview = (r) => r.status==='要修正候補'||r.status==='判定保留';
    const reviewKey = (r) => String(r.row)+'|'+r.label+'|'+r.status+'|'+r.reason;

    function summarizeOp(results){
      const checks=results.filter(r=>r.label.startsWith('OP照合｜'));
      const count=status=>checks.filter(r=>r.status===status).length;
      const unknown=results.filter(r=>r.label.startsWith('未識別OP選択｜') || r.label==='読み取り不可OP欄').length;
      const unscanned=results.some(r=>r.label==='投入備考［OP照合］' && r.status==='判定保留');
      const namesMatch=count('適合候補');
      return {checked:checks.length,matched:namesMatch,mismatches:count('要修正候補'),pending:count('判定保留'),unknown,unscanned};
    }
    function opSummaryLine(op){
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

    function draw() {
      if(!latest) return;
      $('counts').replaceChildren();
      const os=summarizeOp(latest.results);
      $('opSummary').replaceChildren();
      const strong=document.createElement('strong');strong.textContent=opSummaryLine(os);
      const small=document.createElement('span');small.className='small';small.textContent='一致は登録8サービスの名称照合結果です。OP1・電話(K)・Wi-Fiパックは別ルール。料金・AC備考は本ツールのチェック対象外です。';
      $('opSummary').append(strong,small);
      const flags=latest.results.filter(needsHumanReview);
      const reviewedCount=flags.filter(r=>reviewed.has(reviewKey(r))).length;
      const set=[['検出ラベル',latest.fieldCount],['試作ルール',latest.results.length],['要修正候補',latest.results.filter(r=>r.status==='要修正候補').length],['判定保留',latest.results.filter(r=>r.status==='判定保留').length],['目視済（警告）',reviewedCount+'/'+flags.length]];
      for(const [name,num] of set){const sp=document.createElement('span');sp.className='stat';sp.textContent=name+' ';const b=document.createElement('b');b.textContent=num;sp.appendChild(b);$('counts').appendChild(sp);}
      $('items').replaceChildren();
      const selected=latest.results.filter(r=>filter==='すべて'||(filter==='未確認' ? needsHumanReview(r)&&!reviewed.has(reviewKey(r)) : filter==='OP照合' ? r.label.startsWith('OP照合｜') || r.label.startsWith('未識別OP選択｜') || r.label==='読み取り不可OP欄' || r.label==='投入備考［OP照合］' : r.status===filter));
      for(const r of selected){
        const tr=document.createElement('tr'),a=document.createElement('td'),b=document.createElement('td'),c=document.createElement('td');
        if(reviewed.has(reviewKey(r))) tr.classList.add('reviewed');
        const link=document.createElement('button');link.type='button';link.className='jump';link.textContent=r.label + '（行'+r.row+'）';
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
      $('copy').disabled=true;$('copyAll').disabled=true;
      $('counts').replaceChildren();
      $('opSummary').textContent='対象外のため照合は実施していません。';
      $('items').replaceChildren();
      const tr=document.createElement('tr'),td=document.createElement('td');
      td.colSpan=3;td.textContent=message;tr.appendChild(td);$('items').appendChild(tr);
      $('copyFallback').style.display='none';$('status').textContent=message;
    }
    $('run').addEventListener('click',async()=>{
      if (!isRecordDetailPage()) {
        $('status').textContent='申込共通の案件詳細画面でのみ実行できます。対象画面を開いてください。';
        return;
      }
      const runButton=$('run');
      runButton.disabled=true;
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
        const res=runRules(d.fields);reviewed.clear();latest={fieldCount:d.fields.length,results:res};
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
      const chosen=all?latest.results:latest.results.filter(r=>r.status==='要修正候補'||r.status==='判定保留');
      const header='FTシステム | Salesforce 不備チェック v1.7.0｜'+(all?'全ルール':'要修正候補・判定保留のみ')+'（顧客入力値・URLなし）';
      const t=header+'\n'+opSummaryLine(summarizeOp(latest.results))+'\n'+chosen.map(r=>[r.label,'行'+r.row,r.status,r.reason].join('\t')).join('\n');
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
