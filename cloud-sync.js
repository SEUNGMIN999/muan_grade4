/* Apps Script 공용 저장소 연결. 원래 localStorage 키는 복구용으로 보존합니다. */
(() => {
  'use strict';
  const config = window.MUAN_CLOUD_CONFIG || {};
  const url = config.url || '';
  const fields = ['hours','completion','schedule','events','external'];
  const legacyKeys = ['muan-grade4-subject-hours-v1','muan-grade4-completion-overrides-v1','muan-grade4-schedule-overrides-v1','muan-grade4-events-v1','muan-grade4-external-education-v1'];
  const draftKey = 'muan-grade4-cloud-draft-v1:' + url;
  const sessionKey = 'muan-grade4-cloud-token:' + url;
  const copy = x => JSON.parse(JSON.stringify(x));
  const equal = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const empty = () => ({hours:{},completion:{},schedule:{},events:{},external:{}});
  const id = () => crypto.randomUUID().replaceAll('-','');
  let apply, server = null, draft = null, busy = false, conflict = false, loading = false, timer, token = '';
  let status, retryButton, loadButton, importButton, legacyButton, fileInput;
  let stateMessage = '공용 저장소 연결 준비 중';
  let stateKind = 'warning';
  const readLocal = (key, store=localStorage) => { try { return store.getItem(key); } catch { return null; } };
  token = readLocal(sessionKey, sessionStorage) || '';
  try { draft = JSON.parse(readLocal(draftKey)); } catch { /* 원문은 삭제하지 않음 */ }
  if (draft) { conflict = true; stateMessage = '이 컴퓨터에 미전송 기록이 있습니다. 백업 후 다시 보내거나 최신 기록을 불러오세요.'; }
  function valid(data) {
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).length !== 5 || JSON.stringify(data).length > 1000000) throw Error('전체 백업 형식이 올바르지 않습니다.');
    for (const field of fields) {
      const group = data[field];
      if (!group || typeof group !== 'object' || Array.isArray(group)) throw Error('백업 항목이 빠졌습니다.');
      for (const [date,value] of Object.entries(group)) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < '2026-08-21' || date > '2027-01-08') throw Error('학기 범위 밖의 기록입니다.');
        if (field === 'hours' || field === 'completion') {
          if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('시수 형식이 잘못되었습니다.');
          for (const [key,v] of Object.entries(value)) {
            if (!/^4-[1-4]\|(체육|영어|사회)$/.test(key) || (field === 'hours' ? !Number.isInteger(v) || v < 0 || v > 1000 : typeof v !== 'boolean')) throw Error('시수 값이 잘못되었습니다.');
          }
        } else {
          if (!Array.isArray(value) || value.length > 200) throw Error('일정 형식이 잘못되었습니다.');
          for (const item of value) {
            if (!item || typeof item !== 'object' || Array.isArray(item)) throw Error('일정 형식이 잘못되었습니다.');
            if (field === 'schedule') {
              if (!/^4-[1-4]$/.test(item.cls) || !['체육','영어','사회'].includes(item.subject) || !Number.isInteger(item.period) || item.period < 1 || item.period > 6) throw Error('시간표 형식이 잘못되었습니다.');
            } else {
              if (typeof item.id !== 'string' || !item.id || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 500) throw Error('행사 형식이 잘못되었습니다.');
              if (field === 'external' && (!Number.isInteger(item.period) || item.period < 1 || item.period > 6 || !Array.isArray(item.classes) || !item.classes.length || item.classes.some(c => !/^4-[1-4]$/.test(c)))) throw Error('외부교육 형식이 잘못되었습니다.');
            }
          }
        }
      }
    }
    return data;
  }
  function configured() { return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url); }
  function canEdit() { return !!(server && token && !busy && !conflict && !loading && configured()); }
  function show(message, kind='warning') { stateMessage=message; stateKind=kind; paint(); }
  function paint() {
    if (!status) return;
    status.textContent=stateMessage; status.dataset.kind=stateKind;
    retryButton.hidden=!configured(); retryButton.disabled=busy || loading;
    retryButton.textContent=draft ? '미전송 기록 다시 보내기' : '새로 확인';
    loadButton.hidden=!draft; loadButton.disabled=busy || loading;
    importButton.disabled=!canEdit(); legacyButton.disabled=!canEdit();
  }
  function notify() { if (apply && server) apply(copy(server.data)); }
  function readRemote() {
    return new Promise((resolve,reject) => {
      const callback='muanRead_'+id(), script=document.createElement('script');
      let timeout;
      const cleanup=()=>{clearTimeout(timeout);script.remove();delete window[callback];};
      window[callback]=result=>{cleanup(); result.ok ? resolve(result) : reject(Object.assign(Error(result.message), {code:result.code}));};
      script.onerror=()=>{cleanup();reject(Error('공용 저장소에 연결하지 못했습니다. 인터넷과 배포 설정을 확인해주세요.'));};
      timeout=setTimeout(()=>{cleanup();reject(Error('공용 저장소 응답이 늦습니다. 잠시 후 다시 확인해주세요.'));},45000);
      script.src=url+'?callback='+callback+'&time='+Date.now(); document.head.append(script);
    });
  }
  // form POST + postMessage로 저장 완료 응답을 받습니다. no-cors의 불투명 응답을 성공으로 간주하지 않습니다.
  function post(payload) {
    return new Promise((resolve,reject)=>{
      const nonce=id(), frame=document.createElement('iframe'), form=document.createElement('form'), input=document.createElement('input');
      frame.name='muanPost_'+nonce; frame.hidden=true; frame.title='공용 기록 전송'; form.hidden=true;
      form.method='POST';form.action=url;form.target=frame.name;
      input.type='hidden';input.name='payload';input.value=JSON.stringify({...payload,nonce,origin:location.origin});form.append(input);
      let timeout;
      const cleanup=()=>{clearTimeout(timeout);window.removeEventListener('message',listener);form.remove();frame.remove();};
      const listener=event=>{
        if (!/^https:\/\/(?:[a-z0-9-]+\.)?script\.googleusercontent\.com$/.test(event.origin) && !/^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/.test(event.origin)) return;
        if (event.data?.channel !== 'muan-grade4' || event.data.nonce !== nonce) return;
        const result=event.data.result;cleanup();
        result?.ok ? resolve(result) : reject(Object.assign(Error(result?.message || '저장하지 못했습니다.'),{code:result?.code}));
      };
      window.addEventListener('message',listener);
      timeout=setTimeout(()=>{cleanup();reject(Error('저장 확인 응답을 받지 못했습니다. 미전송 기록은 이 컴퓨터에 보관했습니다. 다시 보내기를 눌러 확인해주세요.'));},45000);
      document.body.append(frame,form); form.submit();
    });
  }
  async function refresh() {
    if (!configured() || busy || loading || draft) return;
    loading=true;
    try {
      const result=await readRemote();valid(result.data);
      const changed=!server || result.revision !== server.revision;
      server=result; conflict=false;
      if(changed) notify();
      show(result.revision ? '공용 기록 연결됨 · '+new Date(result.savedAt).toLocaleString('ko-KR') : '공용 저장소가 비어 있습니다. 관리자 로그인 후 학교 기록을 가져오세요.','ok');
    } catch(e) { show(e.message,'error'); }
    finally { loading=false;paint(); }
  }
  function persistDraft() {
    try { localStorage.setItem(draftKey,JSON.stringify(draft));return true; }
    catch { show('이 브라우저에 복구용 기록을 보관할 수 없어 전송을 중단했습니다. 전체 백업을 내려받아 주세요.','error');conflict=true;return false; }
  }
  function change(data) {
    if (!server || equal(data,server.data) || (draft && equal(data,draft.data))) return;
    if (!canEdit()) { notify();return; }
    valid(data);
    draft={revision:server.revision,requestId:id(),data:copy(data)};
    if(!persistDraft()) return;
    show('공용 저장 대기 중 · 창을 닫지 마세요.');clearTimeout(timer);timer=setTimeout(save,500);
  }
  async function save() {
    if (!draft || busy || !configured()) return;
    if(!token) { show('미전송 기록을 보내려면 관리자 로그인해주세요.','error');return; }
    busy=true;paint();show('공용 저장 중 · 창을 닫지 마세요.');
    const sending=copy(draft);
    try {
      const result=await post({action:'commit',token,...sending});
      server={...result,data:sending.data};draft=null;conflict=false;
      try {localStorage.removeItem(draftKey);} catch { /* 다음 접속 시 요청 ID로 중복 저장 방지 */ }
      notify(); show('공용 저장 완료 · '+new Date(result.savedAt).toLocaleTimeString('ko-KR'),'ok');
    } catch(e) {
      conflict=true;
      if(e.code==='AUTH') {token='';try{sessionStorage.removeItem(sessionKey);}catch{}window.dispatchEvent(new Event('muan-auth-expired'));}
      show(e.message,'error');
    } finally { busy=false;paint(); }
  }
  async function login(password) {
    if(!configured()) throw Error('Apps Script 배포 주소를 먼저 연결해주세요.');
    if(location.origin!=='https://seungmin999.github.io') throw Error('수정은 기존 GitHub Pages 웹앱 주소에서 해주세요. 이 파일은 백업 확인용으로 사용할 수 있습니다.');
    const result=await post({action:'login',password});token=result.token;
    try{sessionStorage.setItem(sessionKey,token);}catch{}
    paint();if(!server && !draft) await refresh();return true;
  }
  function download(data,name) {
    const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}), link=document.createElement('a');
    link.href=URL.createObjectURL(blob);link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
  }
  function backup() {
    const data=draft?.data || server?.data || legacy();
    download({format:'muan-grade4-backup-v1',savedAt:new Date().toISOString(),data},'무안초_4학년_전체백업_'+Date.now()+'.json');
  }
  function legacy() {
    const data=empty();fields.forEach((field,i)=>{const value=readLocal(legacyKeys[i]);if(value) data[field]=JSON.parse(value);});
    if(!readLocal(legacyKeys[1])) for(const [date,values] of Object.entries(data.hours)) data.completion[date]=Object.fromEntries(Object.keys(values).map(k=>[k,true]));
    return valid(data);
  }
  function importData(data) {
    if(!canEdit()) throw Error('공용 저장소 연결과 관리자 로그인을 먼저 확인해주세요.');
    valid(data);
    if(!confirm('선택한 기록으로 공용 기록 전체를 교체할까요? 현재 공용 기록의 백업 파일도 내려받습니다.'))return;
    backup();change(data);if(apply)apply(copy(data));
  }
  async function loadLatest() {
    if(!confirm('미전송 기록은 백업 파일로 내려받고, 화면은 공용 최신 기록으로 바꿀까요?'))return;
    backup();loading=true;paint();
    try {
      const result=await readRemote();valid(result.data);server=result;draft=null;conflict=false;
      localStorage.removeItem(draftKey);notify();show('공용 최신 기록을 불러왔습니다.','ok');
    } catch(e){show(e.message,'error');}finally{loading=false;paint();}
  }
  function mount() {
    const bar=document.createElement('section');bar.className='cloudBar';bar.setAttribute('aria-label','공용 저장 상태');
    status=document.createElement('p');status.setAttribute('role','status');bar.append(status);
    const actions=document.createElement('div');actions.className='cloudActions';bar.append(actions);
    function button(text,fn){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=()=>Promise.resolve().then(fn).catch(e=>show(e.message,'error'));actions.append(b);return b;}
    retryButton=button('새로 확인',()=>draft?save():refresh());
    loadButton=button('최신 기록 불러오기',loadLatest);
    button('전체 백업',backup);
    button('이 컴퓨터의 예전 기록 백업',()=>download({format:'muan-grade4-backup-v1',data:legacy()},'무안초_학교기록_백업_'+Date.now()+'.json'));
    importButton=button('백업 파일 가져오기',()=>fileInput.click());
    legacyButton=button('이 컴퓨터의 예전 기록 가져오기',()=>{
      const data=legacy();if(!fields.some(f=>Object.keys(data[f]).length)) throw Error('이 브라우저에는 예전 입력 기록이 없습니다. 학교에서 사용한 브라우저에서 실행해주세요.');importData(data);
    });
    fileInput=document.createElement('input');fileInput.type='file';fileInput.accept='.json,application/json';fileInput.hidden=true;
    fileInput.onchange=async()=>{try{const file=fileInput.files[0];if(!file)return;if(file.size>2000000)throw Error('백업 파일이 너무 큽니다.');const saved=JSON.parse(await file.text());if(saved.format!=='muan-grade4-backup-v1')throw Error('전체 백업 JSON 파일을 선택해주세요.');importData(saved.data);}catch(e){show(e.message,'error');}finally{fileInput.value='';}};
    bar.append(fileInput);document.body.insertBefore(bar,document.getElementById('root'));
    if(!configured()) show('공용 저장소 미연결 · Apps Script 배포 주소를 설정해야 공유됩니다. 기존 기록은 예전 기록 백업으로 보관할 수 있습니다.');else paint();
    // 저장 중 추가 수정을 막아 응답 이후의 변경이 사라지는 것을 방지합니다.
    ['click','keydown','pointerdown','drop','input','change','submit'].forEach(type=>document.addEventListener(type,e=>{
      if(!e.target.closest?.('#root') || e.target.closest('.loginModal') || e.target.closest('.adminButton'))return;
      if(busy || loading || conflict && e.target.closest('form,.dateDrawer,.scheduleBlock,.eventBlock,.externalBlock,.actionMenu,.activityDetailModal')){e.preventDefault();e.stopImmediatePropagation();}
    },true));
    window.addEventListener('beforeunload',e=>{if(draft || busy){e.preventDefault();e.returnValue='';}});
    window.addEventListener('online',()=>{if(!draft)refresh();});
    window.setInterval(()=>{if(!document.hidden && !document.querySelector('.modalBackdrop,.dateDrawerBackdrop') && !draft)refresh();},60000);
  }
  window.MuanCloud={
    connect(fn){apply=fn;if(server)notify();else if(draft){try{apply(copy(valid(draft.data)));}catch(e){show(e.message,'error');}}else refresh();return()=>{apply=null;};},change,login,
    logout(){const old=token;token='';try{sessionStorage.removeItem(sessionKey);}catch{}if(old)post({action:'logout',token:old}).catch(()=>{});paint();},
    authMessage(message){show(message,'error');},canEdit,valid
  };
  document.addEventListener('DOMContentLoaded',mount);
})();
