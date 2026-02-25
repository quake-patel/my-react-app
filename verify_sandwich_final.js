
import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
dayjs.extend(isSameOrBefore);

const holidayDates = ['2026-05-01']; // May 1 is a holiday

function isScheduledWorkingDay(date, holidayDates) {
    const d = dayjs(date);
    const day = d.day();
    const isWeekend = day === 0 || day === 6;
    const isHoliday = holidayDates.includes(d.format('YYYY-MM-DD'));
    return !isWeekend && !isHoliday;
}

function calculateSandwich(selectedMonth, contextRecords, holidayDates, today) {
    const start = selectedMonth.startOf('month');
    const end = selectedMonth.endOf('month');
    
    const isAbsentOrLeave = (checkDateStr) => {
        if (holidayDates.includes(checkDateStr)) return false;
        const record = contextRecords.find(r => r.date === checkDateStr);
        if (!record) return dayjs(checkDateStr).isSameOrBefore(today, 'day');
        if (record.isLeave) return true;
        
        let dailyHours = 0;
        if (record.hours) {
            const [h, m] = record.hours.split(':').map(Number);
            dailyHours = h + (m / 60);
        }
        return dailyHours < 3;
    };

    const sandwichDays = [];
    let curr = start.clone();
    
    while (curr.isSameOrBefore(end)) {
        const dayStr = curr.format('YYYY-MM-DD');
        const isWeekend = curr.day() === 0 || curr.day() === 6;
        const isHoliday = holidayDates.includes(dayStr);
        
        if (isWeekend || isHoliday) {
            let prev = curr.subtract(1, 'day');
            while (prev.isValid() && !isScheduledWorkingDay(prev.format('YYYY-MM-DD'), holidayDates)) {
                prev = prev.subtract(1, 'day');
            }
            
            let next = curr.add(1, 'day');
            while (next.isValid() && !isScheduledWorkingDay(next.format('YYYY-MM-DD'), holidayDates)) {
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



const today = dayjs('2026-06-01');

function runTests() {
    let output = "=== FINAL VERIFICATION OF ROBUST SANDWICH LOGIC ===\n";

    // Helper to generate full month of "Present" records
    const genMonth = (monthStr) => {
        const start = dayjs(monthStr).startOf('month');
        const end = dayjs(monthStr).endOf('month');
        const records = [];
        let curr = start.clone();
        while (curr.isSameOrBefore(end)) {
            if (curr.day() !== 0 && curr.day() !== 6) {
                records.push({ date: curr.format('YYYY-MM-DD'), hours: '8:00' });
            }
            curr = curr.add(1, 'day');
        }
        return records;
    };

    // Test 1: Standard Fri-Mon Sandwich
    const context1 = genMonth('2026-02-01');
    // Override Fri/Mon with Leave
    context1.find(r => r.date === '2026-02-06').isLeave = true;
    context1.find(r => r.date === '2026-02-09').isLeave = true;

    const result1 = calculateSandwich(dayjs('2026-02-01'), context1, [], today);
    output += `\nScenario: Fri/Mon Leave (Standard)\nResult: ${JSON.stringify(result1)}\n`;
    if (result1.length === 2 && result1.includes('2026-02-07') && result1.includes('2026-02-08')) {
        output += "✅ PASS\n";
    } else {
        output += "❌ FAIL\n";
    }

    // Test 2: Holiday Sandwich
    const holiday2 = ['2026-05-01']; // Friday
    const context2 = genMonth('2026-05-01');
    // Remove Fri (it's a holiday, not a scheduled work day in our test context generation)
    // Actually our genMonth adds all Mon-Fri.
    // Let's manually set up Test 2.
    const context2Fixed = [
        { date: '2026-04-29', hours: '8:00' },
        { date: '2026-04-30', isLeave: true }, // Thursday
        // May 1 (Fri) Holiday
        // May 2 (Sat), May 3 (Sun)
        { date: '2026-05-04', isLeave: true }, // Monday
        { date: '2026-05-05', hours: '8:00' }
    ];

    const result2 = calculateSandwich(dayjs('2026-05-01'), context2Fixed, holiday2, today);
    output += `\nScenario: Thu Leave + Fri Holiday + Mon Leave\nExpected: May 1, 2, 3\nResult: ${JSON.stringify(result2)}\n`;
    if (result2.length === 3 && result2.includes('2026-05-01') && result2.includes('2026-05-02') && result2.includes('2026-05-03')) {
        output += "✅ PASS\n";
    } else {
        output += "❌ FAIL\n";
    }

    // Test 3: 3-hour Threshold
    const context3 = genMonth('2026-02-01');
    context3.find(r => r.date === '2026-02-13').hours = '2:50'; // Friday
    context3.find(r => r.date === '2026-02-16').isLeave = true; // Monday

    const result3 = calculateSandwich(dayjs('2026-02-01'), context3, [], today);
    output += `\nScenario: Friday < 3h + Monday Leave\nResult: ${JSON.stringify(result3)}\n`;
    if (result3.length === 2 && result3.includes('2026-02-14') && result3.includes('2026-02-15')) {
        output += "✅ PASS\n";
    } else {
        output += "❌ FAIL\n";
    }

    // Test 4: Future Protection
    const futureToday = dayjs('2026-02-07'); // Today is Saturday
    const context4 = [
        { date: '2026-02-06', isLeave: true }, // Friday
    ];
    // Monday is missing. Since it is AFTER today (Feb 7), it should be treated as NOT ABSENT for sandwich.
    const result4 = calculateSandwich(dayjs('2026-02-01'), context4, [], futureToday);
    output += `\nScenario: Friday Leave, Saturday Today, Monday Future\nResult: ${JSON.stringify(result4)}\n`;
    if (result4.length === 0) {
        output += "✅ PASS\n";
    } else {
        output += "❌ FAIL\n";
    }

    // Test 5: Cross Month
    const context5 = [
        { date: '2026-01-30', isLeave: true }, // Friday
        { date: '2026-02-02', isLeave: true }, // Monday
    ];
    const result5Jan = calculateSandwich(dayjs('2026-01-01'), context5, [], today);
    const result5Feb = calculateSandwich(dayjs('2026-02-01'), context5, [], today);
    output += `\nScenario: Fri Jan 30 Leave + Mon Feb 2 Leave (Cross Month)\nJan: ${JSON.stringify(result5Jan)}\nFeb: ${JSON.stringify(result5Feb)}\n`;
    if (result5Jan.includes('2026-01-31') && result5Feb.includes('2026-02-01')) {
        output += "✅ PASS\n";
    } else {
        output += "❌ FAIL\n";
    }

    console.log(output);
}

runTests();
