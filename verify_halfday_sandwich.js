import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';
dayjs.extend(isSameOrBefore);

// Mocking the core logic from Dashboards
function calculateTimes(punchTimes) {
    if (!punchTimes || punchTimes.length === 0) return { totalHours: "0:00:00" };
    // Simplified version for test
    let totalMinutes = 0;
    for (let i = 0; i < punchTimes.length; i += 2) {
        const inTime = dayjs(`2026-01-01 ${punchTimes[i]}`);
        const outTime = dayjs(`2026-01-01 ${punchTimes[i+1]}`);
        totalMinutes += outTime.diff(inTime, 'minute');
    }
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return { totalHours: `${h}:${m.toString().padStart(2, '0')}:00` };
}

function checkFullMonth(records, holidayDates, selectedMonth, today) {
    const start = selectedMonth.startOf('month');
    const end = selectedMonth.endOf('month');
    let curr = start.clone();
    const sandwichDays = [];
    
    const isAbsentOrLeave = (checkDateStr) => {
        // 1. Is it a Holiday?
        if (holidayDates.includes(checkDateStr)) return false;

        const r = records.find(x => x.date === checkDateStr);
        if (!r) {
            const cd = dayjs(checkDateStr);
            if (cd.isSame(selectedMonth, 'month')) return cd.isSameOrBefore(today, 'day');
            return false;
        }

        // REFINED LOGIC
        let dh = 0;
        if (r.punchTimes && r.punchTimes.length > 0) {
           const { totalHours } = calculateTimes(r.punchTimes);
           const [h, m] = totalHours.split(":").map(Number);
           dh = h + m/60;
        } else if (r.hours) {
           const [h, m] = r.hours.split(":").map(Number);
           dh = h + m/60;
        }

        if (dh < 3) {
            if (r.isLeave) return true;
            return true;
        }
        return false;
    };

    while(curr.isSameOrBefore(end)) {
        const dStr = curr.format('YYYY-MM-DD');
        const isWeekend = curr.day() === 0 || curr.day() === 6;
        if (isWeekend) {
            if (isAbsentOrLeave(curr.subtract(1, 'day').format('YYYY-MM-DD')) && 
                isAbsentOrLeave(curr.add(1, 'day').format('YYYY-MM-DD'))) {
                sandwichDays.push(dStr);
            }
        }
        curr = curr.add(1, 'day');
    }
    return sandwichDays;
}

// TEST CASES
console.log("=== VERIFYING HALF-DAY SANDWICH EXCLUSION ===");

const holidayDates = [];
const selectedMonth = dayjs("2026-02-01");
const today = dayjs("2026-02-28");

// Case 1: Friday worked 4h (Half Day), Monday Leave. Sunday should NOT be sandwich.
// Feb 13 (Fri), Feb 14 (Sat), Feb 15 (Sun), Feb 16 (Mon)
const records1 = [
    { date: "2026-02-13", isLeave: true, punchTimes: ["09:00", "13:00"] }, // Friday, 4h worked, marked as leave
    { date: "2026-02-16", isLeave: true } // Mon
];

const result1Full = checkFullMonth(records1, [], selectedMonth, today);
console.log("\nScenario 1: Friday 4h worked (Marked Leave), Monday Leave");
console.log("Sandwich Days detected:", JSON.stringify(result1Full));
if (result1Full.length === 0) {
    console.log("✅ PASS: No sandwich detected for half-day.");
} else {
    console.log("❌ FAIL: Sandwich detected for half-day.");
}

// Case 2: Friday 2h worked (Late/Leave), Monday Leave. Sunday SHOULD be sandwich.
const records2 = [
    { date: "2026-02-13", isLeave: true, punchTimes: ["09:00", "11:00"] }, // Friday, 2h worked (Absent)
    { date: "2026-02-16", isLeave: true } // Mon
];
const result2Full = checkFullMonth(records2, [], selectedMonth, today);
console.log("\nScenario 2: Friday 2h worked (Marked Leave), Monday Leave");
console.log("Sandwich Days detected:", JSON.stringify(result2Full));
if (result2Full.length > 0) {
    console.log("✅ PASS: Sandwich detected as expected for short day.");
} else {
    console.log("❌ FAIL: Sandwich NOT detected for short day.");
}

// Case 3: Standard Absence (No Record) Friday, No Record Monday
const records3 = [];
const result3Full = checkFullMonth(records3, [], selectedMonth, today);
console.log("\nScenario 3: No records on Fri/Mon (Absence)");
console.log("Sandwich Days detected:", JSON.stringify(result3Full.filter(d => d === "2026-02-15" || d === "2026-02-14")));
if (result3Full.length > 0) {
    console.log("✅ PASS: Normal sandwich still works.");
} else {
    console.log("❌ FAIL: Normal sandwich failed.");
}
