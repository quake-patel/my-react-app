import dayjs from 'dayjs';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';

dayjs.extend(isSameOrBefore);

// --- MOCK DATA ---
// Start with empty records to simulate Absences
const contextRecords = []; 
const holidayDates = []; // No holidays

// --- LOGIC TO TEST (Copied/Adapted from Dashboard Logic) ---
function getSandwichDeduction(selectedMonth, contextRecords, holidayDates) {
    const start = selectedMonth.startOf('month');
    const end = selectedMonth.endOf('month');
    const sandwichDays = [];
    let sandwichDeduction = 0;

    // Helper: Check if Absent (Leave or Missing) using Context
    const isAbsentOrLeave = (checkDateStr) => {
        // 1. Is it a Holiday?
        if (holidayDates.includes(checkDateStr)) return false;

        // 2. Check in Context Records
        const record = contextRecords.find(r => r.date === checkDateStr); 

        if (!record) return true; // Missing -> Absent (if not filtered by upload)
        if (record.isLeave) return true; // Explicit Leave -> Absent
        
        return false;
    };

    // Iterate through weekends in the month
    let sCurr = start.clone();
    
    while (sCurr.isSameOrBefore(end)) {
      const dayStr = sCurr.format("YYYY-MM-DD");
      if (sCurr.day() === 0 || sCurr.day() === 6) { // Weekend
        
        // CHECK SANDWICH (Per Day Check)
        let friday, monday;
        if (sCurr.day() === 6) { // Saturday
             friday = sCurr.subtract(1, 'day');
             monday = sCurr.add(2, 'day');
        } else { // Sunday
             friday = sCurr.subtract(2, 'day');
             monday = sCurr.add(1, 'day');
        }
        
        const fridayStr = friday.format("YYYY-MM-DD");
        const mondayStr = monday.format("YYYY-MM-DD");

        // Logic check
        const isFriAbsent = isAbsentOrLeave(fridayStr);
        const isMonAbsent = isAbsentOrLeave(mondayStr);

        // Debug Log
        // console.log(`Checking ${dayStr} (${sCurr.format('ddd')}): Fri ${fridayStr} (${isFriAbsent?'ABS':'PRE'}), Mon ${mondayStr} (${isMonAbsent?'ABS':'PRE'})`);

        if (isFriAbsent && isMonAbsent) {
             sandwichDays.push(dayStr);
             sandwichDeduction++;
        }
      }
      sCurr = sCurr.add(1, "day");
    }
    
    return { sandwichDays, sandwichDeduction };
}

// --- TEST EXECUTION ---

console.log("=== VERIFYING SANDWICH LOGIC (Cross-Month) ===");

// Test 1: January 2026
// Context: Jan 30 (Fri) is Absent (Empty Records), Feb 2 (Mon) is Absent (Empty Records)
// Target Weekend: Jan 31 (Sat)
const jan2026 = dayjs('2026-01-01');
const janResult = getSandwichDeduction(jan2026, contextRecords, holidayDates);

console.log("\n--- Test Case 1: Jan 2026 Report ---");
console.log("Scenario: Absent Jan 30 (Fri) & Feb 2 (Mon)");
console.log("Expected: Jan 31 (Sat) should be marked as Sandwich.");
console.log("Result Sandwich Days:", janResult.sandwichDays);

if (janResult.sandwichDays.includes("2026-01-31")) {
    console.log("✅ PASS: Jan 31 deducted correctly.");
} else {
    console.error("❌ FAIL: Jan 31 NOT deducted.");
}


// Test 2: February 2026
// Context: Jan 30 (Fri) is Absent, Feb 2 (Mon) is Absent
// Target Weekend: Feb 1 (Sun)
const feb2026 = dayjs('2026-02-01');
const febResult = getSandwichDeduction(feb2026, contextRecords, holidayDates);

console.log("\n--- Test Case 2: Feb 2026 Report ---");
console.log("Scenario: Absent Jan 30 (Fri) & Feb 2 (Mon)");
console.log("Expected: Feb 1 (Sun) should be marked as Sandwich.");
console.log("Result Sandwich Days:", febResult.sandwichDays);

if (febResult.sandwichDays.includes("2026-02-01")) {
    console.log("✅ PASS: Feb 1 deducted correctly.");
} else {
    console.error("❌ FAIL: Feb 1 NOT deducted.");
}
