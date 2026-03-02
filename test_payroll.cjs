const dayjs = require('dayjs');

// use minimal calculateTimes: hours difference between punches
function calculateTimes(times) {
    if (!times || times.length === 0) return { totalHours: null };
    // assume times like "09:00" strings alternating in/out
    let total = 0;
    for (let i = 0; i+1 < times.length; i+=2) {
        const [h1,m1] = times[i].split(':').map(Number);
        const [h2,m2] = times[i+1].split(':').map(Number);
        total += (h2 + m2/60) - (h1 + m1/60);
    }
    const h = Math.floor(total);
    const m = Math.round((total - h)*60);
    return { totalHours: `${h}:${m}` };
}

function getMonthlyPayroll(records, selectedMonth) {
    const holidayDates = [];
    const DEFAULT_HOLIDAYS = [];
    const adj = {};
    // sort and dedupe
    const unique = new Map();
    records.forEach(r=>unique.set(r.date,r));
    let monthlyRecords = Array.from(unique.values());
    monthlyRecords.sort((a,b)=>dayjs(a.date).valueOf()-dayjs(b.date).valueOf());

    let earnedDays=0, presentDaysCount=0;
    let creditBank=0;
    const SHORT_DAY_TOLERANCE = 15/60;
    const dateCredits = {};

    // first pass to compute bank and initial credits
    monthlyRecords.forEach(r=>{
        let dailyHours = r.hours ? parseInt(r.hours.split(':')[0]) + parseInt(r.hours.split(':')[1])/60 : 0;
        const d = dayjs(r.date);
        const isWeekend = d.day()===0||d.day()===6;
        const isHoliday = holidayDates.includes(r.date);
        if (isWeekend || isHoliday) {
            creditBank += dailyHours;
        } else {
            if (dailyHours >= 8-SHORT_DAY_TOLERANCE) {
                if (dailyHours>8) creditBank += dailyHours-8;
            } else if (dailyHours>=3) {
                // no bank
            } else if (dailyHours>0) {
                creditBank += dailyHours;
            }
        }
    });
    // second pass for earning
    monthlyRecords.forEach(r=>{
        let dailyHours = r.hours ? parseInt(r.hours.split(':')[0]) + parseInt(r.hours.split(':')[1])/60 : 0;
        const d=dayjs(r.date);
        const isWeekend = d.day()===0||d.day()===6;
        const isHoliday = holidayDates.includes(r.date);
        let earned=0;
        if(isWeekend||isHoliday) earned=1;
        else {
            if(dailyHours>=8-SHORT_DAY_TOLERANCE) earned=1;
            else if(dailyHours>=3){
                const deficit=8-dailyHours;
                if(creditBank>=deficit-0.001){earned=1;creditBank-=deficit;}else earned=0.5;
            }
        }
        dateCredits[d.format('YYYY-MM-DD')] = earned;
        if(isWeekend||isHoliday||dailyHours>=3) presentDaysCount+=1;
        earnedDays+=earned;
    });
    // retro
    if(creditBank>0){
        const shortDates=Object.keys(dateCredits).filter(d=>dateCredits[d]===0.5).sort();
        for(const date of shortDates){
            if(creditBank<=0) break;
            const rec=monthlyRecords.find(r=>dayjs(r.date).format('YYYY-MM-DD')===date);
            let dh=rec.hours?parseInt(rec.hours.split(':')[0])+parseInt(rec.hours.split(':')[1])/60:0;
            const deficit=8-dh;
            if(deficit>0 && creditBank>=deficit-0.001){
                dateCredits[date]=1;creditBank-=deficit;earnedDays+=0.5;presentDaysCount+=0.5;
            }
        }
    }
    return { dateCredits, earnedDays, presentDaysCount, creditBank };
}

// Test scenarios
const recs=[
    {date:'2026-03-01',hours:'4:00'},
    {date:'2026-03-02',hours:'12:00'}
];
console.log(getMonthlyPayroll(recs));

const recs2=[
    {date:'2026-03-01',hours:'2:00'},
    {date:'2026-03-02',hours:'12:00'}
];
console.log(getMonthlyPayroll(recs2));

const recs3=[
    {date:'2026-03-01',hours:'4:00'},
    {date:'2026-03-02',hours:'6:00'},
    {date:'2026-03-03',hours:'10:00'}
];
console.log(getMonthlyPayroll(recs3));
