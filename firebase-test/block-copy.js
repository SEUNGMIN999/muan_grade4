/* 원본을 유지하고 새로운 블록을 만드는 공통 복사 기능. */
(() => {
  'use strict';
  function plan({kind,item,date,period,data,daySchedule,holidays={}}) {
    if(!['schedule','event','external'].includes(kind) || !item) throw Error('복사할 블록을 다시 선택해주세요.');
    const day=new Date(date+'T12:00:00');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(day.getTime()) || date<'2026-08-21' || date>'2027-01-08' || day.getDate()!==Number(date.slice(8))) throw Error('2학기 기간 안의 날짜를 선택해주세요.');
    if([0,6].includes(day.getDay())) throw Error('달력에 표시되는 평일을 선택해주세요.');
    if(kind!=='event' && (holidays[date] || (data.events[date]||[]).some(e=>e.noClass))) throw Error('휴일·수업 없는 날에는 수업 블록을 복사할 수 없습니다.');
    if(kind!=='event' && (!Number.isInteger(period)||period<1||period>6)) throw Error('1~6교시를 선택해주세요.');
    const next=JSON.parse(JSON.stringify(data)), copied=JSON.parse(JSON.stringify(item));
    if(kind==='schedule') {
      if(daySchedule.some(e=>e.cls===item.cls && e.subject===item.subject)) throw Error('선택한 날짜에 같은 학급·과목이 이미 있습니다. 다른 날짜를 선택해주세요.');
      copied.period=period;delete copied.movedFrom;delete copied.moveNote;
      next.schedule[date]=[...JSON.parse(JSON.stringify(daySchedule)),copied].sort((a,b)=>a.period-b.period);
      // 원본의 완료 여부와 시수 기록은 가져오지 않습니다.
      const key=item.cls+'|'+item.subject;
      next.completion[date]={...(next.completion[date]||{}),[key]:false};
      if(next.hours[date]) {delete next.hours[date][key];if(!Object.keys(next.hours[date]).length)delete next.hours[date];}
    } else {
      copied.id=crypto.randomUUID();
      const field=kind==='event'?'events':'external';
      if(kind==='external')copied.period=period;
      const duplicates=(next[field][date]||[]).some(e=>e.title===copied.title && (kind==='event' ? !!e.noClass===!!copied.noClass : e.period===period && (e.slot||'left')===(copied.slot||'left') && JSON.stringify([...e.classes].sort())===JSON.stringify([...copied.classes].sort())));
      if(duplicates)throw Error('같은 블록이 이미 있습니다. 날짜나 교시를 변경해주세요.');
      next[field][date]=[...(next[field][date]||[]),copied];
    }
    return next;
  }
  function Dialog({react:R,request,onCopy,onClose}) {
    const [date,setDate]=R.useState(request.date),[period,setPeriod]=R.useState(request.item.period||1),[error,setError]=R.useState('');
    const ref=R.useRef(null),create=R.createElement;
    R.useEffect(()=>{const previous=document.activeElement;ref.current?.focus();return()=>previous?.isConnected&&previous.focus();},[]);
    const title=request.kind==='schedule'?request.item.cls+' '+request.item.subject:request.item.title;
    function keys(e) {
      if(e.key==='Escape'){e.preventDefault();onClose();}
      if(e.key==='Tab') {
        const items=[...e.currentTarget.querySelectorAll('input,select,button')].filter(n=>!n.disabled);
        if(e.shiftKey&&document.activeElement===items[0]){e.preventDefault();items.at(-1)?.focus();}
        else if(!e.shiftKey&&document.activeElement===items.at(-1)){e.preventDefault();items[0]?.focus();}
      }
    }
    return create('div',{className:'modalBackdrop',onMouseDown:e=>{if(e.target===e.currentTarget)onClose();}},
      create('form',{className:'moveModal copyModal',role:'dialog','aria-modal':true,'aria-label':'블록 복사',onKeyDown:keys,onSubmit:e=>{e.preventDefault();try{onCopy(date,Number(period));}catch(err){setError(err.message);}}},
        create('h2',null,'블록 복사'),create('p',null,title),
        create('p',{className:'copyHint'},'원본은 그대로 두고 선택한 날짜에 새 블록을 만듭니다.'),
        create('label',null,'복사할 날짜',create('input',{ref,type:'date',min:'2026-08-21',max:'2027-01-08',required:true,value:date,onChange:e=>{setDate(e.target.value);setError('');}})),
        request.kind!=='event'&&create('label',null,'복사할 교시',create('select',{value:period,onChange:e=>{setPeriod(Number(e.target.value));setError('');}},...[1,2,3,4,5,6].map(n=>create('option',{key:n,value:n},n+'교시')))),
        error&&create('p',{className:'copyError',role:'alert'},error),
        create('button',{type:'submit'},'이 날짜에 복사'),
        create('button',{type:'button',className:'cancelMove',onClick:onClose},'취소')));
  }
  window.MuanCopy={plan,Dialog};
})();
