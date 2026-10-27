/* 무안초 4학년 기록부 Firebase 어댑터: 기존 MuanCloud API 유지 */
(() => {
 'use strict';
 const config = window.MUAN_FIREBASE_CONFIG || {};
 const CDN = 'https://www.gstatic.com/firebasejs/11.10.0/';
 const fields=['hours','completion','schedule','events','external'];
 const legacyKeys=['muan-grade4-subject-hours-v1','muan-grade4-completion-overrides-v1','muan-grade4-schedule-overrides-v1','muan-grade4-events-v1','muan-grade4-external-education-v1'];
 const draftKey='muan-grade4-firebase-draft-v1';
 const clone=x=>JSON.parse(JSON.stringify(x));
 const empty=()=>({hours:{},completion:{},schedule:{},events:{},external:{}});
 const uid=()=>crypto.randomUUID().replaceAll('-','');
 let api,db,auth,state=null,apply=null,draft=null,adminMode=false,loading=false,busy=false,conflict=false,ready=false;
 let status,bar,actions,importInput,csvInput,importBtn,retryBtn,latestBtn;
 let initialMessage='Firebase 연결 준비 중',initialKind='warning';
 try {draft=JSON.parse(localStorage.getItem(draftKey)||'null');conflict=!!draft;}catch{conflict=true;initialMessage='보관된 미전송 기록을 해석할 수 없습니다. 로컬 저장소를 확인하세요.';}
 function valid(data){
   if(!data||typeof data!=='object'||Array.isArray(data)||Object.keys(data).length!==5||JSON.stringify(data).length>700000)throw Error('데이터 크기 또는 백업 구조가 올바르지 않습니다(최대 700KB).');
   for(const field of fields){
     const group=data[field];if(!group||typeof group!=='object'||Array.isArray(group))throw Error('백업 항목이 누락되었습니다: '+field);
     for(const [date,value] of Object.entries(group)){
       if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<'2026-08-21'||date>'2027-01-08')throw Error('학기 범위 밖 날짜: '+date);
       if(field==='hours'||field==='completion'){
         if(!value||typeof value!=='object'||Array.isArray(value))throw Error('시수 자료 형식 오류');
         for(const [key,v] of Object.entries(value)) if(!/^4-[1-4]\|(체육|영어|사회)$/.test(key)||(field==='hours'?(!Number.isInteger(v)||v<0||v>1000):typeof v!=='boolean'))throw Error('시수 값 오류');
       }else{
         if(!Array.isArray(value)||value.length>200)throw Error('일정 배열 형식 오류');
         for(const item of value){
           if(!item||typeof item!=='object'||Array.isArray(item))throw Error('일정 값 오류');
           if(field==='schedule'){
             if(!/^4-[1-4]$/.test(item.cls)||!['체육','영어','사회'].includes(item.subject)||!Number.isInteger(item.period)||item.period<1||item.period>6)throw Error('시간표 형식 오류');
           }else{
             if(typeof item.id!=='string'||!item.id||typeof item.title!=='string'||!item.title.trim()||item.title.length>500)throw Error('행사 형식 오류');
             if(field==='external'&&(!Number.isInteger(item.period)||item.period<1||item.period>6||!Array.isArray(item.classes)||!item.classes.length||item.classes.some(c=>!/^4-[1-4]$/.test(c))))throw Error('외부 교육 형식 오류');
           }
         }
       }
     }
   }
   return data;
 }
 function configured(){return config.apiKey && !config.apiKey.startsWith('REPLACE_') && config.projectId && !config.projectId.startsWith('REPLACE_');}
 function canEdit(){return !!(ready&&auth?.currentUser&&adminMode&&state&&!busy&&!loading&&!conflict);}
 function show(msg,kind='warning'){initialMessage=msg;initialKind=kind;paint();}
 function paint(){if(!status)return;bar.hidden=!adminMode&&initialKind!=='error';actions.hidden=!adminMode;status.textContent=initialMessage;status.dataset.kind=initialKind;importBtn.disabled=!canEdit();retryBtn.disabled=busy||loading;latestBtn.hidden=!draft;latestBtn.disabled=busy||loading;}
 function notify(){if(apply&&state)apply(clone(state.data));}
 function filename(prefix){return prefix+'_'+new Date().toISOString().replace(/[:.]/g,'-')+'.json';}
 function download(payload,name){let url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));let a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
 function backup(){const data=draft?.data||state?.data||legacy();download({format:'muan-grade4-backup-v1',revision:state?.revision||0,savedAt:new Date().toISOString(),data},filename('무안초_4학년_기록백업'));}
 function legacy(){const o=empty();fields.forEach((f,i)=>{const v=localStorage.getItem(legacyKeys[i]);if(v)o[f]=JSON.parse(v);});if(!localStorage.getItem(legacyKeys[1]))for(const [d,v] of Object.entries(o.hours))o.completion[d]=Object.fromEntries(Object.keys(v).map(k=>[k,true]));return valid(o);}
 async function init(){
   if(!configured()){show('firebase-config.js의 설정을 먼저 입력하세요.','error');return;}
   try{
     const [app,fire,au]=await Promise.all([import(CDN+'firebase-app.js'),import(CDN+'firebase-firestore.js'),import(CDN+'firebase-auth.js')]);
     const instance=app.initializeApp(config);db=fire.getFirestore(instance);auth=au.getAuth(instance);api={...fire,...au};
     await au.setPersistence(auth,au.browserSessionPersistence);
     ready=true;
     au.onAuthStateChanged(auth,()=>paint());
     await refresh();
   }catch(e){show('Firebase 초기화 실패: '+e.message,'error');}
 }
 async function refresh(){
   if(!ready||busy||loading||draft)return;
   loading=true;paint();
   try{
     const snap=await api.getDoc(api.doc(db,'muanGrade4','state'));
     if(!snap.exists()){state=null;show('공용 데이터가 비어 있습니다. 관리자 Google 로그인 후 기존 시트 기록을 가져오세요.');}
     else{const s=snap.data();valid(s.data);const changed=!state||state.revision!==s.revision;state={revision:s.revision,data:clone(s.data),savedAt:s.savedAt?.toDate?.()?.toISOString()||''};conflict=false;if(changed)notify();show('Firebase 연결됨 · 수정본 '+s.revision,'ok');}
   }catch(e){show('조회 오류: '+e.message,'error');}
   finally{loading=false;paint();}
 }
 async function login(){
   if(!ready)throw Error('Firebase 초기화가 되지 않았습니다.');
   if(location.origin!=='https://seungmin999.github.io')throw Error('관리자 로그인은 원래 GitHub Pages 주소에서만 가능합니다.');
   const provider=new api.GoogleAuthProvider();provider.setCustomParameters({prompt:'select_account'});
   try{await api.signInWithPopup(auth,provider);}catch(e){throw Error('Google 로그인 실패: '+e.message);}
   // UI 로그인 상태는 서버 보안 규칙 권한과 별개. 최초 실제 수정 전 트랜잭션에서 재검증됩니다.
   try{await api.getDocs(api.query(api.collection(db,'muanGrade4Backups'),api.limit(1)));}
   catch(e){await api.signOut(auth);throw Error('관리자 UID가 Firestore 규칙에 허용되지 않았습니다. 관리자 UID 설정을 확인하세요. '+e.message);}
   if(!state&&!draft)await refresh();return true;
 }
 async function save(){
   if(!draft||busy||!ready||!auth.currentUser)return;
   busy=true;paint();show('Firebase 트랜잭션 저장 중…');
   const sending=clone(draft);
   try{
     const ref=api.doc(db,'muanGrade4','state');
     await api.runTransaction(db,async tx=>{
       const snap=await tx.get(ref);const revision=snap.exists()?snap.data().revision:0;
       if(revision!==sending.revision)throw Object.assign(new Error('다른 기기에서 먼저 수정했습니다. 미전송 기록을 백업하고 충돌을 해결하세요.'),{code:'CONFLICT'});
       const next=revision+1, record={revision:next,data:sending.data,savedAt:api.serverTimestamp(),requestId:sending.requestId};
       tx.set(ref,record);tx.create?tx.create(api.doc(db,'muanGrade4Backups','r'+next),record):tx.set(api.doc(db,'muanGrade4Backups','r'+next),record);
     });
     const savedRevision=sending.revision+1;state={revision:savedRevision,data:clone(sending.data)};
     if(draft?.requestId===sending.requestId){draft=null;localStorage.removeItem(draftKey);conflict=false;}
     notify();show('저장 완료 · 버전 '+savedRevision,'ok');
   }catch(e){conflict=true;show('저장되지 않았습니다: '+e.message,'error');}
   finally{busy=false;paint();}
 }
 let timer;
 function change(data){
   if(!state||JSON.stringify(state.data)===JSON.stringify(data)||draft&&JSON.stringify(draft.data)===JSON.stringify(data))return;
   if(!canEdit()){notify();return;}
   valid(data);draft={revision:state.revision,requestId:uid(),data:clone(data)};
   try{localStorage.setItem(draftKey,JSON.stringify(draft));}catch{draft=null;show('미전송 기록을 보호할 수 없어 저장을 중단했습니다.','error');notify();return;}
   clearTimeout(timer);timer=setTimeout(save,500);show('임시 저장 완료 · 서버 전송 대기');
 }
 async function latest(){
   if(!confirm('미전송 내용을 JSON으로 백업한 후 Firebase 최신 기록을 불러옵니다. 계속할까요?'))return;
   backup();draft=null;localStorage.removeItem(draftKey);conflict=false;await refresh();
 }
 async function importData(data){
   valid(data);
   if(!ready||!auth.currentUser||!adminMode||busy)throw Error('관리자로 먼저 로그인하세요.');
   if(draft)throw Error('미전송 기록을 먼저 해결하세요.');
   if(!confirm('기존 공용 데이터를 백업한 후 가져온 기록으로 대체할까요?'))return;
   backup();
   // 가져오기 시에는 기존 서버 상태를 수정하지 않고 트랜잭션의 최신 revision을 검증
   const revision=state?.revision||0;
   draft={revision,requestId:uid(),data:clone(data)};localStorage.setItem(draftKey,JSON.stringify(draft));await save();
 }
 // CSV는 Google Sheets > 파일 > 다운로드 > 쉼표로 구분된 값(.csv) (revision,request,part,parts,data,savedAt)
 function parseCSV(src){
   src=src.replace(/^\uFEFF/,'');const rows=[];let row=[],v='',quoted=false;
   for(let i=0;i<src.length;i++){const c=src[i];if(quoted){if(c==='"'&&src[i+1]==='"'){v+='"';i++;}else if(c==='"')quoted=false;else v+=c;}
     else if(c==='"')quoted=true;else if(c===','){row.push(v);v='';}else if(c==='\n'){row.push(v.replace(/\r$/,''));rows.push(row);row=[];v='';}else v+=c;}
   if(v||row.length){row.push(v);rows.push(row);}if(quoted)throw Error('CSV 인용부호가 닫히지 않았습니다.');return rows;
 }
 function fromSheetCSV(src){
   const rows=parseCSV(src),header=rows.shift()?.map(s=>s.trim())||[];
   for(const f of ['revision','part','parts','data'])if(!header.includes(f))throw Error('시트 열이 없습니다: '+f);
   const i=Object.fromEntries(header.map((s,j)=>[s,j]));const group=new Map();
   for(const r of rows){const rev=Number(r[i.revision]),part=Number(r[i.part]),total=Number(r[i.parts]);if(!Number.isInteger(rev)||rev<1||!Number.isInteger(part)||!Number.isInteger(total)||total<1||total>100||part<0||part>=total)continue;
     if(!group.has(rev))group.set(rev,{total,parts:new Map()});const g=group.get(rev);if(g.total!==total)continue;g.parts.set(part,r[i.data]||'');}
   for(const rev of [...group.keys()].sort((a,b)=>b-a)){
     const g=group.get(rev);if(g.parts.size!==g.total)continue;
     try{let value=JSON.parse(Array.from({length:g.total},(_,j)=>g.parts.get(j)).join(''));if(value?.data && !value.hours)value=value.data;valid(value);return {revision:rev,data:value};}catch{}
   }
   throw Error('복원할 수 있는 완전한 revision을 찾지 못했습니다. 원본 시트의 data 열을 확인하세요.');
 }
 function inputFile(accept,onFile){const inp=document.createElement('input');inp.type='file';inp.accept=accept;inp.hidden=true;inp.onchange=async()=>{try{const f=inp.files[0];if(f)await onFile(f);}catch(e){show(e.message,'error');}finally{inp.value='';}};bar.append(inp);return inp;}
 function mount(){
   bar=document.createElement('section');bar.className='cloudBar';bar.setAttribute('aria-label','Firebase 공용 기록');
   status=document.createElement('p');status.setAttribute('role','status');bar.append(status);
   actions=document.createElement('div');actions.className='cloudActions';bar.append(actions);
   function button(text,cb){const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=()=>Promise.resolve().then(cb).catch(e=>show(e.message,'error'));actions.append(b);return b;}
   retryBtn=button('다시 연결 / 미전송 기록 전송',()=>draft?save():refresh());latestBtn=button('최신 기록 불러오기',latest);
   button('전체 JSON 백업',backup);
   button('이 컴퓨터 예전 기록 백업',()=>download({format:'muan-grade4-backup-v1',data:legacy()},filename('무안초_예전기록')));
   importBtn=button('JSON 기록 가져오기',()=>importInput.click());
   button('Google Sheets CSV 가져오기',()=>csvInput.click());
   importInput=inputFile('.json,application/json',async f=>{const j=JSON.parse(await f.text());if(j.format!=='muan-grade4-backup-v1')throw Error('무안초 전체 백업 JSON만 지원합니다.');await importData(j.data);});
   csvInput=inputFile('.csv,text/csv',async f=>{if(!auth?.currentUser||!adminMode)throw Error('관리자로 먼저 로그인하세요.');const r=fromSheetCSV(await f.text());if(!confirm('시트에서 가장 최신의 완전한 revision '+r.revision+'을 찾았습니다. 가져올까요?'))return;await importData(r.data);});
   document.body.insertBefore(bar,document.getElementById('root'));paint();init();
   window.addEventListener('beforeunload',e=>{if(draft||busy){e.preventDefault();e.returnValue='';}});
   window.addEventListener('online',()=>{if(!draft)refresh();});
   setInterval(()=>{if(!document.hidden&&!document.querySelector('.modalBackdrop,.dateDrawerBackdrop')&&!draft)refresh();},60000);
   // 서버가 확인될 때까지 변경 이벤트 차단(조회 및 월 이동은 유지)
   ['click','keydown','pointerdown','drop','input','change','submit'].forEach(type=>document.addEventListener(type,e=>{
     if(!e.target.closest?.('#root')||e.target.closest('.loginModal')||e.target.closest('.adminButton'))return;
     if(e.target.closest('.calendarHead button,.sideMonthButton'))return;
     if(busy||loading||conflict&&e.target.closest('form,.dateDrawer,.scheduleBlock,.eventBlock,.externalBlock,.actionMenu,.activityDetailModal')){e.preventDefault();e.stopImmediatePropagation();}
   },true));
 }
 window.MuanCloud={
  setAdminMode(v){adminMode=!!v;paint();},
  connect(fn){apply=fn;if(state)notify();return()=>{apply=null;};},
  change,login,logout(){adminMode=false;if(auth)api.signOut(auth).catch(e=>show('로그아웃 오류: '+e.message,'error'));paint();},
  authMessage(m){show(m,'error');},canEdit,valid
 };
 document.addEventListener('DOMContentLoaded',mount);
})();
