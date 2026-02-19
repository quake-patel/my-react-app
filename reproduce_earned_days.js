
import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
dayjs.extend(isSameOrBefore);

// --- MOCK DATA ---
const selectedMonth = dayjs('2026-02-01');
const today = dayjs('2026-02-18'); // Simulate today is Feb 18
const holidayDates = []; // No holidays for baseline

// Scenario 1: Worked Mon-Fri up to Feb 18
// Feb 2026:
// 1 (Sun), 7 (Sat), 8 (Sun), 14 (Sat), 15 (Sun) are weekends.
// Worked days: 2-6 (5), 9-13 (5), 16-18 (3). Total 13 working days passed.
const workingDates = [
    '2026-02-02', '2026-02-03', '2026-02-04', '2026-02-05', '2026-02-06',
    '2026-02-09', '2026-02-10', '2026-02-11', '2026-02-12', '2026-02-13',
    '2026-02-16', '2026-02-17', '2026-02-18'
];

// MOCK RECORDS
let monthlyRecords = workingDates.map(date => ({
    date,
    punchTimes: ["09:00", "17:00"], // 8 hours
    hours: "8:00",
    isLeave: false,
    weekendApproved: false
}));

// Function to calculate days
function calculateNetEarned(records, currentDay) {
    const recordedDates = records.map(r => r.date);
    let earnedDays = 0;
    let creditBank = 0;

    records.forEach(r => {
        let dailyHours = 8; // Simplify
        const d = dayjs(r.date);
        const isWeekend = d.day() === 0 || d.day() === 6;
        const isHoliday = holidayDates.includes(r.date);

        let earned = 0;
        if (isWeekend || isHoliday) {
            earned = 1;
        } else {
            if (dailyHours >= 8) earned = 1;
            // ... omitting short day logic for simplicity as standard day is 8h
        }
        earnedDays += earned;
    });

    // Unworked Weekends
    let unworkedWeekendCount = 0;
    const start = selectedMonth.startOf('month');
    const end = selectedMonth.endOf('month');
    let sCurr = start.clone();
    
    // CUTOFF DATE SIMULATION
    // The code uses dayjs() which is "now". We simulate it with currentDay.
    const cutoffDate = currentDay; 

    while (sCurr.isSameOrBefore(end)) {
        const dayStr = sCurr.format("YYYY-MM-DD");
        if (sCurr.day() === 0 || sCurr.day() === 6) {
            if (!recordedDates.includes(dayStr) && sCurr.isSameOrBefore(cutoffDate, 'day')) {
                unworkedWeekendCount++;
            }
        }
        sCurr = sCurr.add(1, 'day');
    }

    // Unworked Holidays
    let unworkedHolidayCount = 0;
    let hCurr = start.clone();
    while (hCurr.isSameOrBefore(end)) {
        const dayStr = hCurr.format("YYYY-MM-DD");
        const day = hCurr.day();
        const isWeekend = day === 0 || day === 6;
        if (!isWeekend && holidayDates.includes(dayStr)) {
             if (!recordedDates.includes(dayStr) && hCurr.isSameOrBefore(cutoffDate, 'day')) {
                unworkedHolidayCount++;
             }
        }
        hCurr = hCurr.add(1, 'day');
    }

    let daysForPay = earnedDays + unworkedWeekendCount + unworkedHolidayCount;
    
    // Sandwich Logic (Simplified: We assume no absences for this test)
    // ...

    return {
        earnedDays,
        unworkedWeekendCount,
        unworkedHolidayCount,
        daysForPay
    };
}

// RUN SCENARIO 1
console.log("--- SCENARIO 1: Standard Work until Feb 18 ---");
console.log(calculateNetEarned(monthlyRecords, today));

// RUN SCENARIO 2: Add Future Record (Feb 20)
console.log("\n--- SCENARIO 2: With Future Record (Feb 20) ---");
const recordsWithFuture = [...monthlyRecords, {
    date: '2026-02-20',
    punchTimes: ["09:00", "17:00"],
    hours: "8:00",
    isLeave: false
}];
console.log(calculateNetEarned(recordsWithFuture, today));

