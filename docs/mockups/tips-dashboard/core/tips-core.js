/**
 * TipsCore is the dependency-free data and calculation API for the tips ledger.
 *
 * API:
 * - money(cents): format integer cents as US currency.
 * - parseMoney(str): parse a non-negative currency value into integer cents.
 * - perShare(cashCents, nPeople): calculate a rounded per-person cash share.
 * - seeded(seed): create the ledger's deterministic LCG.
 * - mkSched(spec): create a weekly lunch/dinner schedule.
 * - STAFF_SEED: the seven reference staff records and their schedules.
 * - REAL_RECORDS: the ten reference records from August 6–9, 2026.
 * - generateHistory(staff): generate deterministic history from May 1–August 5.
 * - buildRecords(staff): combine and sort generated and reference records.
 * - filterRecords(records, options): select an inclusive date range and restaurant.
 * - grouping(spanDays): select day, week, or month grouping behavior.
 * - groupRecords(records, spanDays): return grouped records and payment totals.
 * - totals(records): total cash, card, record count, and flagged count.
 * - toCSV(records): serialize records using the ledger CSV format.
 */
(function(global){
'use strict';

var DATA_START=new Date(2026,4,1);
var RESTS={sushi:'Sushi', poki:'Poki & Pho'};
var DAYKEYS=['sun','mon','tue','wed','thu','fri','sat'];
var WEEKORDER=['mon','tue','wed','thu','fri','sat','sun'];
var MONS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
var MONSFULL=['January','February','March','April','May','June','July','August','September','October','November','December'];
var DOWS=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function money(c){return '$'+(c/100).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
function parseMoney(v){var n=parseFloat(String(v).replace(/[$,\s]/g,''));return (isFinite(n)&&n>=0)?Math.round(n*100):null;}
function perShare(cashCents,nPeople){return Math.round(cashCents/nPeople);}
function sum(a,f){return a.reduce(function(t,x){return t+f(x);},0);}
function dstamp(d){return new Date(d.getFullYear(),d.getMonth(),d.getDate()).getTime();}
function fmtDay(t){var d=new Date(t);return DOWS[d.getDay()]+' '+MONS[d.getMonth()]+' '+d.getDate();}
function addDays(d,n){return new Date(d.getFullYear(),d.getMonth(),d.getDate()+n);}
function mondayOf(d){return addDays(d,-((d.getDay()+6)%7));}
function seeded(seed){var s=seed>>>0;return function(){s=(Math.imul(s,1664525)+1013904223)>>>0;return s/4294967296;};}
function q25(c){return Math.round(c/25)*25;}

function mkSched(spec){
  var s={}; WEEKORDER.forEach(function(d){s[d]={L:false,D:false};});
  spec.split(' ').forEach(function(tok){
    if(!tok)return; var d=tok.slice(0,3), ms=tok.slice(3);
    if(ms.indexOf('L')>=0)s[d].L=true; if(ms.indexOf('D')>=0)s[d].D=true;
  });
  return s;
}

var STAFF_SEED=[
 {id:'maria', name:'Maria', works:'sushi', active:true,  sched:mkSched('monL tueL thuLD friLD sunLD')},
 {id:'jose',  name:'Jose',  works:'sushi', active:true,  sched:mkSched('tueD wedD thuD friD satD sunD')},
 {id:'ken',   name:'Ken',   works:'both',  active:true,  sched:mkSched('monD wedLD thuD satD sunLD')},
 {id:'rey',   name:'Rey',   works:'both',  active:true,  sched:mkSched('monL friD satD')},
 {id:'lena',  name:'Lena',  works:'poki',  active:true,  sched:mkSched('monL wedL friL satLD sunD')},
 {id:'tom',   name:'Tom',   works:'poki',  active:true,  sched:mkSched('tueD thuD friD satD sunD')},
 {id:'aiko',  name:'Aiko',  works:'sushi', active:false, sched:mkSched('')}
];

function generateHistory(staff){
  staff=staff||STAFF_SEED;
  var rnd=seeded(20260810), out=[], id=1;
  var aikoUntil=new Date(2026,6,1).getTime();  /* Aiko left end of June */
  for(var d=new Date(DATA_START); d<=new Date(2026,7,5); d=addDays(d,1)){
    var dow=DAYKEYS[d.getDay()];
    var wk=(d.getDay()===0||d.getDay()>=5);
    ['sushi','poki'].forEach(function(rest){
      ['Lunch','Dinner'].forEach(function(meal){
        var mk=meal==='Lunch'?'L':'D';
        var pool=staff.filter(function(s){
          if(s.id==='aiko') return rest==='sushi'&&d.getTime()<aikoUntil&&mk==='D';
          return (s.works===rest||s.works==='both')&&s.sched[dow][mk];
        }).map(function(s){return s.name;});
        if(!pool.length) return;                       /* nobody scheduled → shift not recorded */
        if(meal==='Lunch'&&rnd()<0.12) return;         /* occasionally lunch goes unrecorded */
        var n=1+(rnd()<0.7?1:0)+(rnd()<0.3?1:0); if(n>pool.length)n=pool.length;
        for(var i=pool.length-1;i>0;i--){var j=Math.floor(rnd()*(i+1));var t=pool[i];pool[i]=pool[j];pool[j]=t;}
        var people=pool.slice(0,n);
        var range = rest==='sushi'
          ? (meal==='Dinner'?(wk?[25000,42000]:[18000,33000]):(wk?[7000,14000]:[6000,11000]))
          : (meal==='Dinner'?(wk?[15000,26000]:[12000,22000]):[5000,11000]);
        var cash=q25(range[0]+rnd()*(range[1]-range[0]));
        var card=q25(cash*(1.35+rnd()*0.75));
        out.push({id:'g'+(id++), t:dstamp(d), rest:rest, meal:meal, cash:cash, card:card,
                  people:people, by:people[Math.floor(rnd()*people.length)],
                  mode:rnd()<0.3?'voice':'typed', flag:false});
      });
    });
  }
  return out;
}

var REAL_RECORDS=[
 {id:'r1', t:dstamp(new Date(2026,7,9)), rest:'sushi', meal:'Dinner', cash:41200,  card:68850, people:['Maria','Jose','Ken'], by:'Maria', mode:'voice', flag:false},
 {id:'r2', t:dstamp(new Date(2026,7,9)), rest:'sushi', meal:'Lunch',  cash:9625,   card:21000, people:['Maria','Ken'],       by:'Ken',   mode:'typed', flag:false},
 {id:'r3', t:dstamp(new Date(2026,7,9)), rest:'poki',  meal:'Dinner', cash:18800,  card:40275, people:['Lena','Tom'],        by:'Lena',  mode:'typed', flag:false},
 {id:'r4', t:dstamp(new Date(2026,7,8)), rest:'sushi', meal:'Dinner', cash:36650,  card:59400, people:['Jose','Ken','Rey'],  by:'Ken',   mode:'typed', flag:false},
 {id:'r5', t:dstamp(new Date(2026,7,8)), rest:'poki',  meal:'Dinner', cash:20575,  card:38800, people:['Lena','Tom','Rey'],  by:'Rey',   mode:'voice', flag:false},
 {id:'r6', t:dstamp(new Date(2026,7,8)), rest:'poki',  meal:'Lunch',  cash:7400,   card:16525, people:['Lena'],              by:'Lena',  mode:'typed', flag:false},
 {id:'r7', t:dstamp(new Date(2026,7,7)), rest:'sushi', meal:'Dinner', cash:310000, card:61000, people:['Maria','Jose'],      by:'Jose',  mode:'voice', flag:true},
 {id:'r8', t:dstamp(new Date(2026,7,7)), rest:'sushi', meal:'Lunch',  cash:8850,   card:17400, people:['Maria'],             by:'Maria', mode:'typed', flag:false},
 {id:'r9', t:dstamp(new Date(2026,7,7)), rest:'poki',  meal:'Dinner', cash:19725,  card:35150, people:['Tom','Rey'],         by:'Tom',   mode:'typed', flag:false},
 {id:'r10',t:dstamp(new Date(2026,7,6)), rest:'sushi', meal:'Dinner', cash:34400,  card:56125, people:['Maria','Jose','Ken'],by:'Maria', mode:'typed', flag:false}
];

function buildRecords(staff){
  var records=generateHistory(staff||STAFF_SEED).concat(REAL_RECORDS);
  records.sort(function(a,b){
    if(a.t!==b.t)return b.t-a.t;
    if(a.rest!==b.rest)return a.rest==='sushi'?-1:1;
    return a.meal==='Dinner'?-1:1;
  });
  return records;
}

function filterRecords(records,options){
  var startT=options.startT, endT=options.endT, rest=options.rest;
  return records.filter(function(r){
    if(r.t<startT||r.t>endT)return false;
    if(rest!=='all'&&r.rest!==rest)return false;
    return true;
  });
}

function grouping(spanDays){
  if(spanDays<=16) return {mode:'day', key:function(r){return r.t;}, label:function(k){return fmtDay(k)+' — day total';}};
  if(spanDays<=100) return {mode:'week', key:function(r){return mondayOf(new Date(r.t)).getTime();},
    label:function(k){var m=new Date(k),e=addDays(m,6);return 'Week of '+MONS[m.getMonth()]+' '+m.getDate()+' – '+(e.getMonth()===m.getMonth()?'':MONS[e.getMonth()]+' ')+e.getDate()+' — total';}};
  return {mode:'month', key:function(r){var d=new Date(r.t);return new Date(d.getFullYear(),d.getMonth(),1).getTime();},
    label:function(k){var d=new Date(k);return MONSFULL[d.getMonth()]+' '+d.getFullYear()+' — total';}};
}

function groupRecords(records,spanDays){
  var behavior=grouping(spanDays), groups=[];
  records.forEach(function(r){
    var key=behavior.key(r), group=null;
    for(var i=0;i<groups.length;i++)if(groups[i].key===key){group=groups[i];break;}
    if(!group){
      group={key:key,label:behavior.label(key),records:[],cashTotal:0,cardTotal:0};
      groups.push(group);
    }
    group.records.push(r);
    group.cashTotal+=r.cash;
    group.cardTotal+=r.card;
  });
  return groups;
}

function totals(records){
  return {
    cash:sum(records,function(r){return r.cash;}),
    card:sum(records,function(r){return r.card;}),
    count:records.length,
    flagged:records.filter(function(r){return r.flag;}).length
  };
}

function csvField(v){v=String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;}
function toCSV(records){
  var rows=['Business date,Restaurant,Meal,Cash (split pool),Card (logged only),People on split,Names,Per-person share,Flagged,Entered by,Entry method'];
  records.forEach(function(r){
    rows.push([fmtDay(r.t)+' '+new Date(r.t).getFullYear(),RESTS[r.rest],r.meal,(r.cash/100).toFixed(2),(r.card/100).toFixed(2),r.people.length,'"'+r.people.join('; ').replace(/"/g,'""')+'"',(perShare(r.cash,r.people.length)/100).toFixed(2),r.flag?'yes':'no',csvField(r.by),r.mode].join(','));
  });
  return rows.join('\n');
}

var api={
  money:money,
  parseMoney:parseMoney,
  perShare:perShare,
  seeded:seeded,
  mkSched:mkSched,
  STAFF_SEED:STAFF_SEED,
  REAL_RECORDS:REAL_RECORDS,
  generateHistory:generateHistory,
  buildRecords:buildRecords,
  filterRecords:filterRecords,
  grouping:grouping,
  groupRecords:groupRecords,
  totals:totals,
  toCSV:toCSV
};

global.TipsCore=api;
if(typeof module!=='undefined')module.exports=api;
})(globalThis);
