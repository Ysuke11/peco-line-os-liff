/* PECO LINE OS — 飼い主向け LIFF（段階 2 検証用）2026-10-20
   モック v4.5 の画面と遷移をそのまま Web アプリにしたもの。判定ロジックは tag_engine v0.3 と同じ。
   データは data/pets.json（架空）。段階 4 でカルテ／アプリの API に置き換える。
   ルーティング: LIFF URL の末尾パス（/now /all /cal /resv /rec /consults /link /nodata）か ?p=。
   個人情報は扱わない。LINE のプロフィールは取得しない（liff.init のみ。ログインは強制しない）。 */
(function () {
  'use strict';
  const LIFF_ID = '2012109884-ZXtQfryQ'; // 検証用（PECO 開発テスト）
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const CLINIC = { name: '原宿センター病院', tel: 'tel:050-3649-5078', hours: '9:00〜12:00 / 14:00〜18:00　年中無休', booking: 'https://app.peco-clinic.com/reserve/calendar?clinic=019f8ccd-255c-77bf-a8d4-794432e497f5&utm_source=line&utm_medium=liff' };
  const SEG = { 'dog:puppy': ['D01', '子犬', 'はじめての予防', 'ワクチン・狂犬病・寄生虫'], 'dog:young_adult': ['D02', '若齢成犬', '予防習慣をつくる', '狂犬病・寄生虫予防'], 'dog:mature_adult': ['D03', '成熟成犬', '健診と予防を続ける', '慢性疾患の早期発見'], 'dog:senior': ['D04', 'シニア犬', '半年ごとの健康チェック', '春・秋の健診'], 'cat:puppy': ['C01', '子猫', 'はじめての予防', 'FVRCP・寄生虫・避妊去勢'], 'cat:young_adult': ['C02', '若齢成猫', '年1回の健康チェック', '健診・生活リスクを確認'], 'cat:mature_adult': ['C03', '成熟成猫', '年2回の健康チェック', '1月・7月の健診'], 'cat:senior': ['C04', 'シニア猫', 'シニア猫の健康管理', '年2回の健診'] };
  const ITEM = { vaccine: '混合ワクチン', rabies: '狂犬病予防接種', filaria: 'フィラリア', flea: 'ノミ・ダニ予防', checkup: '健康診断' };
  const ORDER = ['vaccine', 'rabies', 'filaria', 'flea', 'checkup'];
  const SOON = 30, GRACE = 30;

  /* ---------- 状態 ---------- */
  const S = { pets: [], asOf: null, pet: null, screen: 'now', stack: [], dev: false, inClient: false, ls: {} };
  const store = { get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} }, del: (k) => { try { localStorage.removeItem(k); } catch (e) {} } };

  /* ---------- 判定（tag_engine v0.3 の移植。案 B の暫定判定つき） ---------- */
  const today = () => S.asOf ? new Date(S.asOf + 'T00:00:00') : new Date();
  const d = (s) => s ? new Date(String(s).slice(0, 10) + 'T00:00:00') : null;
  const days = (a, b) => Math.round((a - b) / 86400000);
  const yearsOld = (birthday) => { const b = d(birthday); if (!b) return null; const t = today(); let y = t.getFullYear() - b.getFullYear(); if ((t.getMonth(), t.getDate()) < (b.getMonth(), b.getDate())) y--; if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) y--; return y < 0 ? null : y; };
  function provisionalStage(sp, birthday) { const y = yearsOld(birthday); if (y == null || !sp) return null; if (y < 1) return 'puppy'; if (sp === 'dog') return y <= 3 ? 'young_adult' : y <= 6 ? 'mature_adult' : 'senior'; return y <= 6 ? 'young_adult' : y <= 10 ? 'mature_adult' : 'senior'; }
  function provisionalStatus(p) { const nxt = d(p.next || p.due); if (!nxt) return null; const t = today(); if (p.prev && d(p.prev) && days(t, d(p.prev)) < 330) return 'done'; const diff = days(nxt, t); if (diff > SOON) return 'pre'; if (diff > 0) return 'soon'; if (diff >= -GRACE) return 'due'; return 'overdue'; }
  function toTags(rec) {
    const tags = new Set();
    if (!rec.linked) { tags.add('linked:no'); return tags; }
    tags.add('linked:yes');
    const sp = rec.species; let ls = rec.pet_life_stage;
    if (sp) tags.add('species:' + sp);
    if (!ls && sp && rec.birthday) { ls = provisionalStage(sp, rec.birthday); if (ls) tags.add('provisional:life_stage'); }
    if (ls) tags.add('life_stage:' + ls);
    if (!sp || !ls || !SEG[sp + ':' + ls]) tags.add('data_error');
    if ((rec.owner_pet_count || 1) > 1) tags.add('pets:multi');
    for (const [item, p] of Object.entries(rec.prevention || {})) {
      if ((item === 'filaria' || item === 'rabies') && sp === 'cat') continue;
      let st = p.status;
      if (!st) { st = provisionalStatus(p); if (st) tags.add('provisional:' + item); }
      if (st) tags.add(item + ':' + st); else if (!(p.prev || p.next || p.due)) tags.add('norecord:' + item);
    }
    const f = rec.flags || {};
    for (const k of ['treatment', 'pending_judgement', 'hold', 'vet_check', 'out_of_scope']) if (f[k]) tags.add(k);
    if (rec.booking && rec.booking.item) tags.add(rec.booking.item + ':booked');
    if (!f.hold && rec.postponed_until && d(rec.postponed_until) >= today()) { tags.add('hold'); tags.add('provisional:hold'); }
    if (rec.consent && rec.consent.prevention_notice === false) tags.add('optout');
    return tags;
  }
  function resolve(rec) {
    const t = toTags(rec), has = (x) => t.has(x);
    const sp = rec.species, ls = rec.pet_life_stage || (rec.birthday ? provisionalStage(sp, rec.birthday) : null);
    const seg = sp && ls ? SEG[sp + ':' + ls] : null;
    const base = { tags: t, seg, prov: has('provisional:life_stage'), optout: has('optout') };
    if (has('linked:no')) return Object.assign(base, { rule: 'R1', state: 'unlinked' });
    if (has('data_error') || has('out_of_scope')) return Object.assign(base, { rule: 'R2', state: 'nodata' });
    if (has('treatment') || has('pending_judgement')) return Object.assign(base, { rule: 'R3', state: 'normal' });
    if (has('hold') || has('vet_check')) return Object.assign(base, { rule: 'R4', state: 'hold' });
    if ([...t].some((x) => x.endsWith(':booked'))) return Object.assign(base, { rule: 'R9', state: 'booked' });
    for (const i of ORDER) if (has(i + ':overdue')) return Object.assign(base, { rule: "R5'", state: 'overdue', item: i });
    for (const i of ORDER) if (has(i + ':due')) return Object.assign(base, { rule: { vaccine: 'R5', rabies: 'R6', filaria: 'R6', flea: 'R7', checkup: 'R8' }[i], state: 'due', item: i });
    if (has('vaccine:done')) return Object.assign(base, { rule: 'R10', state: 'done' });
    if (has('vaccine:soon')) return Object.assign(base, { rule: 'R11', state: 'soon' });
    return Object.assign(base, { rule: 'R12', state: 'normal' });
  }
  const fmt = (s) => { if (!s) return '—'; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? `${Number(m[2])}/${Number(m[3])}` : String(s).replace('T', ' '); };
  const prev = (rec) => (rec.prevention || {});
  function nowState(rec) {
    const r = resolve(rec), pv = prev(rec), has = (x) => r.tags.has(x);
    const nm = ITEM[r.item] || '予防';
    const due = (pv[r.item] || {}).due || (pv[r.item] || {}).next;
    let st;
    if (r.state === 'nodata') st = { cls: 'hold', t: 'データがありません', sub: '受付で確認します', btn: ['受付で確認', 'nodata'], pri: 4 };
    else if (r.state === 'overdue') st = { cls: 'due', t: `${nm}の期限を過ぎています`, sub: `期限 ${fmt(due)}。内容を確認して予約するか、病院へご確認ください`, btn: ['内容を確認して予約', 'detail'], pri: 1 };
    else if (r.state === 'due') st = { cls: 'due', t: `${nm}の時期です`, sub: `期限 ${fmt(due)}。内容を確認して予約できます`, btn: ['内容を確認して予約', 'detail'], pri: 2 };
    else if (r.state === 'booked') st = { cls: '', t: `${fmt(rec.booking.at)} に予約があります`, sub: `${CLINIC.name}。変更・キャンセルもここから`, btn: ['予約を確認', 'resv'], pri: 3 };
    else if (r.state === 'hold') st = { cls: 'hold', t: '病院で確認してからご案内します', sub: (rec.flags && rec.flags.hold_why) || '獣医師の確認が必要です', btn: ['病院へ確認する', 'confirm'], pri: 0 };
    else if (r.state === 'done') st = { cls: '', t: '予防は済んでいます', sub: `次回は ${fmt((pv.vaccine || {}).next)} ごろ。時期が来たらお知らせします`, btn: ['予防カレンダーを見る', 'cal'], pri: 5 };
    else if (r.state === 'soon') st = { cls: '', t: '次の予防が近づいています', sub: `次回 ${fmt((pv.vaccine || {}).next)}`, btn: ['予防カレンダーを見る', 'cal'], pri: 5 };
    else if ([...r.tags].some((x) => x.startsWith('norecord:'))) st = { cls: 'hold', t: '予防の記録がありません', sub: 'カルテに記録のない項目があります。病院へご確認ください', btn: ['予防カレンダーを見る', 'cal'], pri: 4 };
    else st = { cls: '', t: '現在ご案内はありません', sub: r.seg ? `${r.seg[2]}（${r.seg[3]}）` : '', btn: ['予防カレンダーを見る', 'cal'], pri: 5 };
    st.unread = (r.state === 'hold' || r.state === 'overdue' || r.state === 'due') ? 1 : 0;
    return st;
  }

  /* ---------- ペット ---------- */
  const pet = () => S.pets.find((x) => x.id === S.pet) || S.pets[0];
  const siblings = (p) => S.pets.filter((x) => x.linked && x.owner_id === p.owner_id);
  const av = (x) => x.species === 'dog' ? '🐶' : '🐱';
  const spj = (x) => x.species === 'dog' ? '犬' : '猫';
  const age = (x) => { if (x.age) return x.age; const y = yearsOld(x.birthday); return y == null ? '' : y < 1 ? '1歳未満' : `${y}歳`; };

  /* ---------- 描画部品 ---------- */
  function hd(title, sub) { return `<div class="hd"><button class="x" data-a="back" aria-label="戻る">‹</button><b>${esc(title)}</b><small>${esc(sub || '')}</small></div>`; }
  function petTabs() { const p = pet(); if (!p || !p.linked || ['link', 'nodata'].includes(S.screen)) return ''; const sib = siblings(p); if (sib.length < 2) return ''; return `<div class="ptabs"><button data-a="go" data-v="all" aria-pressed="${S.screen === 'all'}">すべて<small>${sib.length} 頭</small></button>${sib.map((x) => { const u = nowState(x).unread; return `<button data-a="swpet" data-v="${x.id}" aria-pressed="${S.screen !== 'all' && x.id === S.pet}">${esc(x.name)}${u ? `<span class="bd">${u}</span>` : ''}<small>${spj(x)}・${esc(age(x))}</small></button>`; }).join('')}</div>`; }
  const row = (bg, fg, mon, day, title, sub, chip, dim) => `<div class="row ${dim ? 'dim' : ''}"><div class="date" style="background:${bg};color:${fg}"><small>${mon}</small><b>${day}</b></div><div style="flex:1"><b style="font-size:13px">${esc(title)}</b><br><span class="n">${esc(sub)}</span></div><span class="pill" style="background:${bg};color:${fg}">${chip}</span></div>`;

  /* ---------- 画面 ---------- */
  const SCREENS = {};
  SCREENS.link = () => `${hd('カルテを連携')}<div class="body"><div class="card flush"><div class="head"><small>Peco動物病院グループ</small><b>カルテを連携</b><span>診察券番号とお電話番号で照合します</span></div><div class="pad"><input class="inp" inputmode="numeric" placeholder="診察券番号（例：000000）"><input class="inp" inputmode="numeric" placeholder="お電話番号（下 4 桁）"><button class="pbtn" data-a="link" data-v="ok">連携する</button><button class="sbtn" data-a="ext" data-v="${esc(CLINIC.booking)}">まだ通院していない（初診の予約へ）</button><span class="fine">検証用: 入力値は照合せず、架空の飼い主（モモ・ポチ）として連携します。本番ではカルテ側の照合 API を使います</span></div></div></div>`;
  SCREENS.nodata = () => `${hd('データがありません', '受付で確認')}<div class="body"><div class="card"><b style="font-size:15px">データがありません</b><span>この子の情報（種別・生年月日）を確認できませんでした。受付で確認しますので、次回ご来院時かお電話でお知らせください。</span><button class="pbtn" data-a="ext" data-v="${CLINIC.tel}">電話する</button><button class="sbtn" data-a="go" data-v="info">病院案内</button></div></div>`;
  SCREENS.all = () => { const p = pet(); const sib = siblings(p).map((x) => ({ x, st: nowState(x) })).sort((a, b) => a.st.pri - b.st.pri); return `${hd('うちの子', `すべて ${sib.length} 頭`)}<div class="body">${petTabs()}${sib.map(({ x, st }) => `<div class="card"><div class="pcard"><span class="av">${av(x)}</span><span class="tx"><b>${esc(x.name)}<small>　${spj(x)}・${esc(age(x))}</small></b><span style="color:${st.cls === 'due' ? 'var(--ver)' : st.cls === 'hold' ? '#6b7280' : 'var(--navy)'}">${esc(st.t)}</span></span><button class="sbtn" style="width:auto;padding:6px 12px;white-space:nowrap" data-a="swpet" data-v="${x.id}" data-to="${st.btn[1]}">${st.btn[1] === 'resv' ? '予定を見る' : st.btn[1] === 'cal' ? '見る' : '確認する'}</button></div></div>`).join('')}<span class="fine">対応の必要性の順に並んでいます</span></div>`; };
  SCREENS.now = () => { const p = pet(), st = nowState(p); return `${hd(siblings(p).length > 1 ? p.name : '今、うちの子に必要なこと')}<div class="body">${petTabs()}<div class="card flush"><div class="head ${st.cls}"><small>${esc(p.name)}　${spj(p)}・${esc(age(p))}</small><b>${esc(st.t)}</b><span>${esc(st.sub)}</span></div><div class="pad"><button class="pbtn" data-a="go" data-v="${st.btn[1]}">${esc(st.btn[0])}</button></div></div><div class="card"><button class="sbtn" data-a="go" data-v="cal">予防カレンダー（すべての項目）</button><button class="sbtn" data-a="go" data-v="resv">次の予定</button></div></div>`; };
  SCREENS.cal = () => {
    const p = pet(), r = resolve(p), pv = prev(p), dog = p.species === 'dog', has = (x) => r.tags.has(x);
    const v = pv.vaccine || {};
    const vac = r.state === 'overdue' && r.item === 'vaccine' ? row('#fdebe4', '#b8431c', '超過', fmt(v.due || v.next), '混合ワクチン', `期限 ${fmt(v.due || v.next)} を過ぎています。前回 ${fmt(v.prev)}`, '超過')
      : r.state === 'due' && r.item === 'vaccine' ? row('#fff4bf', '#8a5a00', '期限', fmt(v.due), '混合ワクチン', `前回 ${fmt(v.prev)}。期限内（案内対象）`, '時期')
      : r.state === 'booked' ? row('#e8eef9', '#1f3f6b', '予約', fmt(p.booking.at), '混合ワクチン', `予約済み ${fmt(p.booking.at)}。前回 ${fmt(v.prev)}`, '予約済')
      : r.state === 'done' ? row('#e3efe6', '#2f5a3e', '実施', fmt(v.prev), '混合ワクチン', `実施済み。次回 ${fmt(v.next)} ごろ`, '実施済')
      : r.state === 'soon' ? row('#fff4bf', '#8a5a00', '次回', fmt(v.next), '混合ワクチン', `前回 ${fmt(v.prev)}。次回時期が近づいています`, '近い')
      : r.state === 'hold' ? row('#f1f3f5', '#444', '—', '—', '混合ワクチン', `${(p.flags && p.flags.hold_why) || '病院で確認'}してからご案内`, '保留')
      : row('#eef1f4', '#1c1c1a', '次回', fmt(v.next || v.due), '混合ワクチン', `前回 ${fmt(v.prev)}`, '予定');
    const fil = dog ? row(has('filaria:due') ? '#fff4bf' : '#eef1f4', has('filaria:due') ? '#8a5a00' : '#1c1c1a', '毎月', '〜12月', 'フィラリア', (pv.filaria || {}).until ? `投薬中（${fmt(pv.filaria.until)} まで）` : '4〜12 月に毎月', has('filaria:due') ? '時期' : has('filaria:on') ? '投薬中' : '予定') : row('#f1f3f5', '#999', '—', '—', 'フィラリア', '猫には表示しない（対象外）', '対象外', true);
    const flea = has('norecord:flea') ? row('#f1f3f5', '#8b93a5', '—', '—', 'ノミ・ダニ予防（月 1 回）', '記録なし（カルテに実施・次回の記録がありません）', '記録なし', true) : row(has('flea:due') ? '#fff4bf' : '#eef1f4', has('flea:due') ? '#8a5a00' : '#1c1c1a', '次回', fmt((pv.flea || {}).next), 'ノミ・ダニ予防（月 1 回）', '自宅で投与', has('flea:due') ? '時期' : '自宅');
    const chk = row(has('checkup:due') ? '#fff4bf' : '#eef1f4', has('checkup:due') ? '#8a5a00' : '#1c1c1a', '前回', fmt((pv.checkup || {}).prev), '健康診断', has('checkup:due') ? `${(pv.checkup || {}).due || '今月'} に。血液検査込み` : '血液検査込み', has('checkup:due') ? '時期' : '予定');
    const nextCard = `<div class="card" style="padding:10px 14px"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span><b style="font-size:11px;color:var(--mut)">次の予定</b><br><b>${esc(r.state === 'booked' ? fmt(p.booking.at) + '　' + CLINIC.name : '現在予約はありません')}</b></span><button class="sbtn" style="width:auto;padding:6px 10px;white-space:nowrap" data-a="go" data-v="resv">${r.state === 'booked' ? '確認・変更' : '予約する'}</button></div></div>`;
    return `${hd('予防カレンダー', '個別')}<div class="body">${petTabs()}${nextCard}<div class="card flush"><div class="head ${r.state === 'due' || r.state === 'overdue' ? 'due' : r.state === 'hold' ? 'hold' : ''}"><small>${esc(CLINIC.name)}　${r.seg ? esc(r.seg[1]) : ''}${r.prov ? '（仮）' : ''}</small><b>${esc(p.name)}の予防</b><span>${esc(r.state === 'hold' ? '体調を確認してからご案内します' : r.state === 'overdue' ? '確認が必要な項目があります' : r.state === 'due' ? '案内対象の項目があります' : r.state === 'booked' ? '予約済み。追加の案内はお休み中' : r.seg ? r.seg[2] + '（' + r.seg[3] + '）' : '')}</span></div>${vac}${fil}${flea}${chk}<div class="pad">${r.state === 'hold' ? `<div class="ok warn">自動では予約をおすすめしません。病院で確認してからご案内します</div><button class="pbtn" data-a="go" data-v="confirm">病院へ確認する</button>` : r.state === 'overdue' ? `<button class="pbtn" data-a="go" data-v="detail">期限を過ぎた項目を確認</button>` : r.state === 'due' ? `<button class="pbtn" data-a="go" data-v="detail">${esc(ITEM[r.item])}の詳細と予約</button>` : `<button class="pbtn" data-a="ext" data-v="${esc(CLINIC.booking)}">予約する（Web 予約へ）</button>`}<button class="sbtn" data-a="go" data-v="history">実施履歴を見る</button></div></div></div>`;
  };
  SCREENS.detail = () => { const p = pet(), r = resolve(p); if (r.state !== 'due' && r.state !== 'overdue') return SCREENS.cal(); const pv = prev(p)[r.item] || {}; return `${hd('予防詳細／予約', '個別')}<div class="body">${petTabs()}<div class="card flush"><div class="head due"><small>今必要な案内</small><b>${esc(ITEM[r.item])}の${r.state === 'overdue' ? '期限を過ぎています' : '時期です'}</b><span>${esc(p.name)}</span></div><div class="pad"><div class="kv"><span>項目</span><b>${esc(ITEM[r.item])}</b><span>期限／時期</span><b style="font-size:18px;color:var(--navy)">${esc(fmt(pv.due || pv.next))}</b><span>前回</span><b>${esc(fmt(pv.prev))}</b><span>院</span><b>${esc(CLINIC.name)}</b></div>${r.state === 'overdue' ? `<div class="ok bad">期限を過ぎています。予約するか、気になることがあれば病院へご確認ください</div>` : ''}<button class="pbtn" data-a="ext" data-v="${esc(CLINIC.booking)}">予約する（Web 予約へ）</button><button class="sbtn" data-a="close">病院に相談する（トークへ）</button><span class="fine">予約完了は予防完了ではありません。実施がカルテに反映されるまで予防状態は維持されます</span></div></div></div>`; };
  SCREENS.resv = () => { const p = pet(), r = resolve(p); const body = r.state === 'booked' ? `<div class="card" style="border:2px solid var(--navy-b)"><div style="display:flex;justify-content:space-between;align-items:center"><b style="font-size:16px">📅 ${esc(fmt(p.booking.at))}</b><span class="pill" style="background:#dfe8f3;color:#1f3f6b">予約済</span></div><div class="kv"><span>🏥</span><b>${esc(CLINIC.name)}</b><span>🩺</span><b>${esc(p.booking.purpose || '混合ワクチン・健診')}</b><span>🐾</span><b>${esc(p.name)}</b></div><button class="pbtn" data-a="ext" data-v="${esc(CLINIC.booking)}">予約を変更</button><button class="sbtn" data-a="ext" data-v="${esc(CLINIC.booking)}">キャンセル</button><span class="fine">予約の正本は予約システムです</span></div>` : `<div class="card"><b style="font-size:15px">現在予約はありません</b><span class="n">新しく予約する場合は Web 予約へ</span><button class="pbtn" data-a="ext" data-v="${esc(CLINIC.booking)}">Web 予約で予約する</button></div>`; return `${hd('次の予定', '個別')}<div class="body">${petTabs()}${body}<div class="card"><button class="sbtn" data-a="close">トークへ</button></div></div>`; };
  SCREENS.history = () => { const p = pet(), pv = prev(p), v = pv.vaccine || {}; return `${hd('実施履歴', '個別')}<div class="body">${petTabs()}<div class="card flush"><div class="head"><small>実施履歴（カルテから）</small><b>${esc(p.name)}</b><span>実施済みの予防</span></div>${row('#e3efe6', '#2f5a3e', '実施', fmt(v.prev), '混合ワクチン', v.next ? `次回 ${fmt(v.next)} ごろ` : '前回の接種', '実施済')}${(pv.checkup || {}).prev ? row('#e3efe6', '#2f5a3e', '実施', fmt(pv.checkup.prev), '健康診断（血液検査）', '結果は診察時に説明済み', '実施済') : ''}<div class="pad"><button class="sbtn" data-a="go" data-v="cal">予防カレンダーへ</button><span class="fine">検査値・診断名は表示しません</span></div></div></div>`; };
  SCREENS.confirm = () => { const p = pet(); return `${hd('病院へ確認', '個別')}<div class="body">${petTabs()}<div class="card flush"><div class="head hold"><small>病院へ確認</small><b>${esc(p.name)}の予防について</b><span>${esc((p.flags && p.flags.hold_why) || '獣医師の確認が必要です')}</span></div><div class="pad"><span>体調や前回の様子を一言添えてトークに送ると、担当者が確認して返信します。</span><button class="pbtn" data-a="close">トークで送る</button><button class="sbtn" data-a="ext" data-v="${CLINIC.tel}">電話する</button><span class="fine">自動では予約をおすすめしません</span></div></div></div>`; };
  const REC = { D01: ['初年度カレンダー', '混合ワクチン、狂犬病、フィラリア・ノミダニの始め方、避妊去勢の時期を 1 枚の予定表に。'], D02: ['年1回の健康チェック', '混合ワクチン・狂犬病・健診を 1 回の来院でまとめられます。'], D03: ['健診結果を確認', '前回の健診の結果と、次に確認したい項目。'], D04: ['体重・腎肝・心臓ケア', '半年に 1 回の健診で体重・腎臓・肝臓・心臓・関節を確認します。'], C01: ['初年度カレンダー', '混合ワクチン、寄生虫予防、避妊去勢の時期を 1 枚の予定表に。'], C02: ['尿路・腎臓の基本ケア', '若い猫で多い尿路のトラブルを、食事と水分で予防します。'], C03: ['腎臓・血圧・体重変化', '年 2 回の健診で変化を早く見つけます。'], C04: ['腎臓・甲状腺・血圧', 'シニア猫で増える病気を年 2 回の健診で確認します。'] };
  SCREENS.rec = () => { const p = pet(), r = resolve(p); const rc = (r.seg && REC[r.seg[0]]) || ['院の案内', '']; return `${hd('うちの子へのおすすめ', '個別')}<div class="body">${petTabs()}<div class="card flush"><div class="head"><small>${r.seg ? esc(r.seg[1]) + '向け' : ''}</small><b>${esc(rc[0])}</b><span>${esc(p.name)}の年齢とカルテ情報から選びました</span></div><div class="pad"><span>${esc(rc[1])}</span><span class="fine">監修前の例。治療中・獣医師確認待ちでは販促を出しません（原則 2-7）</span></div></div></div>`; };
  SCREENS.consults = () => `${hd('相談履歴', 'タブ 2')}<div class="body"><div class="card"><b style="font-size:15px">相談はまだありません</b><span class="n">症状や気になることは、トークの「病院に相談する」からペットを選んで送れます。</span><button class="pbtn" data-a="close">トークへ戻る</button></div><div class="card"><span class="fine">状態: 受付完了 → 確認中 → 返信済み。受付完了は診療完了ではありません。緊急時はお電話ください</span><button class="sbtn" data-a="ext" data-v="${CLINIC.tel}">緊急時は電話</button></div></div>`;
  SCREENS.info = () => `${hd('病院案内', '共通')}<div class="body"><div class="card"><b style="font-size:15px">Peco動物病院 ${esc(CLINIC.name)}</b><div class="kv"><span>診察時間</span><b>${esc(CLINIC.hours)}</b><span>電話</span><b>050-3649-5078</b></div><button class="pbtn" data-a="ext" data-v="${esc(CLINIC.booking)}">Web 予約</button><button class="sbtn" data-a="ext" data-v="${CLINIC.tel}">電話する</button></div></div>`;

  /* ---------- 描画と操作 ---------- */
  function devBar() { if (!S.dev) return ''; return `<div class="dev"><span class="lb">検証用</span>${S.pets.map((x) => `<button data-a="selpet" data-v="${x.id}" aria-pressed="${x.id === S.pet}">${x.id} ${esc(x.name)}</button>`).join('')}<button data-a="unlink">連携解除</button></div>`; }
  function render() {
    const p = pet();
    let scr = S.screen;
    if (!p || !p.linked) scr = ['info'].includes(scr) ? scr : 'link';
    else if (resolve(p).state === 'nodata' && !['info', 'history', 'consults'].includes(scr)) scr = 'nodata';
    else if (scr === 'link') scr = 'now';
    const html = (SCREENS[scr] || SCREENS.now)();
    document.getElementById('app').innerHTML = html + devBar();
    window.scrollTo(0, 0);
  }
  function go(v) { if (S.screen !== v) S.stack.push(S.screen); S.screen = v; render(); }
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const a = b.dataset.a, v = b.dataset.v;
    if (a === 'go') go(v);
    else if (a === 'back') { S.screen = S.stack.pop() || (S.inClient ? '__close' : 'now'); if (S.screen === '__close') { S.screen = 'now'; close(); return; } render(); }
    else if (a === 'close') close();
    else if (a === 'swpet') { S.pet = v; store.set('peco_pet', v); if (b.dataset.to) { S.stack.push(S.screen); S.screen = b.dataset.to; } else if (S.screen === 'all') { S.stack.push('all'); S.screen = 'now'; } render(); }
    else if (a === 'selpet') { S.pet = v; store.set('peco_pet', v); S.stack = []; S.screen = 'now'; render(); }
    else if (a === 'link') { S.pet = 'T13'; store.set('peco_pet', 'T13'); S.stack = []; S.screen = 'all'; render(); }
    else if (a === 'unlink') { store.del('peco_pet'); S.pet = 'T12'; S.stack = []; S.screen = 'link'; render(); }
    else if (a === 'ext') { if (v.startsWith('tel:')) location.href = v; else if (window.liff && liff.isInClient && liff.isInClient()) liff.openWindow({ url: v, external: true }); else window.open(v, '_blank'); }
  });
  function close() { if (window.liff && liff.isInClient && liff.isInClient()) liff.closeWindow(); else { S.screen = 'now'; render(); } }

  /* ---------- 起動 ---------- */
  function routeFromUrl() {
    const u = new URL(location.href);
    const q = u.searchParams.get('p');
    const base = (document.querySelector('base') || {}).href || '';
    let path = u.pathname.replace(/\/index\.html$/, '').split('/').filter(Boolean).pop() || '';
    if (['now', 'all', 'cal', 'resv', 'rec', 'consults', 'link', 'nodata', 'detail', 'history', 'confirm', 'info'].includes(q || '')) return q;
    if (['now', 'all', 'cal', 'resv', 'rec', 'consults', 'link', 'nodata', 'detail', 'history', 'confirm', 'info'].includes(path)) return path;
    const st = u.searchParams.get('liff.state'); if (st) { const m = st.match(/^\/?(\w+)/); if (m && SCREENS[m[1]]) return m[1]; }
    return 'now';
  }
  async function boot() {
    const u = new URL(location.href);
    S.dev = u.searchParams.get('dev') === '1' || store.get('peco_dev') === '1';
    if (u.searchParams.get('dev') === '1') store.set('peco_dev', '1');
    try { const res = await fetch(new URL('data/pets.json', document.baseURI).href, { cache: 'no-store' }); const j = await res.json(); S.pets = j.pets; S.asOf = j.as_of; } catch (e) { document.getElementById('app').innerHTML = `${hd('PECO LINE OS')}<div class="body"><div class="card"><div class="ok bad">情報を取得できませんでした</div><span>いま表示できる最新の情報がありません。古い情報は表示しません。</span><button class="pbtn" data-a="reload" onclick="location.reload()">もう一度読み込む</button><a class="sbtn" href="${CLINIC.tel}">電話する</a></div></div>`; return; }
    const owners = {}; S.pets.forEach((p) => { owners[p.owner_id] = (owners[p.owner_id] || 0) + 1; }); S.pets.forEach((p) => { p.owner_pet_count = owners[p.owner_id]; });
    const qp = u.searchParams.get('pet'); const saved = store.get('peco_pet');
    S.pet = qp && S.pets.some((x) => x.id === qp) ? qp : saved && S.pets.some((x) => x.id === saved) ? saved : 'T12';
    if (qp) store.set('peco_pet', qp);
    S.screen = routeFromUrl();
    const p = pet();
    if (S.screen === 'now' && p && p.linked && siblings(p).length > 1 && !qp) S.screen = 'all'; // リッチメニューから開いたら「すべて」（D34）。案内 1 通からは ?pet= でその子へ
    render();
    try { if (window.liff) { await liff.init({ liffId: LIFF_ID }); S.inClient = liff.isInClient(); } } catch (e) { /* LIFF 外（PC ブラウザ）でも動かす */ }
  }
  boot();
})();
