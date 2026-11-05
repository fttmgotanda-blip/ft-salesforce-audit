// ==UserScript==
// @name         BIGLOBE光｜Kahlua DB自動不備チェック Part2（個人・法人）
// @namespace    https://first-team.local/audit
// @version      0.1.1
// @description  読み取り専用。個人・法人、複数タブ、条件付き必須・相互照合を支援。個人情報は外部送信・コピーしません。
// @match        https://kahlua.allconnect-wagby.jp/Kahlua/*
// @updateURL    https://raw.githubusercontent.com/fttmgotanda-blip/ft-salesforce-audit/main/kahlua-biglobe-audit/kahlua-biglobe-audit.user.js
// @downloadURL  https://raw.githubusercontent.com/fttmgotanda-blip/ft-salesforce-audit/main/kahlua-biglobe-audit/kahlua-biglobe-audit.user.js
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  if (!/showTAPP/i.test(location.pathname)) return;
  if (document.getElementById('ft-kahlua-audit-root')) return;

  const TITLE = 'BIGLOBE光｜DB不備チェック Part2';
  const VERSION = '0.1.1';
  const source = '【BIGLOBE光】DBマニュアル_261029.xlsx／【個人】DB不備チェック・【法人】DB不備チェック';
  const ST = {BAD:'要修正候補', OK:'適合候補', HOLD:'判定保留', SKIP:'対象外'};
  const clean = s => String(s ?? '').replace(/\u00a0/g,' ').replace(/[\u200B-\u200D\uFEFF]/g,'').trim();
  const norm = s => clean(s).normalize('NFKC').replace(/\s+/g,'').replace(/[‐‑‒–—−－]/g,'-').toLowerCase();
  const empty = s => !clean(s) || /^(?:未選択|選択してください|なし\s*選択|--+|―+)$/.test(clean(s));
  const filled = s => !empty(s);
  const isYes = s => /^(有|あり|申込|申し込み|申込み|希望|付帯|選択済|利用する|する|有効|利用あり|1|true)/i.test(norm(s));
  const isNo = s => /^(無|なし|申込なし|申し込みなし|申込みなし|付帯なし|利用しない|しない|無効|0|false)/i.test(norm(s));
  const digits = s => clean(s).replace(/[-\s]/g,'');
  const isDate = s => /\d{4}[\/-]\d{1,2}[\/-]\d{1,2}/.test(clean(s));
  const keepKey = s => norm(s).replace(/[()（）・\[\]]/g,'');
  const phoneOK = (v, lens=[10,11]) => /^\d+$/.test(digits(v)) && lens.includes(digits(v).length) && !/[-－ー\s]/.test(v);
  const emailOK = v => /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(clean(v)) && /^[\x21-\x7E]+$/.test(clean(v));
  const kanaOK = v => /^[ァ-ヶー・\s]+$/.test(clean(v));
  const roman = /[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅪⅫⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]/;
  const extChar = /[𠮷髙﨑廣栁㈱㈲①②③④⑤⑥⑦⑧⑨⑩⑪⑫❶❷❸❹]/u;
  const sleep = ms => new Promise(res=>setTimeout(res,ms));
  let mode = 'personal', records=[], items=[], latestAt='', filter='BAD', collapsed=false, busy=false;

  const root = document.createElement('section');
  root.id = 'ft-kahlua-audit-root';
  root.innerHTML = `
    <div class="ft-title" id="ft-drag"><span>🔎 ${TITLE} <small>v${VERSION}</small></span><span id="ft-collapse" title="折りたたむ">−</span></div>
    <div class="ft-inner">
      <div class="ft-kind">対象：<b id="ft-kind-label">判定中</b><span id="ft-coverage"></span></div>
      <div class="ft-actions"><button id="ft-run">不備チェック実行</button><button id="ft-scan">タブ巡回・再チェック</button></div>
      <div class="ft-sum" id="ft-summary">未実行</div>
      <div class="ft-tabs"><button data-filter="BAD">要修正候補</button><button data-filter="HOLD">判定保留</button><button data-filter="ALL">すべて</button></div>
      <div class="ft-results" id="ft-results"><div class="ft-muted">「不備チェック実行」を押してください。</div></div>
      <div class="ft-footer"><button id="ft-copy">結果を表示・コピー</button><button id="ft-clear">結果消去</button><small>画面読取のみ・外部送信なし</small></div>
      <div class="ft-message" id="ft-message"></div>
    </div>`;
  const style=document.createElement('style');
  style.textContent=`
    #ft-kahlua-audit-root{position:fixed;right:16px;top:95px;width:405px;max-width:calc(100vw - 20px);max-height:calc(100vh - 20px);z-index:2147483646;font-family:-apple-system,BlinkMacSystemFont,'Yu Gothic',Meiryo,sans-serif;font-size:12px;line-height:1.45;color:#233044;background:#fff;border:1px solid #b8c7dc;border-radius:11px;box-shadow:0 8px 30px #1b2c4e38;overflow:hidden}
    #ft-kahlua-audit-root *{box-sizing:border-box}
    #ft-kahlua-audit-root .ft-title{display:flex;align-items:center;justify-content:space-between;padding:11px 12px;background:#173355;color:white;font-size:13px;font-weight:700;cursor:move;user-select:none}
    #ft-kahlua-audit-root .ft-title small{font-size:10px;opacity:.72;font-weight:400}
    #ft-kahlua-audit-root #ft-collapse{font-size:20px;cursor:pointer;padding:0 5px}
    #ft-kahlua-audit-root .ft-inner{padding:10px;max-height:calc(100vh - 74px);overflow:auto}
    #ft-kahlua-audit-root .ft-kind{margin-bottom:9px;color:#43566f}
    #ft-kahlua-audit-root #ft-coverage{font-size:10px;float:right;color:#677d95}
    #ft-kahlua-audit-root .ft-actions{display:flex;gap:6px}
    #ft-kahlua-audit-root button{cursor:pointer;border:1px solid #c7d4e4;border-radius:6px;background:#f6f9fd;color:#1b3b60;padding:7px;font:inherit}
    #ft-kahlua-audit-root button:hover{background:#e8f1fc}
    #ft-kahlua-audit-root #ft-run{background:#165da6;border-color:#165da6;color:white;font-weight:700;flex:1}
    #ft-kahlua-audit-root #ft-scan{flex:1}
    #ft-kahlua-audit-root .ft-sum{margin:9px 0 6px;padding:9px;background:#f6f8fb;border-radius:7px;font-weight:700}
    #ft-kahlua-audit-root .ft-tabs{display:flex;gap:5px;margin-bottom:8px}
    #ft-kahlua-audit-root .ft-tabs button{flex:1;padding:5px 3px;font-size:11px}
    #ft-kahlua-audit-root .ft-tabs button.active{background:#244b78;color:#fff}
    #ft-kahlua-audit-root .ft-results{max-height:310px;min-height:45px;overflow:auto;border:1px solid #e4e9f1;border-radius:7px}
    #ft-kahlua-audit-root .ft-row{border-bottom:1px solid #ecf0f5;padding:8px;cursor:pointer}
    #ft-kahlua-audit-root .ft-row:last-child{border-bottom:0}
    #ft-kahlua-audit-root .ft-row:hover{background:#f6faff}
    #ft-kahlua-audit-root .ft-row .ft-line{display:flex;align-items:baseline;gap:6px;justify-content:space-between}
    #ft-kahlua-audit-root .ft-row b{color:#152b49}
    #ft-kahlua-audit-root .ft-row .ft-desc{font-size:11px;color:#627286;margin-top:3px;white-space:pre-wrap;overflow-wrap:anywhere}
    #ft-kahlua-audit-root .ft-row .ft-loc{font-size:10px;color:#789}
    #ft-kahlua-audit-root .ft-badge{display:inline-block;white-space:nowrap;border-radius:6px;padding:2px 5px;font-size:10px}
    #ft-kahlua-audit-root .ft-bad{color:#9d2d29;background:#ffedec}
    #ft-kahlua-audit-root .ft-hold{color:#815407;background:#fff4df}
    #ft-kahlua-audit-root .ft-ok{color:#26744a;background:#eaf8f0}
    #ft-kahlua-audit-root .ft-skip{color:#61738c;background:#e9edf2}
    #ft-kahlua-audit-root .ft-footer{display:flex;gap:5px;align-items:center;justify-content:space-between;margin-top:8px;flex-wrap:wrap}
    #ft-kahlua-audit-root .ft-footer button{font-size:11px;padding:5px}
    #ft-kahlua-audit-root .ft-footer small,.ft-muted,#ft-kahlua-audit-root .ft-message{font-size:10px;color:#708198}
    #ft-kahlua-audit-root .ft-message{margin-top:5px}
    .ft-audit-focus{outline:4px solid #efb14d!important;outline-offset:3px!important;scroll-margin-top:120px}
  `;
  document.head.appendChild(style);
  document.body.appendChild(root);
  const $=s=>root.querySelector(s);
  const say=s=>$('#ft-message').textContent=s;
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // Wagbyの詳細画面: th=ラベル、同一trのtd=表示値（textarea/selectにも対応）
  function snap(){
    const rows=[];
    for(const th of document.querySelectorAll('th')){
      if(root.contains(th)) continue;
      const tr=th.closest('tr'); if(!tr) continue;
      const ownTh=[...tr.children].find(e=>e.tagName==='TH');
      if(ownTh!==th) continue;
      const td=[...tr.children].find(e=>e.tagName==='TD'); if(!td) continue;
      const label=clean(th.textContent).replace(/\s+/g,' ');
      if(!label || label.length>90) continue;
      let value='';
      const entry=td.querySelector('textarea,select,input:not([type="hidden"]):not([type="button"]):not([type="submit"])');
      if(entry){value=entry.tagName==='SELECT' ? (entry.selectedOptions?.[0]?.textContent||entry.value) : entry.value;}
      else {value=td.innerText||td.textContent||'';}
      const pane=th.closest('[role="tabpanel"],.ui-tabs-panel,.tab-pane,.tab-content-pane,[id^="tabs-"]');
      rows.push({label,value:clean(value),element:th, pane:pane||null, paneId:pane?.id||''});
    }
    return rows;
  }
  function detectMode(){
    const title=norm(document.title+' '+(document.body?.innerText||'').slice(0,300));
    const kind=snap().find(x=>keepKey(x.label)==='顧客区分')?.value;
    if(/法人/.test(kind||'') || /法人.*詳細表示/.test(title) || /corp|company|hōjin|houjin/i.test(location.pathname)) return 'corporate';
    return 'personal';
  }
  function pick(label,opt={}){
    const labels=Array.isArray(label)?label:[label];
    for(const l of labels){
      let matches=records.filter(r=>keepKey(r.label)===keepKey(l));
      if(opt.n!==undefined){ if(matches[opt.n])return matches[opt.n]; }
      else if(matches.length===1) return matches[0];
      else if(matches.length>1 && opt.allowFirst) return matches[0];
    }
    return null;
  }
  const val=(label,opt={})=>pick(label,opt)?.value||'';
  const add=(id,label,tab,status,reason,ref=label,opt={})=>items.push({id,label,tab,status,reason,ref,opt});
  const must=(label,tab,opt={})=>{
    const r=pick(label,opt);
    if(!r)return add('required_'+label,label,tab,ST.HOLD,'画面上の項目を特定できません（別タブの読込・項目名確認が必要）。',label,opt);
    add('required_'+label,label,tab,filled(r.value)?ST.OK:ST.BAD,filled(r.value)?'入力・選択あり。':'必須項目が空欄・未選択です。',label,opt);
  };
  const when=(label,tab,required,why='',opt={})=>{
    if(!required)return add('conditional_'+label,label,tab,ST.SKIP,'この案件は必須条件の対象外です。',label,opt);
    const r=pick(label,opt);
    if(!r)return add('conditional_'+label,label,tab,ST.HOLD,'項目を特定できないため判定できません。',label,opt);
    add('conditional_'+label,label,tab,filled(r.value)?ST.OK:ST.BAD,filled(r.value)?'条件付き必須：記載あり。':(why||'この条件では入力・選択が必要です。'),label,opt);
  };
  function compare(label,tab,actual,expected,reason,ref=label,opt={}){
    const r=pick(ref,opt);
    if(!r || !filled(actual))return add('compare_'+label,label,tab,ST.HOLD,'照合する値を特定できません。',ref,opt);
    add('compare_'+label,label,tab,expected?ST.OK:ST.BAD,expected?'照合一致。':reason,ref,opt);
  }
  const hold=(label,tab,reason,ref=label,opt={})=>add('hold_'+label,label,tab,ST.HOLD,reason,ref,opt);
  function checkLen(label,tab,max,opt={}){
    const r=pick(label,opt);if(!r)return hold(label,tab,'画面の項目が見つかりません。',label,opt);
    const length=[...clean(r.value)].length;
    add('len_'+label,label,tab,empty(r.value)?ST.BAD:length>max?ST.BAD:ST.OK,empty(r.value)?'必須項目が空欄です。':length>max?`上限${max}文字を超えています。`:`上限${max}文字以内。`,label,opt);
  }
  function checkPhone(label,tab,lens=[10,11],opt={}){
    const r=pick(label,opt);if(!r)return hold(label,tab,'画面の項目が見つかりません。',label,opt);
    add('phone_'+label,label,tab,phoneOK(r.value,lens)?ST.OK:ST.BAD,phoneOK(r.value,lens)?'桁数・半角数字・ハイフンなし：OK。':`${lens.join('または')}桁の半角数字、ハイフンなしを確認してください。`,label,opt);
  }
  function checkEmail(label,tab,required,opt={}){
    const r=pick(label,opt);if(!r)return hold(label,tab,'メール欄が見つかりません。',label,opt);
    if(!required && empty(r.value))return add('mail_'+label,label,tab,ST.SKIP,'この条件ではメール欄は任意です。',label,opt);
    add('mail_'+label,label,tab,emailOK(r.value)?ST.OK:ST.BAD,emailOK(r.value)?'メール形式：OK。':'メールが空欄、またはメール形式・半角文字に問題があります。',label,opt);
  }
  const currencyNum = s => {const m=clean(s).replace(/,/g,'').match(/\d+/);return m?Number(m[0]):null};
  function ageAt(birth,date){
    const a=clean(birth).match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/),b=clean(date).match(/(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if(!a||!b)return null;
    return Number(b[1])-Number(a[1])-((+b[2]<+a[2]||(+b[2]===+a[2]&&+b[3]<+a[3]))?1:0);
  }
  function flowCheck(isCorp){
    const basic='基本情報'; const progress=val('説明書面進捗');const sent=val('説明書面発送日'); const user=val('ユーザ備考');
    must('獲得担当',basic);must('獲得日',basic);must('AC備考',basic);
    must('説明書面進捗',basic);
    const choices=[['口頭','電話説明了承済'],['メール','メール説明了承済'],['書面','書面手配済']];
    const selected=choices.filter(x=>user.includes(x[0]));
    if(selected.length!==1)hold('説明書面進捗とユーザ備考',basic,'ユーザ備考にフローテンプレが無い／複数あるため目視確認。','ユーザ備考');
    else compare('説明書面進捗とユーザ備考',basic,progress,progress.includes(selected[0][1]),'備考のフローと説明書面進捗が一致しません。','説明書面進捗');
    if(/メール説明了承済|書面手配済/.test(progress))when('説明書面発送日',basic,true,'メール送信日／書類発送日の入力が必要です。');
    else if(/電話説明了承済|書面発送待ち/.test(progress)) {
      compare('説明書面発送日',basic,'進捗あり',empty(sent),'この進捗では発送日を空欄にしてください。');
    }
    const ac=val('AC備考');
    if(ac && !/エリ確結果|エリア確認|エリ確/.test(ac))hold('AC備考：エリ確結果',basic,'エリ確結果のテンプレが見当たりません。内容を確認してください。','AC備考');
    else if(ac)add('ac_eri','AC備考：エリ確結果',basic,ST.OK,'エリ確に関する記載を検出。詳細は目視で照合。','AC備考');
    if(!isCorp){
      const age=ageAt(val('契約者生年月日'),val('獲得日'));
      if(age!==null && age>=70){
        compare('70歳以上：書面フロー',basic,progress,/書面手配済/.test(progress),'70歳以上は書面フロー必須です。','説明書面進捗');
      }else if(age===null){hold('70歳以上：書面フロー',basic,'生年月日・獲得日が読み取れず、70歳以上判定を保留。','契約者生年月日');}
      const one=val('前後確一本化案件'),fc=val('FC進捗'),date=val('FC完了日'),staff=val('FC担当者');
      must('前後確一本化案件',basic);
      if(one.includes('対象外')||one==='対象'){
        const included=one==='対象';
        compare('一本化：FC進捗','エントリ前フォローコール',fc,included?/完了/.test(fc):/未処理/.test(fc),included?'一本化対象は「完了」が必要です。':'対象外は「未処理」が必要です。','FC進捗');
        compare('一本化：FC完了日','エントリ前フォローコール',date,included?filled(date):empty(date),included?'対象はFC完了日が必要です。':'対象外はFC完了日を空欄にしてください。','FC完了日');
        compare('一本化：FC担当者','エントリ前フォローコール',staff,included?filled(staff):empty(staff),included?'対象はFC担当者が必要です。':'対象外はFC担当者を空欄にしてください。','FC担当者');
        if(/書面手配済/.test(progress) && included)compare('書面フローと一本化',basic,one,false,'書面手配済の場合「前後確一本化案件」は対象外です。','前後確一本化案件');
      }
    }
  }
  function commonLineCheck(isCorp){
    const tab=isCorp?'法人情報':'顧客情報', kind=val('申込区分'),plan=val('申込プラン情報');
    must('申込区分',tab);must('申込プラン情報',tab);
    const newLine=/回線新規/.test(kind),change=/事業者変更|事変/.test(kind),transfer=/転用/.test(kind);
    if(filled(kind)&&filled(plan)){
      const aligned=(newLine&&/回線新規/.test(plan))||(change&&/事業者変更/.test(plan))||(transfer&&/転用/.test(plan));
      compare('申込区分とプラン整合',tab,plan,aligned,'申込区分と申込プラン情報の回線種別が一致しません。','申込プラン情報');
    }
    const approval=val('転用承諾番号／事業者変更承諾番号');
    if(newLine && filled(approval))compare('承諾番号（新規は空欄）',tab,approval,false,'回線新規では承諾番号を空欄にしてください。','転用承諾番号／事業者変更承諾番号');
    else if(change||transfer)when('転用承諾番号／事業者変更承諾番号',tab,true,'転用・事業者変更では承諾番号が必要です。');
    if(change)when('変更元事業者',tab,true,'事業者変更では変更元事業者が必要です。');
    const speed= /10\s*(?:g|ギガ)/i.test(plan)?10:/1\s*(?:g|ギガ)/i.test(plan)?1:null;
    return {kind,plan,newLine,change,transfer,speed,ac:val('AC備考'),entry:val('エントリ備考'),user:val('ユーザ備考')};
  }
  function contractorPersonal(x){
    const tab='顧客情報';
    const fields=['申込者（セイ）','申込者（メイ）','申込者（姓）','申込者（名）','契約者(セイ)','契約者(メイ)','契約者(姓)','契約者(名)'];
    fields.forEach(f=>must(f,tab));
    const kanaA=['申込者（セイ）','申込者（メイ）'].map(f=>val(f));
    const kanaB=['契約者(セイ)','契約者(メイ)'].map(f=>val(f));
    const nameA=['申込者（姓）','申込者（名）'].map(f=>val(f));
    const nameB=['契約者(姓)','契約者(名)'].map(f=>val(f));
    for(const [label,values] of [['申込者カナ',kanaA],['契約者カナ',kanaB],['申込者氏名',nameA],['契約者氏名',nameB]]){
      const joined=values.join('');
      if(values.every(filled))add('name_'+label,label,tab,[...joined].length<=20?ST.OK:ST.BAD,[...joined].length<=20?'合計20文字以内。':'姓名合計20文字を超えています。',label.includes('カナ')?'契約者(セイ)':'契約者(姓)');
    }
    for(const f of ['申込者（セイ）','申込者（メイ）','契約者(セイ)','契約者(メイ)']){
      const v=val(f);if(filled(v))add('kana_'+f,f+'：カナ形式',tab,kanaOK(v)?ST.OK:ST.BAD,kanaOK(v)?'全角カタカナ形式。':'全角カタカナ以外の文字を検出。',f);
    }
    if(kanaA.every(filled)&&kanaB.every(filled))compare('申込者／契約者カナ一致',tab,kanaA.join(''),norm(kanaA.join(''))===norm(kanaB.join('')),'申込者と契約者のカナが一致しません。','申込者（セイ）');
    if(nameA.every(filled)&&nameB.every(filled))compare('申込者／契約者氏名一致',tab,nameA.join(''),norm(nameA.join(''))===norm(nameB.join('')),'申込者と契約者の氏名が一致しません。','申込者（姓）');
    checkPhone('申込者連絡先',tab);
    const mobile=val('契約者連絡先'),fixed=val('契約者固定電話番号');
    if(!filled(mobile)&&!filled(fixed))add('tel_contact','契約者連絡先／固定電話',tab,ST.BAD,'連絡先が両方空欄です。','契約者連絡先');
    else{
      if(filled(mobile))checkPhone('契約者連絡先',tab,[11]);
      if(filled(fixed))checkPhone('契約者固定電話番号',tab,[10,11]);
    }
    must('契約者性別',tab);must('契約者生年月日',tab);
    const mailFlow=/メールフロー/.test(x.user)&&val('前後確一本化案件')!=='対象';
    checkEmail('申込者メールアドレス',tab,mailFlow);checkEmail('契約者メールアドレス',tab,mailFlow);
    if(x.newLine){
      for(const f of ['NTT契約者姓（カナ）','NTT契約者名（カナ）'])if(filled(val(f)))compare(f+'（新規は空欄）',tab,val(f),false,'回線新規では記載しません。',f);
    }else if(x.change||x.transfer){
      when('NTT契約者姓（カナ）',tab,true);when('NTT契約者名（カナ）',tab,true);
      if(x.change)hold('NTT契約ID（CAF番）',tab,'NTT西日本の事変案件では必須。東西の判定は目視確認。','NTTの契約ID（CAF番）');
    }
    const blue=val('BLUE使用有無');must('BLUE使用有無',tab);
    const age=ageAt(val('契約者生年月日'),val('獲得日'));
    const tv=val('申込・契約有無',{n:1});
    const phonePlan=val('申込プラン');
    const multi=val('追加番号');const forward=val('自動転送');
    const building=val('回線設置先建物（種別）');
    const exclusions=[age!==null&&age>=70, /エース/.test(phonePlan), isYes(tv),isYes(multi),isYes(forward),extChar.test([val('契約者(姓)'),val('契約者(名)'),val('建物名・部屋番号')].join('')), /集合住宅/.test(building)&&/ファミリー/.test(x.plan)];
    if(exclusions.some(Boolean)&&/使用する/.test(blue) && !/使用しない/.test(blue))compare('BLUE使用有無：除外条件',tab,blue,false,'BLUE使用しない条件に該当しています。','BLUE使用有無');
    else hold('BLUE使用有無：総合判定',tab,'電話・テレビ・建物・即決可否などを確認して「使用する／しない」を最終照合。','BLUE使用有無');
  }
  function addressPersonal(x){
    const tab='設置住所情報';
    must('郵便番号',tab,{n:0});
    ['都道府県・市区町村','番地','回線設置先建物（種別）'].forEach(f=>must(f,tab));
    const zip=val('郵便番号',{n:0});
    if(filled(zip))compare('郵便番号の書式',tab,zip,/^\d{7}$/.test(zip),'郵便番号はハイフンなし7桁です。','郵便番号',{n:0});
    checkLen('都道府県・市区町村',tab,17);checkLen('番地',tab,15);
    const building=val('回線設置先建物（種別）'),buildingName=val('建物名・部屋番号');
    if(/集合住宅/.test(building))when('建物名・部屋番号',tab,true,'集合住宅のため建物名・部屋番号を確認してください。');
    if(filled(buildingName)){
      if([...buildingName].length>25)compare('建物名・部屋番号：文字数',tab,buildingName,false,'上限25文字を超えています。','建物名・部屋番号');
      if(roman.test(buildingName))compare('建物名：ローマ数字',tab,buildingName,false,'ローマ数字（環境依存文字）は通常の数字に変換してください。','建物名・部屋番号');
    }
    if(x.newLine)must('回線設置先建物（新築／既存）',tab);
    if(x.newLine&&/集合住宅/.test(building))when('回線設置先建物（戸数）',tab,true,'回線新規・集合住宅では戸数が必須。');
    const ac=x.ac;
    if(/集合住宅/.test(building)&&/ファミリー/.test(x.plan)&&/MS/.test(ac) && !/MS.*FMタイプ希望|MS.*FMタイプ/.test(x.entry)){
      hold('集合住宅：FM希望理由',tab,'MS利用可能物件をFMで獲得した場合、エントリ備考に指定テンプレが必要。','エントリ備考');
    }
    hold('エリ確住所との一致',tab,'AC備考のエリ確結果・住所と、設置住所を目視で照合。','都道府県・市区町村');
  }
  function bigMemberAndSchedule(x,isCorp){
    let tab='BIGLOBE登録情報';
    must('BIGLOBE会員',tab);
    const member=val('BIGLOBE会員');
    if(!isCorp)must('施策コード',tab);
    if(/既存/.test(member)){
      if(!isCorp && !/BIGLOBE.?ID|会員ID/.test(x.entry))hold('BIGLOBE既存会員ID',tab,'既存会員の場合、エントリ備考に会員ID等のテンプレが必要です。','エントリ備考');
      if(isCorp)when('法人番号','法人情報',true,'既存会員では法人番号が必要です。');
    }
    for(const f of ['郵便番号(BIGLOBE登録)','都道府県(BIGLOBE登録)','市区町村(BIGLOBE登録)','字番地(BIGLOBE登録)'])must(f,tab);
    if(filled(val('郵便番号(BIGLOBE登録)')))compare('BIGLOBE登録郵便番号：書式',tab,val('郵便番号(BIGLOBE登録)'),/^\d{7}$/.test(val('郵便番号(BIGLOBE登録)')),'ハイフンなし7桁ではありません。','郵便番号(BIGLOBE登録)');
    if(!isCorp)checkLen('市区町村(BIGLOBE登録)',tab,17);
    const bld=val('建物名・部屋番号(BIGLOBE登録)');
    if(filled(bld) && [...bld].length>25)compare('BIG登録建物名：文字数',tab,bld,false,'上限25文字超過。','建物名・部屋番号(BIGLOBE登録)');
    if(filled(bld) && roman.test(bld))compare('BIG登録建物名：ローマ数字',tab,bld,false,'ローマ数字を通常の数字に変換。','建物名・部屋番号(BIGLOBE登録)');
    tab='工事希望日';
    const first=val('第1希望'),week=val('最短希望曜日①');
    if(empty(first)&&empty(week))add('install_date','工事希望日：第1希望／最短希望曜日①',tab,ST.BAD,'両方未選択です。どちらか必須。','第1希望');
    else add('install_date','工事希望日：第1希望／最短希望曜日①',tab,ST.OK,'いずれか入力済。','第1希望');
    if(!isCorp || x.newLine)must('工事費支払方法',tab);
    must('お客様と連絡の取りやすい曜日・時間帯',tab);
    if(isCorp){
      if(x.newLine)must('現地調査希望',tab);
      must('担当者名(カナ)',tab);
      if(empty(val('担当者携帯電話番号'))&&empty(val('担当者電話番号')))add('staff_contact','担当者連絡先',tab,ST.BAD,'携帯電話番号・電話番号が両方空欄です。','担当者携帯電話番号');
    }
    if(/引越入居予定日/.test(x.entry))hold('引越し予定日と工事希望日',tab,'引越予定日が先の場合、指定日以降①との整合を目視確認。','指定日以降①');
    const construction=norm(val('工事費支払方法'));
    const mention=x.ac.match(/工事費支払方法[^\n]*?(分割|一括)/);
    if(mention && construction){
      const same=mention[1]==='分割'?/割賦|分割/.test(construction):/一括/.test(construction);
      compare('工事費支払方法とAC備考',tab,construction,same,'AC備考の工事費支払方法と一致しません。','工事費支払方法');
    }
    const management=val('管理会社情報');
    const bldKind=val('回線設置先建物（種別）');
    if(/賃貸/.test(bldKind)&&/ファミリー/.test(x.plan)){
      when('管理会社情報','管理会社情報',true,'賃貸のファミリー契約はオーナー情報が必要です。');
      if(filled(management)&&(!/管理会社|オーナー/.test(management)||!/担当者/.test(management)||!/連絡先|電話/.test(management)||!/ビス|穴あけ/.test(management))){
        hold('管理会社情報：記載4要素','管理会社情報','管理会社名・担当者・連絡先・ビス／穴あけ可否と理由を確認。','管理会社情報');
      }
    }
  }
  function corporateDetails(x){
    let tab='法人情報';
    checkLen('法人名（全角カナ）',tab,20);checkLen('法人名',tab,25);
    const legal=val('法人名');
    if(filled(legal)&&/[㈱㈲]/.test(legal))compare('法人名：法人格略号',tab,legal,false,'㈱・㈲の省略記号は使用不可です。','法人名');
    must('法人格前後',tab);must('回線速度',tab);
    if(x.newLine){
      for(const f of ['NTT法人名（カナ）','NTT契約者氏名','NTT契約者名（カナ）']){
        if(filled(val(f)))compare(f+'（新規は空欄）',tab,val(f),false,'回線新規では空欄にしてください。',f);
      }
    }else if(x.transfer||x.change){
      for(const f of ['NTT法人名（カナ）','NTT契約者氏名','NTT契約者名（カナ）'])when(f,tab,true);
      if(x.speed===10)when('回線品目変更希望(1ギガ→10ギガ)',tab,true,'10ギガへの品目変更は選択が必要（現状10Gは別途確認）。');
      if(x.speed===1 && filled(val('回線品目変更希望(1ギガ→10ギガ)')))compare('回線品目変更希望',tab,val('回線品目変更希望(1ギガ→10ギガ)'),false,'1ギガ希望時は品目変更希望を空欄にしてください。','回線品目変更希望(1ギガ→10ギガ)');
    }
    tab='契約者情報';
    for(const f of ['契約者(セイ)','契約者(メイ)','契約者(姓)','契約者(名)','性別','契約者生年月日'])must(f,tab);
    for(const f of ['契約者(セイ)','契約者(メイ)']){
      const v=val(f);if(filled(v))add('corporate_kana_'+f,f+'：カナ形式',tab,kanaOK(v)?ST.OK:ST.BAD,kanaOK(v)?'カタカナ形式。':'全角カタカナ形式を確認。',f);
    }
    if(filled(val('契約者(姓)')+val('契約者(名)'))&&extChar.test(val('契約者(姓)')+val('契約者(名)')))compare('契約者氏名：外字',tab,val('契約者(姓)'),false,'外字・環境依存文字を検出しました。','契約者(姓)');
    const mob=val('携帯電話番号'),fix=val('固定電話番号');
    if(empty(mob)&&empty(fix))add('corp_contact','契約者携帯／固定電話番号',tab,ST.BAD,'両方未記入です。','携帯電話番号');
    else{
      if(filled(mob))checkPhone('携帯電話番号',tab,[11]);
      if(filled(fix))checkPhone('固定電話番号',tab,[10,11]);
    }
    const blue=val('BLUE使用有無');
    if(!filled(blue))must('BLUE使用有無',tab);
    else compare('法人BLUE使用有無',tab,blue,/使用しない|選択しない/.test(blue),'法人は「使用しない」が必要です。','BLUE使用有無');
    // 法人の住所欄は同名項目が多数存在するため、住所タブを絞れない場合は保留。
    const addressTasks=[['市区町村',21],['所番地',24],['ビル・マンション名',24]];
    for(const [f,max] of addressTasks){
      const obj=pick(f);if(!obj)hold(f,tab,'重複した住所項目のタブ判定が必要です。',f);
      else if(filled(obj.value))add('corp_address_'+f,f,tab,[...obj.value].length<=max?ST.OK:ST.BAD,[...obj.value].length<=max?`${max}文字以内。`:`上限${max}文字超過。`,f);
      else if(f!=='ビル・マンション名')must(f,tab);
    }
    when('請求書送付先','請求書送付先',!/既存/.test(val('BIGLOBE会員')),'新規会員では請求書送付先が必要です。');
    const bill=val('請求書送付先');
    if(/その他/.test(bill)){
      ['法人名・個人事業主名','送付先姓','送付先名','電話番号'].forEach(f=>when(f,'請求書送付先',true));
      hold('請求書送付先：住所','請求書送付先','郵便番号・都道府県・市区町村・番地が必須です。重複ラベルを確認。','請求書送付先');
    }
    const ntab='NTT設置住所情報';
    for(const f of ['番地１','入館申請','回線設置先建物（種別）'])must(f,ntab);
    if(x.newLine)must('回線設置先建物（新築／既存）',ntab);
    if(x.newLine)when('回線設置先建物（戸数）',ntab,true);
    hold('NTT設置住所：エリ確照合',ntab,'郵便番号・都道府県・市区町村・番地をAC備考のエリ確住所と照合。','入館申請');
  }
  function phoneAndTv(x,isCorp){
    const phoneTab='BIGLOBE光電話情報',tvTab='BIGLOBE光テレビ情報';
    const ph=pick('申込・契約有無',{n:0});
    const tv=pick('申込・契約有無',{n:1});
    if(ph)add('phone_contract','光電話：申込・契約有無',phoneTab,filled(ph.value)?ST.OK:ST.BAD,filled(ph.value)?'選択あり。':'選択されていません。','申込・契約有無',{n:0});
    else hold('光電話：申込・契約有無',phoneTab,'タブから光電話の契約欄を特定できません。','申込・契約有無',{n:0});
    if(!isCorp){
      if(tv)add('tv_contract','光テレビ：申込・契約有無',tvTab,filled(tv.value)?ST.OK:ST.BAD,filled(tv.value)?'選択あり。':'選択されていません。','申込・契約有無',{n:1});
      else hold('光テレビ：申込・契約有無',tvTab,'タブから光テレビの契約欄を特定できません。','申込・契約有無',{n:1});
    }
    const matchPhone=x.ac.match(/【BIGLOBE光電話情報】\s*([^\r\n]+)/);
    const pref=matchPhone?.[1]||'';
    const wantingPort=/番ポ/.test(pref),wantingNew=/新番/.test(pref),wantingNone=/^無|お客様にてBIG依頼/.test(pref);
    if(!pref)hold('電話：AC備考との整合',phoneTab,'AC備考内の【BIGLOBE光電話情報】が見つかりません。','AC備考');
    else if(ph){
      if(x.newLine){
        const needs=/新規申込/.test(ph.value);
        const expected=wantingNone?!needs:(wantingPort||wantingNew)?needs:null;
        if(expected!==null)compare('電話：AC備考との整合',phoneTab,ph.value,expected,'AC備考の電話有無と申込・契約有無が一致しません。','申込・契約有無',{n:0});
      }else hold('電話：AC備考との整合',phoneTab,'転用・事変の電話契約継続／新規申込の取扱いを確認。','申込・契約有無',{n:0});
    }
    const phoneWanted=wantingPort||wantingNew || (ph&&/新規申込/.test(ph.value));
    const phonePlan=val('申込プラン');
    if(phoneWanted){
      must('申込プラン',phoneTab);
      if(x.newLine){
        const fn=val('発信者番号通知');
        if(filled(fn))compare('発信者番号通知',phoneTab,fn,/通知する/.test(fn),'回線新規は「通知する」が必要です。','発信者番号通知');
        else when('発信者番号通知',phoneTab,true);
        if(!isCorp){
          const hgw=val('HGW設定シート情報');
          if(filled(hgw))compare('HGW設定シート情報',phoneTab,hgw,/番号別に着信希望|Aパターン/.test(hgw),'回線新規では番号別に着信希望(Aパターン)。','HGW設定シート情報');
          else when('HGW設定シート情報',phoneTab,true);
        }
        const limit=val('国際電話を制限');
        if(filled(limit))compare('国際電話制限',phoneTab,limit,/制限しない/.test(limit),'回線新規では「制限しない」が必要です。','国際電話を制限');
        else when('国際電話を制限',phoneTab,true);
        must('ハローページ掲載希望',phoneTab);
      }
      if(/エース/.test(phonePlan)){
        for(const f of ['発信者番号表示','ナンバー・リクエスト','迷惑電話ブロック','通話中着信通知','自動転送','着信お知らせメール']){
          const v=val(f);
          if(filled(v))compare('エース付帯：'+f,phoneTab,v,isYes(v),'エースの標準オプションが「有」になっていません。',f);
          else hold('エース付帯：'+f,phoneTab,'オプション欄の読取・選択肢を確認。',f);
        }
      }
      const request=val('ナンバー・リクエスト'),number=val('発信者番号表示');
      if(isYes(request)&&!isYes(number))compare('ナンバー・リクエスト',phoneTab,request,false,'発信者番号表示の申込も必要です。','ナンバー・リクエスト');
      if(isYes(val('自動転送'))&&isYes(val('FAXお知らせメール')))compare('自動転送×FAX',phoneTab,'両方申込',false,'自動転送とFAXお知らせメールの同時契約は不可。','自動転送');
      if(x.newLine&&isYes(val('電話帳配達希望')))compare('電話帳配達希望',phoneTab,val('電話帳配達希望'),false,'回線新規は「無」または空欄です。','電話帳配達希望');
      const hello=val('ハローページ掲載希望');
      if(/掲載希望|掲載する|有/.test(hello) && !/不要/.test(hello)){
        if(isCorp)for(const f of ['掲載名','掲載住所'])when(f,phoneTab,true);
        else for(const f of ['掲載名(氏名・個人名のみ)'])when(f,phoneTab,true);
        hold('ハローページ住所',phoneTab,'掲載希望の場合、掲載名・郵便番号・掲載住所を確認。','ハローページ掲載希望');
      }
      if(wantingPort){
        for(const f of ['番号取得方法','番ポ希望する電話番号','電話名義人(姓)','電話名義人(名)','電話名義人(セイ)','電話名義人(メイ)'])when(f,phoneTab,true);
        if(isCorp){for(const f of ['電話名義人(法人名)','電話名義人(法人名カナ)','ご利用中の固定電話の設置場所住所','ご利用中の固定電話の契約者住所'])when(f,phoneTab,true);}
        const method=val('番号取得方法');
        if(/NTT固定電話から/.test(method)){
          const rights=val('加入権取扱い');
          if(filled(rights))compare('NTT番ポ：加入権',phoneTab,rights,/休止/.test(rights),'NTT番ポの加入権取扱いは「休止」です。','加入権取扱い');
          else when('加入権取扱い',phoneTab,true);
        }else if(/他事業者から/.test(method)){
          when('番ポ元の提供事業者(会社名)',phoneTab,true);
          when('番ポ元のサービス名称',phoneTab,true);
        }else hold('番号取得方法',phoneTab,'NTT／他事業者からの番ポの判定を確認。','番号取得方法');
      }
      if(x.speed===10 && isCorp && (x.newLine || x.transfer || x.change)){
        hold('10G光電話：無線LAN機能',phoneTab,'現在の回線速度・1G→10G増速の有無と「無線LAN機能」を確認。','無線LAN機能');
      }
    }
    if(!isCorp){
      const tvPref=x.ac.match(/【BIGLOBE光テレビ情報】\s*([^\r\n]+)/)?.[1]||'';
      const wantTv=/^有|申し込|申込/.test(tvPref);
      if(wantTv && tv){
        if(x.newLine)compare('光テレビ：AC備考との整合',tvTab,tv.value,/新規申込/.test(tv.value),'テレビ有の回線新規では「新規申込」が必要。','申込・契約有無',{n:1});
        for(const f of ['同軸配線工事の要/不要','光テレビ申込タイプ','別棟の有無'])if(x.newLine)when(f,tvTab,true);
        if(x.newLine)for(const f of ['TV台数','部屋数','築年数']){
          const r=pick(f); if(!r)hold(f,tvTab,'該当欄が見つかりません。',f);
          else add('tvnumber_'+f,f,tvTab,/\d/.test(r.value)?ST.OK:ST.BAD,/\d/.test(r.value)?'数字の記載あり。':'数字が未入力です。',f);
        }
        const tvType=val('光テレビ申込タイプ'),box=val('マルチメディアボックス');
        if(/単独/.test(tvType)&&filled(box))compare('光テレビ：マルチメディアボックス',tvTab,box,isNo(box),'単独の場合は「無」が必要。','マルチメディアボックス');
        if(/共聴/.test(tvType)&&filled(box))compare('光テレビ：マルチメディアボックス',tvTab,box,isYes(box),'共聴の場合は「有」が必要。','マルチメディアボックス');
      }else if(tvPref && tv && x.newLine && /無|他サービス/.test(tvPref)){
        compare('光テレビ：AC備考との整合',tvTab,tv.value,/申込みなし|申込なし/.test(tv.value),'テレビ無しの回線新規では「申込みなし」が必要。','申込・契約有無',{n:1});
      }else if(!tvPref)hold('光テレビ：AC備考との整合',tvTab,'AC備考の光テレビテンプレを確認。','AC備考');
    }
  }
  function personalServices(x){
    const tab='BIGLOBE光サービス情報';
    const svc=['セキュリティセット・プレミアム','暮らしのあんしん相談サービス','ライフサポートパック for BIGLOBE','U-NEXT for BIGLOBE','トータルネットセキュリティ','ネットあんしんパック','インターネット機器保証','あんしんバックアップ','エンジョイプラス','BIGLOBE　お助けサポート+','生活かけつけレスキュー'];
    const found=svc.map(f=>({f,v:val(f)})).filter(o=>pick(o.f));
    if(!found.length)hold('BIGLOBEオプション件数',tab,'サービス情報タブの項目を取得できません。',svc[0]);
    else{
      const count=found.filter(o=>isYes(o.v)).length;
      const op=x.ac.match(/BIGISP[^\n]*?(\d+)個/);
      if(op){
        const expected=Number(op[1]);
        if(count!==expected)hold('BIGLOBEオプション件数',tab,`AC備考${expected}個に対して画面で${count}個を検出。対象サービスの選択仕様を確認。`,svc[0]);
        else add('option_count','BIGLOBEオプション件数',tab,ST.OK,'AC備考の件数と画面上の「有」件数が一致。',svc[0]);
      }else hold('BIGLOBEオプション件数',tab,'AC備考の「★BIGISP：OP★○個」がないか確認。',svc[0]);
      if((isYes(val('セキュリティセット・プレミアム'))||isYes(val('ネットあんしんパック')))&&isYes(val('トータルネットセキュリティ'))){
        compare('セキュリティOP重複',tab,'重複',false,'トータルネットセキュリティとの重複不可オプションあり。','トータルネットセキュリティ');
      }
    }
    const nt='N+サービスオプション';
    const healthcare=['ヘルスケアサポートN+SOKUYAKU','ヘルスケアサポートN+FYSTA','ヘルスケアサポートN+ファストドクター'];
    const hc=healthcare.map(f=>val(f)).filter(isYes).length;
    const hcComment=(x.user.match(/ヘルスケア同時訴求[^\n]*/)||[])[0]||'';
    if(!hcComment)hold('ヘルスケア同時訴求',nt,'ユーザ備考のヘルスケアの結果テンプレが見つかりません。','ユーザ備考');
    else if(/成功/.test(hcComment)){
      add('health_set','ヘルスケアオプション',nt,hc===2?ST.OK:ST.BAD,hc===2?'セット付帯2種類を検出。':'成功時は指定の2種類セット付帯を確認。',healthcare[0]);
    }else if(hc>0)add('health_set','ヘルスケアオプション',nt,ST.HOLD,'成功以外のテンプレですが付帯が検出されました。確認してください。',healthcare[0]);
    const co=val('ココシェルジュN+'); const coComment=(x.user.match(/ココシェルジュ同時訴求[^\n]*/)||[])[0]||'';
    if(coComment){
      const success=/成功/.test(coComment);
      if(pick('ココシェルジュN+'))add('coco','ココシェルジュN+',nt,success===isYes(co)?ST.OK:ST.BAD,success===isYes(co)?'テンプレと付帯有無が一致。':'ユーザ備考テンプレと付帯有無が不一致。','ココシェルジュN+');
      else hold('ココシェルジュN+',nt,'画面項目が見つかりません。','ココシェルジュN+');
    }else hold('ココシェルジュN+',nt,'ユーザ備考に同時訴求の結果テンプレが見つかりません。','ユーザ備考');
  }
  function routersAndCashback(x,isCorp){
    if(!isCorp){
      const tab='Wi-Fiルータ情報', r1Raw=val('BIG提供(レンタル) 無線LANルータ(1ギガ以下)'),r10=val('NTT提供(レンタル) 無線LANルータ(10ギガ)');
      // Wagbyの数量欄は未入力でも単位「台」だけを表示する。単位のみは空欄として扱う。
      // 0台・1台など数字のある値はそのまま判定対象に残す。
      const r1=/^台$/.test(norm(r1Raw)) ? '' : r1Raw;
      if(x.speed===1 && !filled(r1))when('BIG提供(レンタル) 無線LANルータ(1ギガ以下)',tab,true,'1ギガでは無の場合も「0」選択が必要です。');
      if(x.speed===1 && filled(r10))compare('10Gレンタル（1Gでは空欄）',tab,r10,false,'1ギガで10ギガ用レンタルの選択があります。','NTT提供(レンタル) 無線LANルータ(10ギガ)');
      if(x.speed===10 && filled(r1))compare('1Gレンタル（10Gでは空欄）',tab,r1,false,'10ギガでは1ギガ用レンタル欄は空欄です。','BIG提供(レンタル) 無線LANルータ(1ギガ以下)');
      const purchase=val('BIG提供(購入) 無線LANルータ'),model=val('BIG提供(購入) 無線LANルータ機種名');
      if(filled(purchase) && !isNo(purchase))when('BIG提供(購入) 無線LANルータ機種名',tab,true,'購入ルーターの機種名が必要です。');
      if(/BUFFALO/.test(purchase)&&filled(model))compare('購入ルーター機種名',tab,model,/WXR9300BE6P/i.test(model),'BUFFALOの機種名はWXR9300BE6Pです。','BIG提供(購入) 無線LANルータ機種名');
      if(/TP-Link.*1ギガ10ギガ|TP-Link.*10ギガ/.test(purchase)&&filled(model))compare('購入ルーター機種名',tab,model,/BE85/.test(model),'10G対応TP-LinkはDeco BE85です。','BIG提供(購入) 無線LANルータ機種名');
      if(x.speed===10 && /お客様ルーター手配|ルーター自己手配|ルーター手配/.test(x.ac) && !/お客様ルーター手配/.test(x.entry)){
        compare('10Gルーターお客様手配',tab,x.entry,false,'10Gでお客様手配の場合、エントリ備考に「お客様ルーター手配」が必須です。','エントリ備考');
      }
      if(x.speed===10 && empty(r10))hold('10Gルーター申込内容',tab,'電話有無・お客様手配・NTTレンタル有無・購入ルーターを照合。','NTT提供(レンタル) 無線LANルータ(10ギガ)');
      if(/購入|TP-Link|BUFFALO/.test(purchase))when('BIG提供 無線LANルータ 機器送付先',tab,true);
      hold('ルーターとAC備考',tab,'★無線LAN★欄とDBの申込種類・機種・台数を照合。','BIG提供(購入) 無線LANルータ');
    }else{
      const tab='BIGLOBE光サービス情報';
      for(const f of ['マカフィー® マルチ アクセス','固定IP','クラウドストレージ']){
        if(isYes(val(f)))compare(f,tab,val(f),false,'法人では獲得対象外のため「有」は要確認。',f);
      }
      if(x.speed===10)hold('法人10Gルーター希望',tab,'光電話有無・品目変更状況と「10ギガ対応無線LANルータ希望」を照合。','10ギガ対応無線LANルータ希望');
    }
    const tab='キャッシュバック情報',ac=x.ac;
    const cbMention=ac.match(/(?:【CB金額】[^\n]*?自社\s*[:：]?\s*|【CB金額】\s*)([\d,]+)\s*円/);
    const cbNum=cbMention?Number(cbMention[1].replace(/,/g,'')):null;
    const amount=val('CB金額(円)'),cbReason=val('CB理由');
    if(cbNum!==null && cbNum>0){
      when('CB金額(円)',tab,true,'CB付帯時は金額が必要です。');when('CB理由',tab,true,'CB付帯時はCB理由が必要です。');
      if(filled(amount))compare('CB金額とAC備考',tab,amount,currencyNum(amount)===cbNum,'AC備考のCB金額とDB金額が一致しません。','CB金額(円)');
      if(!/特別/.test(cbReason))checkEmail('CBメール用メールアドレス',tab,true);
    }else hold('キャッシュバック照合',tab,'CB付帯有無・金額・理由・メール送信履歴を目視確認。','CB金額(円)');
    if(/CB12ヶ月|特別/.test(cbReason)&& !/【LINE未利用案件】/.test(ac))hold('LINE未利用案件',tab,'CB理由が「CB12ヶ月／特別」の場合はAC備考に【LINE未利用案件】テンプレがあるか確認。','AC備考');
  }
  function tosCheck(x){
    const tab='トス関連', tos=val('トス成功'), progress=val('折衝進捗');
    // テンプレの「成功/失敗/対象外」は成功扱いしない。
    const m=x.ac.match(/水トス[★：: ]+([^\r\n★]+)/);
    const acWater=m && /成功/.test(m[1]) && !/[／/]/.test(m[1]);
    const waterSelected=/(?:水トス|水(?:トス)?成功)/.test(tos) || /(?:^|[\s、,])水(?:$|[\s、,])/.test(tos) || acWater;
    if(waterSelected){
      const progressOK=/水SF折衝済み/.test(progress);
      // 操作履歴は同一ページの下段一覧。該当フレーズだけを検索（内容自体は保持・転送しない）。
      const moved=[...document.querySelectorAll('table')].some(t=>!root.contains(t)&&/リスト事業に移行/.test(t.innerText||''));
      if(progressOK||moved)add('tos_water','水トス／折衝進捗',tab,ST.OK,'「水SF折衝済み」または操作履歴の移行記載を検出。','折衝進捗');
      else if(pick('折衝進捗'))add('tos_water','水トス／折衝進捗',tab,ST.BAD,'水トス選択時は「水SF折衝済み」または操作履歴「リスト事業に移行」が必要です。','折衝進捗');
      else hold('水トス／折衝進捗',tab,'折衝進捗の項目が見つかりません。','折衝進捗');
    }
  }
  function manualChecklist(isCorp){
    const common=[
      ['申込プラン：FM/MS・速度','顧客情報','建物種別・操作履歴の料金内訳・エリ確結果と照合。','申込プラン情報'],
      ['AC備考：申込内容総合','基本情報','営業テンプレ・工事費・OP・電話・ルーター・CBを手動で読み合わせ。','AC備考'],
      ['操作履歴：料金内訳','操作履歴','最大月額・OP料金合計と商品申込情報が整合するか確認。','AC備考'],
      ['顧客希望・ヒアリング内容','基本情報','録音・通話内容からしか判定できない内容は最終目視。','ユーザ備考']
    ];
    const custom=isCorp?[
      ['法人格前後の整合','法人情報','法人名と法人格の位置・略号禁止を目視。','法人格前後'],
      ['契約者／請求先住所','請求書送付先','請求先がその他の場合、各必須欄と住所を照合。','請求書送付先'],
      ['電話2番号・番ポ可否','BIGLOBE光電話情報','電話2番号目・番号ポータビリティの契約状態を確認。','追加番号'],
      ['法人のBIGLOBE登録住所','BIGLOBE登録情報','転用・事変／法人独自の入力仕様を確認。','郵便番号(BIGLOBE登録)']
    ]:[
      ['設置住所とBIG登録住所','BIGLOBE登録情報','同一／送付先違いの申込希望と各欄の整合性を確認。','郵便番号(BIGLOBE登録)'],
      ['光電話：オプション細部','BIGLOBE光電話情報','電話契約ありの場合、既存継承・FAX・追加番号・HGW等を確認。','申込プラン'],
      ['光テレビ：共聴判断','BIGLOBE光テレビ情報','単独／共聴は設置状況や工事内容を確認。','光テレビ申込タイプ'],
      ['10Gルーター48パターン','Wi-Fiルータ情報','マニュアル「10Gルーターチェック表」と申込種類・電話・ルータ機種を確認。','NTT提供(レンタル) 無線LANルータ(10ギガ)']
    ];
    for(const [label,tab,reason,ref] of [...common,...custom])hold(label,tab,reason,ref);
  }
  function doAudit(){
    items=[];records=snap();mode=detectMode();
    $('#ft-kind-label').textContent=mode==='personal'?'個人':'法人';
    flowCheck(mode==='corporate');
    const x=commonLineCheck(mode==='corporate');
    if(mode==='personal'){
      contractorPersonal(x);addressPersonal(x);
    }else corporateDetails(x);
    bigMemberAndSchedule(x,mode==='corporate');
    phoneAndTv(x,mode==='corporate');
    if(mode==='personal')personalServices(x);
    routersAndCashback(x,mode==='corporate');
    tosCheck(x);
    manualChecklist(mode==='corporate');
    latestAt=new Date().toLocaleString('ja-JP');
    $('#ft-coverage').textContent=`取得ラベル ${records.length}件`;
    render();
  }

  function tabs(){
    const selectors=['[role="tab"]','.ui-tabs-nav a[href^="#"]','a[data-toggle="tab"]','a[data-bs-toggle="tab"]','.tabmenu a[href^="#"]','.nav-tabs a[href^="#"]'];
    return [...new Set([...document.querySelectorAll(selectors.join(','))])]
      .filter(e=>!root.contains(e))
      .filter(e=>{
        const href=e.getAttribute('href')||'';
        return e.getAttribute('role')==='tab'||(href.startsWith('#')&&href.length>1);
      });
  }
  function clickTab(t){
    const href=t.getAttribute('href')||'';
    if(href && href.startsWith('#')){
      // tab navigation only; page transition links and action buttons are never clicked.
      t.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}));
    }else if(t.getAttribute('role')==='tab')t.click();
  }
  async function sweep(){
    if(busy)return;busy=true;
    $('#ft-scan').disabled=true;say('画面内のタブを順番に開いてラベルを読み込みます。');
    const btns=tabs();
    if(!btns.length){doAudit();say('タブ操作部品が自動認識できません。表示済み項目で判定しました。');busy=false;$('#ft-scan').disabled=false;return;}
    const selected=btns.filter(t=>t.getAttribute('aria-selected')==='true'||t.closest('li')?.classList.contains('ui-tabs-active'));
    const store=new Map();
    const absorb=()=>snap().forEach(r=>{const key=r.label+'|'+r.paneId+'|'+records.filter(v=>v.label===r.label&&v.paneId===r.paneId).length;store.set(key,r)});
    records=snap(); absorb();
    for(const t of btns){
      if(!t.isConnected)continue;
      clickTab(t);await sleep(90);absorb();
    }
    selected.forEach(clickTab);
    // 再読込後、初めからDOMに存在する全項目で判定。遅延生成の項目も読み込まれていれば対象。
    doAudit();
    busy=false;$('#ft-scan').disabled=false;
    say(`タブ ${btns.length}件を巡回しました。内容確認や人手判定が必要な項目は「判定保留」です。`);
  }
  function showPane(rec){
    const panel=rec?.pane;
    if(!panel?.id)return;
    const id=panel.id;
    const nav=[...tabs()].find(t=>t.getAttribute('aria-controls')===id||t.getAttribute('href')==='#'+id);
    if(nav)clickTab(nav);
  }
  async function navigate(item){
    // 詳細タブが折りたたまれていても、対象タブ名のナビゲーションがあれば開く。
    const targetTab=[...tabs()].find(t=>norm(t.textContent).includes(norm(item.tab)));
    if(targetTab){clickTab(targetTab);await sleep(60);}
    let obj=pick(item.ref,item.opt||{});
    if(!obj){say('この項目は画面に見つかりません。該当タブを開いてから再実行してください。');return;}
    showPane(obj);
    await sleep(80);
    const refreshed=snap().filter(r=>keepKey(r.label)===keepKey(item.ref));
    if(item.opt?.n!==undefined&&refreshed[item.opt.n])obj=refreshed[item.opt.n];
    else if(refreshed.length===1)obj=refreshed[0];
    let target=obj.element.closest('tr')||obj.element;
    if(!target.getClientRects().length){
      // 隠れたタブから行へ移動する際、複数の内側タブも段階的に展開。
      let pane=obj.element.closest('.ui-tabs-panel,[role="tabpanel"],.tab-pane');
      while(pane){
        const id=pane.id;
        const tab=[...tabs()].find(t=>t.getAttribute('aria-controls')===id||t.getAttribute('href')==='#'+id);
        if(tab)clickTab(tab);
        pane=pane.parentElement?.closest('.ui-tabs-panel,[role="tabpanel"],.tab-pane');
      }
      await sleep(120);
    }
    target.scrollIntoView({behavior:'smooth',block:'center'});
    target.classList.add('ft-audit-focus');
    setTimeout(()=>target.classList.remove('ft-audit-focus'),2300);
    say(`移動先：${item.tab} ＞ ${item.ref} （実際のタブが閉じている場合は開いて確認）`);
  }
  function render(){
    const count=s=>items.filter(x=>x.status===s).length;
    $('#ft-summary').textContent=`要修正候補 ${count(ST.BAD)}件 ｜ 判定保留 ${count(ST.HOLD)}件 ｜ 適合候補 ${count(ST.OK)}件 ｜ 対象外 ${count(ST.SKIP)}件`;
    root.querySelectorAll('[data-filter]').forEach(b=>b.classList.toggle('active',b.dataset.filter===filter));
    const visible=items.map((x,i)=>({...x,index:i})).filter(x=>filter==='ALL'||(filter==='BAD'?x.status===ST.BAD:x.status===ST.HOLD));
    const wrap=$('#ft-results');wrap.replaceChildren();
    if(!visible.length){wrap.innerHTML='<div class="ft-muted" style="padding:12px">該当項目はありません。</div>';return;}
    const classes={[ST.BAD]:'ft-bad',[ST.OK]:'ft-ok',[ST.HOLD]:'ft-hold',[ST.SKIP]:'ft-skip'};
    for(const entry of visible){
      const row=document.createElement('div');row.className='ft-row';
      row.innerHTML=`<div class="ft-line"><b>${esc(entry.label)}</b><span class="ft-badge ${classes[entry.status]}">${esc(entry.status)}</span></div><div class="ft-loc">${esc(entry.tab)} ／ クリックで項目へ移動</div><div class="ft-desc">${esc(entry.reason)}</div>`;
      row.addEventListener('click',()=>navigate(entry));wrap.appendChild(row);
    }
  }
  function copyReport(){
    if(!items.length){say('先に不備チェックを実行してください。');return;}
    const txt=[TITLE+' v'+VERSION,`対象：${mode==='personal'?'個人':'法人'}`,`確認日時：${latestAt}`,`参照：${source}`,'',...items.filter(x=>x.status===ST.BAD||x.status===ST.HOLD).map(x=>`[${x.status}] ${x.tab}／${x.label}：${x.reason}`)].join('\n');
    // 申込者名・電話番号・住所・顧客入力値はコピーしない。
    const popup=document.createElement('div');popup.style.cssText='position:fixed;inset:0;z-index:2147483647;background:#0008;display:flex;align-items:center;justify-content:center;padding:12px';
    const content=document.createElement('div');content.style.cssText='background:white;color:#263449;border-radius:10px;width:min(780px,95vw);padding:16px;box-shadow:0 10px 30px #0004';
    content.innerHTML='<h3 style="margin:0 0 8px">結果一覧（個人情報・入力値なし）</h3><p style="font-size:12px">コピーにはチェック項目名・判定・理由のみ含みます。</p>';
    const area=document.createElement('textarea');area.value=txt;area.style.cssText='width:100%;height:55vh;box-sizing:border-box;padding:10px;font-size:12px';content.append(area);
    const controls=document.createElement('div');controls.style.cssText='display:flex;gap:8px;margin-top:10px;justify-content:flex-end';
    const copy=document.createElement('button');copy.textContent='結果をコピー';copy.onclick=()=>{area.select();if(navigator.clipboard?.writeText)navigator.clipboard.writeText(txt).then(()=>{copy.textContent='コピーしました'}).catch(()=>{document.execCommand('copy')});else document.execCommand('copy');};
    const close=document.createElement('button');close.textContent='閉じる';close.onclick=()=>popup.remove();
    controls.append(copy,close);content.append(controls);popup.append(content);document.body.append(popup);
    popup.addEventListener('click',e=>{if(e.target===popup)popup.remove()});
  }
  $('#ft-run').onclick=()=>{try{doAudit();say('判定しました。誤判定を避けるため未確認項目は判定保留にしています。')}catch(e){console.error('[FT Kahlua Audit] error:',e?.message);say('判定中にエラー。画面レイアウト・項目名を確認してください。')}};
  $('#ft-scan').onclick=()=>sweep().catch(e=>{console.error('[FT Kahlua Audit] error:',e?.message);busy=false;$('#ft-scan').disabled=false;say('タブ巡回中にエラーが発生しました。')});
  $('#ft-copy').onclick=copyReport;
  $('#ft-clear').onclick=()=>{items=[];$('#ft-summary').textContent='未実行';$('#ft-results').innerHTML='<div class="ft-muted" style="padding:12px">結果を消去しました。</div>';say('')};
  root.querySelectorAll('[data-filter]').forEach(el=>el.onclick=()=>{filter=el.dataset.filter;render()});
  $('#ft-collapse').onclick=()=>{collapsed=!collapsed;$('.ft-inner').style.display=collapsed?'none':'';$('#ft-collapse').textContent=collapsed?'+':'−'};
  // 縮小表示時も移動できるようドラッグ位置をvw/vh内に制限。
  const drag=$('#ft-drag');let start=null;
  drag.addEventListener('pointerdown',e=>{
    if(e.target.id==='ft-collapse')return;
    const rect=root.getBoundingClientRect();start={x:e.clientX,y:e.clientY,left:rect.left,top:rect.top};
    drag.setPointerCapture(e.pointerId);e.preventDefault();
  });
  drag.addEventListener('pointermove',e=>{
    if(!start)return;
    const left=Math.max(0,Math.min(window.innerWidth-root.offsetWidth,start.left+e.clientX-start.x));
    const top=Math.max(0,Math.min(window.innerHeight-40,start.top+e.clientY-start.y));
    Object.assign(root.style,{left:left+'px',top:top+'px',right:'auto'});
  });
  for(const ev of ['pointerup','pointercancel'])drag.addEventListener(ev,()=>start=null);
  mode=detectMode();$('#ft-kind-label').textContent=mode==='personal'?'個人':'法人';
  say('参照マニュアル：2026/10/29版。実装対象の最終確認は目視でお願いします。');
})();