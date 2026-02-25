
import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
dayjs.extend(isSameOrBefore);

const holidayDates = ['2026-05-01']; // Example May Day holiday

// Helper to check if a day is a "scheduled working day"
function isScheduledWorkingDay(date) {
    const d = dayjs(date);
    const day = d.day();
    const isWeekend = day === 0 || day === 6;
    const isHoliday = holidayDates.includes(d.format('YYYY-MM-DD'));
    return !isWeekend && !isHoliday;
}

function getDailyHours(record) {
    if (!record) return 0;
    if (record.hours) {
        const [h, m] = record.hours.split(':').map(Number);
        return h + (m / 60);
    }
    return 0;
}

function calculateSandwich(selectedMonth, contextRecords) {
    const start = selectedMonth.startOf('month');
    const end = selectedMonth.endOf('month');
    
    const isAbsentOrLeave = (dateStr) => {
        const record = contextRecords.find(r => r.date === dateStr);
        if (!record) return true; // Missing -> Absent
        if (record.isLeave) return true; // Explicit Leave
        if (getDailyHours(record) < 3) return true; // < 3h Rule
        return false;
    };

    const sandwichDays = [];
    let curr = start.clone();
    
    while (curr.isSameOrBefore(end)) {
        const dayStr = curr.format('YYYY-MM-DD');
        const isWeekend = curr.day() === 0 || curr.day() === 6;
        const isHoliday = holidayDates.includes(dayStr);
        
        if (isWeekend || isHoliday) {
            // Find nearest scheduled working day before
            let prev = curr.subtract(1, 'day');
            while (prev.isValid() && !isScheduledWorkingDay(prev)) {
                prev = prev.subtract(1, 'day');
            }
            
            // Find nearest scheduled working day after
            let next = curr.add(1, 'day');
            while (next.isValid() && !isScheduledWorkingDay(next)) {
                next = next.add(1, 'day');
            }
            
            if (isAbsentOrLeave(prev.format('YYYY-MM-DD')) && isAbsentOrLeave(next.format('YYYY-MM-DD'))) {
                sandwichDays.push(dayStr);
            }
        }
        curr = curr.add(1, 'day');
    }
    
    return sandwichDays;
}

// TEST CASES

const context1 = [
    { date: '2026-01-30', isLeave: true }, // Friday
    // 31 Sat, 1 Sun
    { date: '2026-02-02', isLeave: true }, // Monday
];
const result1 = calculateSandwich(dayjs('2026-01-01'), context1);
console.log("Test 1 (Fri/Mon Leave):", result1); 

const context2 = [
    { date: '2026-05-21', hours: '2:30' }, // Thursday (Short < 3h)
    { date: '2026-05-22', isLeave: true }, // Friday (Leave)
    // 23 Sat, 24 Sun
    { date: '2026-05-25', hours: '4:00' }, // Monday (Present > 3h)
];
const result2 = calculateSandwich(dayjs('2026-05-01'), context2);
console.log("Test 2 (Thu/Fri leave, Mon present):", result2); // Sat/Sun should NOT be sandwich

const context3 = [
    { date: '2026-04-30', isLeave: true }, // Thursday
    // May 1 (Fri) is Holiday
    // May 2 Sat, May 3 Sun
    { date: '2026-05-04', isLeave: true }, // Monday
];
const result3 = calculateSandwich(dayjs('2026-05-01'), context3);
console.log("Test 3 (Thu leave, Fri holiday, Mon leave):", result3); 
// Fri 1, Sat 2, Sun 3 should all be sandwich for May?
// Wait, result3 will only show May days. Fri 1, Sat 2, Sun 3.

const context4 = [
    { date: '2026-02-27', hours: '1:00' }, // Friday (Short < 3h)
    // 28 Sat, 1 Sun
    { date: '2026-03-02', isLeave: true }, // Monday
];
const result4Feb = calculateSandwich(dayjs('2026-02-01'), context4);
const result4Mar = calculateSandwich(dayjs('2026-03-01'), context4);
console.log("Test 4 (Cross month): Feb:", result4Feb, "Mar:", result4Mar);
