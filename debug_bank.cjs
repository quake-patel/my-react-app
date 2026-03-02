const dayjs=require('dayjs');
const records=[
 {date:'2026-02-02',hours:'0:00'},
 {date:'2026-02-03',hours:'8:22'},
 {date:'2026-02-04',hours:'7:37'},
 {date:'2026-02-05',hours:'7:31'},
 {date:'2026-02-06',hours:'7:51'},
 {date:'2026-02-09',hours:'7:56'},
 {date:'2026-02-10',hours:'7:39'},
 {date:'2026-02-11',hours:'8:16'},
 {date:'2026-02-12',hours:'3:28'},
 {date:'2026-02-13',hours:'8:34'},
 {date:'2026-02-16',hours:'7:53'},
 {date:'2026-02-17',hours:'8:25'},
 {date:'2026-02-18',hours:'8:14'},
 {date:'2026-02-19',hours:'7:31'},
 {date:'2026-02-20',hours:'7:13'},
 {date:'2026-02-23',hours:'8:00'},
 {date:'2026-02-24',hours:'8:00'},
 {date:'2026-02-25',hours:'7:29'},
 {date:'2026-02-26',hours:'7:55'},
 {date:'2026-02-27',hours:'8:05'}
];

const SHORT_DAY_TOLERANCE=15/60;
let creditBank=0;
records.forEach(r=>{
  const [h,m]=r.hours.split(':').map(Number);
  const dh=h+m/60;
  const d=dayjs(r.date);
  const isWeekend=d.day()===0||d.day()===6;
  if(isWeekend) creditBank+=dh;
  else{
    if(dh>=8-SHORT_DAY_TOLERANCE){if(dh>8) creditBank+=dh-8;}
    else if(dh<3 && dh>0) creditBank+=dh;
  }
});
console.log('initial bank',creditBank);
let dateCredits={};
let earnedDays=0, presentDays=0;
records.forEach(r=>{
  const [h,m]=r.hours.split(':').map(Number);
  const dh=h+m/60;
  const d=dayjs(r.date);
  const isWeekend=d.day()===0||d.day()===6;
  let earned=0;
  if(isWeekend) earned=1;
  else{
    if(dh>=8-SHORT_DAY_TOLERANCE) earned=1;
    else if(dh>=3){
      earned=0.5; // baseline, boost later
    }
  }
  dateCredits[d.format('YYYY-MM-DD')]=earned;
  if(isWeekend||dh>=3) presentDays+=1;
  earnedDays+=earned;
});
console.log('bank after second pass ',creditBank);
console.log(dateCredits);

// retro boosting
if(creditBank>0){
  const shortList=Object.keys(dateCredits).filter(d=>dateCredits[d]===0.5).map(date=>{
    const rec=records.find(r=>dayjs(r.date).format('YYYY-MM-DD')===date);
    const [h,m]=rec.hours.split(':').map(Number);
    const dh=h+m/60;
    return {date,deficit:8-dh};
  }).sort((a,b)=>a.deficit-b.deficit);
  console.log('shortList',shortList);
  for(const {date,deficit} of shortList){
    console.log('consider',date,'def',deficit,'bank',creditBank);
    if(creditBank>0 && creditBank>=deficit-0.001){
      dateCredits[date]=1;creditBank-=deficit;earnedDays+=0.5;presentDays+=0.5;
      console.log('retro boosted',date,'new bank',creditBank);
    }
  }
}
console.log('final',dateCredits,earnedDays,presentDays,creditBank);
