const dayjs = require('dayjs');

// replicate credit calculation
function compute(records) {
    const SHORT_DAY_TOLERANCE = 15/60;
    let creditBank = 0;
    const dateCredits = {};
    // first pass bank surpluses
    records.forEach(r => {
        const h = parseInt(r.hours.split(":")[0]);
        const m = parseInt(r.hours.split(":")[1]);
        const dailyHours = h + m/60;
        const d = dayjs(r.date);
        const isWeekend = d.day()===0||d.day()===6;
        const isHoliday = false;
        if (isWeekend || isHoliday) {
            creditBank += dailyHours;
        } else {
            if (dailyHours >= 8 - SHORT_DAY_TOLERANCE) {
                if (dailyHours > 8) creditBank += dailyHours - 8;
            } else if (dailyHours >=3) {
                // no surplus
            } else if (dailyHours>0) {
                creditBank += dailyHours;
            }
        }
    });
    // second pass: assign earned and deduct
    let earnedDays=0, presentDays=0;
    records.forEach(r=>{
        const h = parseInt(r.hours.split(":")[0]);
        const m = parseInt(r.hours.split(":")[1]);
        const dailyHours = h + m/60;
        const d = dayjs(r.date);
        const isWeekend = d.day()===0||d.day()===6;
        const isHoliday = false;
        let earned=0;
        if(isWeekend||isHoliday) earned=1;
        else{
            if(dailyHours>=8-SHORT_DAY_TOLERANCE) earned=1;
            else if(dailyHours>=3){
                const deficit=8-dailyHours;
                if(creditBank>=deficit-0.001){earned=1;creditBank-=deficit;}else earned=0.5;
            }
        }
        dateCredits[d.format('YYYY-MM-DD')]=earned;
        if(isWeekend||isHoliday||dailyHours>=3) presentDays+=1;
        earnedDays+=earned;
    });
    // retro boosting
    if(creditBank>0){
        const shorts=Object.keys(dateCredits).filter(d=>dateCredits[d]===0.5).sort();
        for(const date of shorts){
            if(creditBank<=0) break;
            const rec=records.find(r=>dayjs(r.date).format('YYYY-MM-DD')===date);
            const h=parseInt(rec.hours.split(":")[0]) + parseInt(rec.hours.split(":")[1])/60;
            const deficit=8-h;
            if(deficit>0 && creditBank>=deficit-0.001){
                dateCredits[date]=1;
                creditBank-=deficit;
                earnedDays+=0.5; presentDays+=0.5;
            }
        }
    }
    return {creditBank, dateCredits, earnedDays, presentDays};
}

const recs = [
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
console.log(compute(recs));
