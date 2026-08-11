'use strict';

var assert=require('node:assert/strict');
var fs=require('node:fs');
var path=require('node:path');
var vm=require('node:vm');
var corePath=path.join(__dirname,'tips-core.js');
var TipsCore=require(corePath);
var passCount=0;

function check(actual,expected,message){
  assert.deepStrictEqual(actual,expected,message);
  passCount++;
}

var expectedShares={
  r1:13733,
  r2:4813,
  r3:9400,
  r4:12217,
  r5:6858,
  r6:7400,
  r7:155000,
  r8:8850,
  r9:9863,
  r10:11467
};

TipsCore.REAL_RECORDS.forEach(function(record){
  check(
    TipsCore.perShare(record.cash,record.people.length),
    expectedShares[record.id],
    'per-person share for '+record.id
  );
});
check(TipsCore.perShare(9625,2),4813,'9625 cents split two ways rounds half a cent up');
check(TipsCore.perShare(19725,2),9863,'19725 cents split two ways rounds half a cent up');

var records=TipsCore.buildRecords();
var aug3To9=TipsCore.filterRecords(records,{
  startT:new Date(2026,7,3).getTime(),
  endT:new Date(2026,7,9).getTime(),
  rest:'all'
});
check(TipsCore.totals(aug3To9),{cash:677325,card:694225,count:20,flagged:1},'August 3–9 pinned totals');

var july=TipsCore.filterRecords(records,{
  startT:new Date(2026,6,1).getTime(),
  endT:new Date(2026,6,31).getTime(),
  rest:'all'
});
check(TipsCore.totals(july),{cash:1887925,card:3199775,count:108,flagged:0},'July pinned totals');

check(TipsCore.buildRecords(),TipsCore.buildRecords(),'independent builds are deterministic');

check(TipsCore.grouping(16).mode,'day','16 days groups by day');
check(TipsCore.grouping(17).mode,'week','17 days groups by week');
check(TipsCore.grouping(100).mode,'week','100 days groups by week');
check(TipsCore.grouping(101).mode,'month','101 days groups by month');

var dayGroups=TipsCore.groupRecords([TipsCore.REAL_RECORDS[0]],16);
check(dayGroups[0].label,'Sun Aug 9 — day total','day group label');
check(
  TipsCore.groupRecords([{t:new Date(2026,6,22).getTime(),cash:100,card:200}],17)[0].label,
  'Week of Jul 20 – 26 — total',
  'week group label'
);
var monthGroup=TipsCore.groupRecords([{t:new Date(2026,6,22).getTime(),cash:100,card:200}],101)[0];
check(monthGroup.label,'July 2026 — total','month group label');
check(
  {cashTotal:monthGroup.cashTotal,cardTotal:monthGroup.cardTotal,records:monthGroup.records.length},
  {cashTotal:100,cardTotal:200,records:1},
  'group objects carry records and totals'
);

var csv=TipsCore.toCSV(TipsCore.REAL_RECORDS);
var csvLines=csv.split('\n');
check(
  csvLines[0],
  'Business date,Restaurant,Meal,Cash (split pool),Card (logged only),People on split,Names,Per-person share,Flagged,Entered by,Entry method',
  'CSV header'
);
check(csvLines.length,TipsCore.REAL_RECORDS.length+1,'CSV row count');
check(
  csvLines[1],
  'Sun Aug 9 2026,Sushi,Dinner,412.00,688.50,3,"Maria; Jose; Ken",137.33,no,Maria,voice',
  'known real CSV row'
);

check(TipsCore.money(123456),'$1,234.56','format money with thousands separator');
check(TipsCore.money(7400),'$74.00','format money pads cents');
check(
  TipsCore.toCSV([{t:new Date(2025,0,15).getTime(),rest:'sushi',meal:'Lunch',cash:200,card:0,people:['O"Brien'],by:'Smith, John',mode:'typed',flag:false}]).split('\n')[1],
  'Wed Jan 15 2025,Sushi,Lunch,2.00,0.00,1,"O""Brien",2.00,no,"Smith, John",typed',
  'CSV derives year from record and escapes quotes/commas'
);

check(TipsCore.parseMoney('$1,234.56'),123456,'parse formatted money');
check(TipsCore.parseMoney('12'),1200,'parse whole dollars');
check(TipsCore.parseMoney('-5'),null,'reject negative money');
check(TipsCore.parseMoney('abc'),null,'reject non-numeric money');

var source=fs.readFileSync(corePath,'utf8');
['document','window.','import ','export ','Date.now','Math.random'].forEach(function(forbidden){
  check(source.includes(forbidden),false,'source excludes '+forbidden);
});

var browserContext={};
vm.runInNewContext(source,browserContext,{filename:'tips-core.js'});
check(typeof browserContext.TipsCore,'object','source runs as an inline browser script');
check(typeof TipsCore.buildRecords,'function','source loads through require');

console.log('PASS '+passCount+' checks');
