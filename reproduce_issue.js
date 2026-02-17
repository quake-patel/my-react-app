import dayjs from 'dayjs';
import customParseFormat from 'dayjs/plugin/customParseFormat.js';
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore.js';

dayjs.extend(customParseFormat);
dayjs.extend(isSameOrBefore);

// --- HELPERS ---
const DEFAULT_HOLIDAYS = [
  "2025-12-25", // Christmas
  "2025-01-26", // Republic Day
  "2025-10-20", // Diwali (Example)
];

const parseTimes = (timeValue, numberOfPunches) => {
  if (!timeValue) return [];
  let times = [];
  if (Array.isArray(timeValue)) timeValue = timeValue.filter((v) => v && v.trim()).join(", ");
  if (typeof timeValue === "string") {
    times = timeValue.split(",").map((t) => t.trim()).filter((t) => t && t.match(/^\d{1,2}:\d{2}$/));
  }
  if (numberOfPunches && numberOfPunches > 0) times = times.slice(0, numberOfPunches);
  return times;
};

const calculateTimes = (times) => {
    if (!times || times.length === 0) return { inTime: null, outTime: null, totalHours: "00:00" };
    const sortedTimes = times.sort();
    const inTime = sortedTimes[0];
    const outTime = sortedTimes[sortedTimes.length - 1];
  
    let totalMinutes = 0;
    if (times.length % 2 === 0) {
      // Pairs
      for (let i = 0; i < times.length; i += 2) {
        const t1 = dayjs(times[i], "HH:mm");
        const t2 = dayjs(times[i + 1], "HH:mm");
        if (t1.isValid() && t2.isValid()) {
          totalMinutes += t2.diff(t1, "minute");
        }
      }
    } else {
      // First and Last
      const t1 = dayjs(inTime, "HH:mm");
      const t2 = dayjs(outTime, "HH:mm");
      if (t1.isValid() && t2.isValid()) {
        totalMinutes = t2.diff(t1, "minute");
      }
    }
  
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    const totalHours = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    return { inTime, outTime, totalHours };
  };

const calculateWorkingDays = (monthDayjs, holidays, joiningDate = null) => {
    if (!monthDayjs) return 0;
    const start = monthDayjs.clone().startOf("month");
    const end = monthDayjs.clone().endOf("month");

    // Adjust start date if joining date is in this month
    let actualStart = start;
    if (joiningDate) {
      const jDate = dayjs(joiningDate);
      if (jDate.isValid() && jDate.isSame(monthDayjs, "month")) {
        actualStart = jDate;
      }
    }

    let workingDays = 0;
    const holidayDates = holidays.map((h) => h.date);
    // Add defaults
    DEFAULT_HOLIDAYS.forEach((d) => {
      if (!holidayDates.includes(d)) holidayDates.push(d);
    });

    let curr = actualStart.clone();
    while (curr.isSameOrBefore(end)) {
      const day = curr.day(); // 0 = Sun, 6 = Sat
      const isWeekend = day === 0 || day === 6;
      const isHoliday = holidayDates.includes(curr.format("YYYY-MM-DD"));

      if (!isWeekend && !isHoliday) {
        workingDays++;
      }
      curr = curr.add(1, "day");
    }
    return workingDays;
  };

// --- MOCK DB STATE ---
const holidays = []; // No holidays for simplicity
const incentives = {};
const adjustments = {};
const salaries = {};


// --- MAIN LOGIC EXTRACTED ---
const getMonthlyPayroll = (
    employeeRecords,
    selectedMonth,
    empId = "EMP001",
    joiningDate = null,
  ) => {
    // RESTORED: Payroll Adjustments Reading
    const employeeId = empId;
    const monthStr = selectedMonth.format("YYYY-MM");
    const adjKey = `${employeeId}_${monthStr}`;
    const adj = adjustments[adjKey] || {
      grantedLeaves: 0,
      grantedHours: 0,
      grantedShortageDates: [],
    };

    const holidayDates = holidays.map((h) => h.date);
    DEFAULT_HOLIDAYS.forEach((d) => {
      if (!holidayDates.includes(d)) holidayDates.push(d);
    });

    const rawMonthlyRecords = employeeRecords.filter((r) => {
      if (!r.date) return false;
      const d = dayjs(r.date);
      return d.isValid() && d.isSame(selectedMonth, "month");
    });
    
    // Simplification: We assume records are unique for test
    const monthlyRecords = rawMonthlyRecords;

    let actualHours = 0;
    let eligibleHours = 0;
    let passedEligibleHours = 0;
    const pendingWeekends = [];
    const recordedDates = [];
    const shortDays = []; 
    const zeroDays = []; 

    const today = dayjs(); // Real today

    monthlyRecords.forEach((r) => {
      let dailyHours = 0;
      if (r.punchTimes && r.punchTimes.length > 0) {
        const { totalHours } = calculateTimes(r.punchTimes);
        if (totalHours) {
          const [h, m] = totalHours.split(":").map(Number);
          dailyHours = h + m / 60;
        }
      } else if (r.hours) {
        const [h, m] = r.hours.toString().split(":").map(Number);
        dailyHours = h + m / 60;
      }

      // Apply Granted Shortage (Virtual)
      const isGranted = (adj.grantedShortageDates || []).includes(r.date);
      if (isGranted && dailyHours < 8 && !r.isLeave) {
        const shortage = 8 - dailyHours;
        if (shortage > 0) dailyHours += shortage;
      }

      actualHours += dailyHours;

      const d = dayjs(r.date);
      if (d.isValid()) {
        recordedDates.push(d.format("YYYY-MM-DD"));

        const isWeekend = d.day() === 0 || d.day() === 6;

        let hoursToAdd = 0;
        if (isWeekend) {
          if (r.weekendApproved) {
            hoursToAdd = dailyHours;
          } else {
            if (!r.weekendApproved) {
              pendingWeekends.push({ ...r, dailyHours });
            }
          }
        } else {
          hoursToAdd = dailyHours;
        }

        eligibleHours += hoursToAdd;

        if (d.isSameOrBefore(today, "day")) {
          passedEligibleHours += hoursToAdd;
        }

        if (!isWeekend && !r.isLeave && dailyHours < 8) {
          const normalizedDate = d.format("YYYY-MM-DD");
          if (dailyHours < 3) {
            zeroDays.push({
              date: normalizedDate,
              dailyHours,
              shortage: 8 - dailyHours,
            });
          } else {
            shortDays.push({
              date: normalizedDate,
              dailyHours,
              shortage: 8 - dailyHours,
            });
          }
        }
      }
    });

    const missingDays = [];
    const start = selectedMonth.clone().startOf("month");
    const end = selectedMonth.clone().endOf("month");

    let actualStart = start;
    if (joiningDate) {
      const jDate = dayjs(joiningDate);
      if (jDate.isValid() && jDate.isSame(selectedMonth, "month")) {
        actualStart = jDate;
      }
    }

    let curr = actualStart.clone();
    let passedWorkingDays = 0;

    while (curr.isSameOrBefore(end)) {
      const dayStr = curr.format("YYYY-MM-DD");
      const day = curr.day();
      const isWeekend = day === 0 || day === 6;
      const isHoliday = holidayDates.includes(dayStr);
      const isFuture = curr.isAfter(today, "day");

      if (!isWeekend && !isHoliday && !isFuture) {
        passedWorkingDays++;
      }

      if (!isFuture) {
        if (!isWeekend && !isHoliday && !recordedDates.includes(dayStr)) {
          missingDays.push(dayStr);
        }
      }
      curr = curr.add(1, "day");
    }

    const workingDays = calculateWorkingDays(selectedMonth, holidays, joiningDate);
    const targetHours = workingDays * 8;
    const passedTargetHours = passedWorkingDays * 8;

    const leavesCount = monthlyRecords.filter((r) => r.isLeave).length;
    const paidLeavesCount = monthlyRecords.filter(
      (r) => r.isLeave && r.leaveType && r.leaveType.toLowerCase() === "paid",
    ).length;

    missingDays.sort();

    const monthlySalary = 30000;
    
    // --- GLOBAL HOURS BALANCING ---
    let creditBank = 0;
    monthlyRecords.forEach((r) => {
      let dailyHours = 0;
      if (r.punchTimes && r.punchTimes.length > 0) {
        const { totalHours } = calculateTimes(r.punchTimes);
        if (totalHours) {
          const [h, m] = totalHours.split(":").map(Number);
          dailyHours = h + m / 60;
        }
      } else if (r.hours) {
        const [h, m] = r.hours.toString().split(":").map(Number);
        dailyHours = h + m / 60;
      }

      const d = dayjs(r.date);
      const isWeekend = d.isValid() && (d.day() === 0 || d.day() === 6);
      const isHoliday = d.isValid() && holidayDates.includes(d.format("YYYY-MM-DD"));

      if (isWeekend || isHoliday) {
        creditBank += dailyHours;
      } else {
        if (dailyHours > 8) {
          creditBank += dailyHours - 8;
        }
      }
    });

    let earnedDays = 0;
    let presentDaysCount = 0;

    monthlyRecords.forEach((r) => {
      let dailyHours = 0;
      if (r.punchTimes && r.punchTimes.length > 0) {
        const { totalHours } = calculateTimes(r.punchTimes);
        if (totalHours) {
          const [h, m] = totalHours.split(":").map(Number);
          dailyHours = h + m / 60;
        }
      } else if (r.hours) {
        const [h, m] = r.hours.toString().split(":").map(Number);
        dailyHours = h + m / 60;
      }

      const isGranted = (adj.grantedShortageDates || []).includes(r.date);
      if (isGranted && dailyHours < 8 && !r.isLeave) {
        const shortage = 8 - dailyHours;
        if (shortage > 0) dailyHours += shortage;
      }

      const d = dayjs(r.date);
      const isWeekend = d.isValid() && (d.day() === 0 || d.day() === 6);
      const isHoliday = d.isValid() && holidayDates.includes(d.format("YYYY-MM-DD"));

      let hoursForPay = dailyHours;

      let earned = 0;

      if (isWeekend || isHoliday) {
        earned = 1;
      } else {
        if (hoursForPay >= 8) {
          earned = 1;
        } else if (hoursForPay >= 3) {
          const deficit = 8 - hoursForPay;
          if (creditBank >= deficit - 0.001) {
            earned = 1; 
            creditBank -= deficit; 
          } else {
            earned = 0.5; 
          }
        }
      }
      earnedDays += earned;

      if (isWeekend || isHoliday || hoursForPay >= 3) {
        presentDaysCount += 1;
      }
    });

    const incentiveAmount = 0;
    let effectivelyEarnedDays = earnedDays;

    const sandwichDays = [];
    let sandwichDeduction = 0;

    let sCurr = start.clone();
    // --- UPDATED LOOP LOGIC IN REPRO SCRIPT ---
    if (start.day() === 0) {
        sCurr = start.subtract(1, 'day');
    }
    // ------------------------------------------

    let unworkedWeekendCount = 0;

    const cutoffDate = dayjs();

    while (sCurr.isSameOrBefore(end)) {
      const dayStr = sCurr.format("YYYY-MM-DD");
      if (sCurr.day() === 0 || sCurr.day() === 6) {
        // Weekend
        if (!recordedDates.includes(dayStr) && sCurr.isSameOrBefore(cutoffDate, "day")) {
          // Only add to unworked count if it is IN the selected month
          if (sCurr.month() === selectedMonth.month()) {
               unworkedWeekendCount++;
          }
        }

        if (sCurr.day() === 6) {
          const saturday = sCurr;
          const sunday = sCurr.add(1, "day");

          const fridayStr = saturday.subtract(1, "day").format("YYYY-MM-DD");
          const mondayStr = saturday.add(2, "day").format("YYYY-MM-DD");


          // --- START MODIFIED LOGIC ---
          // CHECK ABSENT HELPER
          const checkAbsent = (dateStr) => {
            const d = dayjs(dateStr);
            if (!d.isValid()) return false; 

            // If in current month, stick to calculated missingDays
            if (d.month() === selectedMonth.month()) {
                return missingDays.includes(dateStr);
            }

            // Previous Month Logic
            const hasRecord = employeeRecords.some(r => {
                const rd = dayjs(r.date);
                return rd.isValid() && rd.isSame(d, 'day');
            });
            
            if (hasRecord) return false; // Present

            // 2. Is it a Weekend?
            const day = d.day();
            if (day === 0 || day === 6) return false; // Weekend (Not Absent)

            // 3. Is it a Holiday?
            if (holidayDates.includes(dateStr)) return false; // Holiday (Not Absent)

            // Default: Absent
            return true;
         };

          const isFriAbsent = checkAbsent(fridayStr);
          const isMonAbsent = checkAbsent(mondayStr);
          // --- END MODIFIED LOGIC ---

          if (isFriAbsent && isMonAbsent) {
            if (saturday.month() === selectedMonth.month()) {
              sandwichDays.push(saturday.format("YYYY-MM-DD"));
              sandwichDeduction++;
            }
            if (sunday.month() === selectedMonth.month()) {
              sandwichDays.push(sunday.format("YYYY-MM-DD"));
              sandwichDeduction++;
            }
          }
        }
      }
      sCurr = sCurr.add(1, "day");
    }

    let unworkedHolidayCount = 0;
    let hCurr = start.clone();
    while (hCurr.isSameOrBefore(end)) {
      const dayStr = hCurr.format("YYYY-MM-DD");
      const day = hCurr.day();
      const isWeekend = day === 0 || day === 6;
      if (!isWeekend && holidayDates.includes(dayStr)) {
        if (!recordedDates.includes(dayStr) && hCurr.isSameOrBefore(cutoffDate, "day")) {
          unworkedHolidayCount++;
        }
      }
      hCurr = hCurr.add(1, "day");
    }

    let daysForPay =
      effectivelyEarnedDays + unworkedWeekendCount + unworkedHolidayCount;

    daysForPay -= sandwichDeduction;
    daysForPay += paidLeavesCount;

    return {
      daysForPay,
      sandwichDeduction,
      sandwichDays,
      unworkedWeekendCount,
      effectivelyEarnedDays,
      missingDays
    };
  };

// --- RUN SCENARIO ---

const selectedMonth = dayjs("2026-02-01"); // Feb 2026
console.log("Selected Month:", selectedMonth.format("YYYY-MM"));

// Records:
// Fri 30 Jan: Present (Previous Month)
// Mon 2 Feb: Absent (Missing)
// Other days presented to simulate 12 workings days + 2 short days + 2 leaves (one being Mon 2 Feb)
// Total Work Days in Feb (20). 20 - 2 leaves = 18.
// Simulation:
// Passed Days = 12.
// Week 1 (Feb 2-6): Mon Absent. Tue-Fri (4 days).
// Week 2 (Feb 9-13): 5 days.
// Week 3 (Feb 16-17): 2 days.
// Total Working Days Passed: 11? Wait.
// Screenshot: "Passed Days 12".
// Weeks:
// Sun Feb 1.
// Mon 2 - Fri 6 (5 days).
// Mon 9 - Fri 13 (5 days).
// Mon 16 - Tue 17 (2 days).
// Total Working Days Passed = 12.
// Screenshot says "12/20". Matches perfectly with "Today is Feb 17".
// Leaves: 2.
// Assume Leaves were Mon Feb 2 and maybe Tue Feb 3?
// Or maybe Leaves were earlier?
// If Mon Feb 2 was Absent (Leave Unpaid).
// If Tue Feb 3 was Absent (Leave Unpaid).
// Then 10 days worked.
// Of these 10 days, 2 were Short Days (4 hours).
// Bank 0.

const records = [
    { date: "2026-01-30", punchTimes: ["09:00", "17:00"], employeeId: "EMP001" }, // Fri Prev Present
    // Mon Feb 2: Absent (Missing)
    // Tue Feb 3: Absent (Missing)
    // Wed Feb 4: Short Day (4 hours)
    { date: "2026-02-04", punchTimes: ["09:00", "13:00"], employeeId: "EMP001" },
    // Thu Feb 5: Short Day (4 hours)
    { date: "2026-02-05", punchTimes: ["09:00", "13:00"], employeeId: "EMP001" },
    // Fri Feb 6: Full
    { date: "2026-02-06", punchTimes: ["09:00", "17:00"], employeeId: "EMP001" },
    
    // Week 2: Mon-Fri Full
    { date: "2026-02-09", punchTimes: ["09:00", "17:00"], employeeId: "EMP001" },
    { date: "2026-02-10", punchTimes: ["09:00", "17:00"], employeeId: "EMP001" },
    { date: "2026-02-11", punchTimes: ["09:00", "17:00"], employeeId: "EMP001" },
    { date: "2026-02-12", punchTimes: ["09:00", "17:00"], employeeId: "EMP001" },
    { date: "2026-02-13", punchTimes: ["09:00", "17:00"], employeeId: "EMP001" },

    // Week 3: Mon-Tue Full
    { date: "2026-02-16", punchTimes: ["09:00", "17:00"], employeeId: "EMP001" },
    { date: "2026-02-17", punchTimes: ["09:00", "17:00"], employeeId: "EMP001" },
];

const result = getMonthlyPayroll(records, selectedMonth);

console.log("--- RESULT ---");
// Expectation:
// Worked Days: 8 Full + 2 Short = 10 days present.
// Earned Days: 8 * 1 + 2 * 0.5 = 9.
// Weekends Passed: Sun Feb 1, + Feb 7,8 + Feb 14,15 = 5 days.
// Total Earned: 9 + 5 = 14.
// Matches screenshot "14".
// Leaves: 2 (Feb 2, Feb 3).
// If user expected 15, they forgot about Short Day Penalties.

console.log("Days For Pay (Net Earned):", result.daysForPay);
console.log("Unworked Weekend Count:", result.unworkedWeekendCount);
console.log("Sandwich Deduction:", result.sandwichDeduction);
console.log("Sandwich Days:", result.sandwichDays);
