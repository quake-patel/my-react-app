import React, { useState, useEffect } from "react";
import {
  Table,
  Empty,
  Button,
  Upload, // Added Upload
  Modal,
  Form,
  Input,
  message,
  ConfigProvider,
  Switch,
  theme,
  DatePicker,
  Row,
  Col,
  Statistic,
  Tag,
  Tooltip,
  Grid,
  List // Added List
} from "antd";
import {
  ReloadOutlined,
  LogoutOutlined,
  EditOutlined,
  BulbOutlined,
  UploadOutlined,
  ClockCircleOutlined,
  PlusOutlined,
  MessageOutlined,
  DollarOutlined
} from "@ant-design/icons";
import { db, auth } from "../firebase";
import ChatDrawer from "../components/ChatDrawer";
import {
  getDocs,
  getDoc,
  doc,
  query,
  where,
  addDoc,
  collection,
  updateDoc,
  setDoc
} from "firebase/firestore";


import Papa from "papaparse"; // Added Papa
import { signOut, onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";

import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
dayjs.extend(customParseFormat);
dayjs.extend(isSameOrBefore);

const { darkAlgorithm, defaultAlgorithm } = theme;

// 🎯 DARK MODE COLORS (PURE BLACK)
const DARK_BG = "#000000";
const DARK_CARD = "#141414";

// Default Holidays (can be overridden by DB)
const DEFAULT_HOLIDAYS = [
  "2025-12-25", // Christmas
  "2025-01-26", // Republic Day
  "2025-10-20", // Diwali (Example)
];

const normalize = (v) => (typeof v === "string" ? v.trim() : "");

const getField = (row, variants = []) => {
  for (const v of variants) {
    if (row[v] !== undefined && row[v] !== null && row[v] !== "") return normalize(row[v]);
  }
  const rowKeys = Object.keys(row);
  for (const variant of variants) {
    const lowerVariant = variant.toLowerCase().trim();
    for (const key of rowKeys) {
      if (key.toLowerCase().trim() === lowerVariant) {
        const value = row[key];
        if (value !== undefined && value !== null && value !== "") return normalize(value);
      }
    }
  }
  return "";
};

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
  if (!Array.isArray(times) || times.length < 2) {
    return { inTime: "", outTime: "", totalHours: "0:00" };
  }

  // Clean only — DO NOT sort
  const cleanTimes = times.filter(
    t => typeof t === "string" && /^\d{1,2}:\d{2}$/.test(t)
  );

  if (cleanTimes.length < 2) {
    return { inTime: "", outTime: "", totalHours: "0:00" };
  }

  let totalMinutes = 0;

  // Sum IN → OUT pairs (Admin Logic Match)
  for (let i = 0; i < cleanTimes.length - 1; i += 2) {
    const [inH, inM] = cleanTimes[i].split(":").map(Number);
    const [outH, outM] = cleanTimes[i + 1].split(":").map(Number);

    const inMinutes = inH * 60 + inM;
    const outMinutes = outH * 60 + outM;

    if (outMinutes > inMinutes) {
      totalMinutes += outMinutes - inMinutes;
    }
  }

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return {
    inTime: cleanTimes[0],
    outTime: cleanTimes[cleanTimes.length - 1],
    totalHours: `${hours}:${String(minutes).padStart(2, "0")}`
  };
};


export default function EmployeeDashboard() {
  const [records, setRecords] = useState([]);

  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [currentRecord, setCurrentRecord] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  
  // Highlight Comment State
  const [highlightModalOpen, setHighlightModalOpen] = useState(false);
  const [highlightTime, setHighlightTime] = useState(null);
  const [highlightRecord, setHighlightRecord] = useState(null);
  const [highlightComment, setHighlightComment] = useState("");
  const [selectedMonth, setSelectedMonth] = useState(dayjs());
  const [chatOpen, setChatOpen] = useState(false);
  const [holidays, setHolidays] = useState([]);
  const [holidayModalOpen, setHolidayModalOpen] = useState(false); // Added State
  const [adjustments, setAdjustments] = useState({}); // Stores adjustments for current month
  const [incentives, setIncentives] = useState([]); // Added Incentives State
  const [employeeId, setEmployeeId] = useState(null);

  /* ================= INCENTIVES ================= */
  const fetchIncentives = async () => {
    if (!employeeId) return;
    try {
        const q = query(collection(db, "Incentives"), where("employeeId", "==", employeeId));
        const snap = await getDocs(q);
        const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
        setIncentives(data);
    } catch (e) {
        console.error("Failed to fetch incentives", e);
    }
  };

  useEffect(() => {
      if (employeeId) fetchIncentives();
  }, [employeeId]); // Trigger when ID is ready

  const [form] = Form.useForm();
  const [uploading, setUploading] = useState(false);
  const navigate = useNavigate();

  // ... (handleFileUpload omitted for brevity - no changes) ...

  const handleFileUpload = (file) => {
    // ... existing implementation ...
     setUploading(true);
     Papa.parse(file, {
       header: true,
       skipEmptyLines: true,
       transformHeader: (h) => h.trim(),
       complete: async (results) => {
         let successCount = 0;
         for (let i = 0; i < results.data.length; i++) {
           const row = results.data[i];
           const employeeId = getField(row, ["Employee", "Employee ID"]);
           const firstName = getField(row, ["First Name", "FirstName"]);
           const department = getField(row, ["Department", "Dept"]);
           
           let date = getField(row, ["Date"]);
           // Normalize Date for ID consistency (Admin Logic - Updated)
         // Fix: Strictly Prioritize DD-MM-YYYY as per user request
         const formats = [
             "DD-MM-YYYY",
             "D-M-YYYY", 
             "DD/MM/YYYY",
             "D/M/YYYY",
             "YYYY-MM-DD",
             "MM-DD-YYYY",
             "MM/DD/YYYY"
         ];
         let d = dayjs(date, formats, true); // Strict Mode
         if (!d.isValid()) {
             d = dayjs(date, formats, false);
         }  
           
           if (d.isValid()) {
               date = d.format("YYYY-MM-DD");
           }
 
           if (!employeeId || !date) continue; // Skip incomplete rows
 
           const numberOfPunchesStr = getField(row, ["No. of Punches"]);
           const numberOfPunches = numberOfPunchesStr ? parseInt(numberOfPunchesStr, 10) : 0;
           const timeValue = getField(row, ["Time", "Times"]);
           const punchTimes = parseTimes(timeValue, numberOfPunches);
           const { inTime, outTime, totalHours } = calculateTimes(punchTimes);
           
           // Unique ID for idempotency - SANITIZED
           const safeEmpId = (employeeId || "").replace(/[^a-zA-Z0-9]/g, "_");
           const safeDate = (date || "").replace(/[^a-zA-Z0-9-]/g, "_");
           const uniqueId = `${safeEmpId}_${safeDate}`;
 
           const docData = {
             employeeId: employeeId || "",
             firstName: firstName || "",
             email: firstName ? `${firstName.toLowerCase()}@theawakens.com` : "",
             employee: firstName ? `${firstName} (${employeeId || "N/A"})` : employeeId || "Unknown",
             department: department || "",
             date: date || "",
             numberOfPunches: punchTimes.length,
             punchTimes,
             inTime,
             outTime,
             hours: totalHours,
             uploadedAt: new Date().toISOString(),
           };
 
           try {
             // Use setDoc to overwrite/merge (Same as Admin)
             await setDoc(doc(db, "punches", uniqueId), docData);
             successCount++;
           } catch (e) {
             console.error(e);
           }
         }
         setUploading(false);
         fetchMyData(); // Refresh data immediately
         message.success(`${successCount} rows processed successfully`);
       },
       error: (err) => {
         console.error(err);
         message.error("CSV parse error");
         setUploading(false);
       },
     });
     return false;
   };

  const screens = Grid.useBreakpoint();
  
  const [currentUserSalary, setCurrentUserSalary] = useState(30000); // Default
  const [currentUserName, setCurrentUserName] = useState("");

  const [joiningDate, setJoiningDate] = useState(null); // Added Joining Date

  /* ================= AUTH ================= */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (!user) {
        navigate("/");
        return;
      }
      setUserEmail(user.email.toLowerCase());
    });
    return () => unsub();
  }, [navigate]);

  useEffect(() => {
    if (userEmail) {
        fetchMyData();
        fetchHolidays();
        fetchMySalary(); // NEW
    }
  }, [userEmail]);  
  
  const fetchMySalary = async () => {
    try {
        const q = query(collection(db, "employees"), where("email", "==", userEmail));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const data = snap.docs[0].data();
            if (data.salary) setCurrentUserSalary(Number(data.salary));
            if (data.joiningDate) setJoiningDate(data.joiningDate); 
            if (data.employeeId) setEmployeeId(data.employeeId); // Set ID to trigger Incentives Fetch
        }
    } catch (err) {
        console.error("Error fetching salary:", err);
    }
  };

  /* ================= FETCH ================= */
    const fetchHolidays = async () => {
    try {
      const snap = await getDocs(collection(db, "holidays"));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setHolidays(data);
    } catch {
      console.error("Failed to load holidays");
    }
  };

  /* ================= PAYROLL CALCULATIONS ================= */
  const calculateWorkingDays = (monthDayjs, joiningDate = null) => {
    if (!monthDayjs) return 0;
    const start = monthDayjs.clone().startOf("month");
    const end = monthDayjs.clone().endOf("month");
    
    // Adjust start date if joining date is in this month
    let actualStart = start;
    if (joiningDate) {
        const jDate = dayjs(joiningDate);
        if (jDate.isValid() && jDate.isSame(monthDayjs, 'month')) {
            actualStart = jDate;
        }
    }

    let workingDays = 0;
    const holidayDates = holidays.map(h => h.date);
    // Add defaults
    DEFAULT_HOLIDAYS.forEach(d => { if(!holidayDates.includes(d)) holidayDates.push(d) });
    
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

  /* ================= CALCULATIONS ================= */
    /* ================= CALCULATIONS ================= */
  const getMonthlyPayroll = (employeeRecords) => {
    if (!selectedMonth) return { targetHours: 0, actualHours: 0, workingDays: 0, difference: 0, eligibleHours: 0, missingDays: [], totalLeaves: 0, passedWorkingDays: 0, passedTargetHours: 0, passedEligibleHours: 0 };
    
    // Prepare Holidays
    const holidayDates = holidays.map(h => h.date);
    DEFAULT_HOLIDAYS.forEach(d => { if(!holidayDates.includes(d)) holidayDates.push(d) });
    
    // Filter records for selected month
    // Filter records for selected month
    const rawMonthlyRecords = employeeRecords.filter(r => {
        if (!r.date) return false;
        const d = dayjs(r.date, [
          "YYYY-MM-DD",
          "DD-MM-YYYY",
          "MM/DD/YYYY",
          "DD/MM/YYYY",
          "YYYY/MM/DD",
          "MM-DD-YYYY",
          "D-MMM-YYYY",
        ], false);
        return d.isValid() && d.isSame(selectedMonth, 'month');
    });

    const uniqueRecordsMap = new Map();
    rawMonthlyRecords.forEach(r => {
        if (uniqueRecordsMap.has(r.date)) {
            const existing = uniqueRecordsMap.get(r.date);
            if (r.isLeave && !existing.isLeave) uniqueRecordsMap.set(r.date, r);
            else if (!existing.isLeave) uniqueRecordsMap.set(r.date, r);
        } else {
            uniqueRecordsMap.set(r.date, r);
        }
    });
    const monthlyRecords = Array.from(uniqueRecordsMap.values());
    
    // Calculate Hours
    let actualHours = 0;
    let eligibleHours = 0;
    let passedEligibleHours = 0;
    const recordedDates = [];
    const shortDays = []; // NEW
    const zeroDays = []; // Fix: Defined for usage below
    const today = dayjs();

    let earnedDays = 0;
    let presentDaysCount = 0;


    const currentMonthAdj = adjustments[selectedMonth.format("YYYY-MM")] || { grantedLeaves: 0, grantedHours: 0, grantedShortageDates: [] };
 
    // --- GLOBAL HOURS BALANCING (User Request: Use Surplus to Fill Short Days) ---
    const SHORT_DAY_TOLERANCE = 15 / 60; // 15 mins tolerance for full day
    let creditBank = 0;
    monthlyRecords.forEach(r => {
        let dailyHours = 0;
        if (r.punchTimes && r.punchTimes.length > 0) {
            const { totalHours } = calculateTimes(r.punchTimes);
            if (totalHours) {
                 const [h, m] = totalHours.split(":").map(Number);
                 dailyHours = h + (m/60);
            }
        } else if (r.hours) {
           const [h, m] = r.hours.split(":").map(Number);
           dailyHours = h + (m/60);
        }

        const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD", "MM-DD-YYYY", "D-MMM-YYYY"], false);
        const isWeekend = d.day() === 0 || d.day() === 6;
        const isHoliday = d.isValid() && holidayDates.includes(d.format("YYYY-MM-DD"));

        if (isWeekend || isHoliday) {
            creditBank += dailyHours;
        } else {
            // Weekdays: Flexible Hours Logic
            if (dailyHours >= 8 - SHORT_DAY_TOLERANCE) {
              // Full Day credit. Anything above 8h is surplus
              if (dailyHours > 8) {
                creditBank += dailyHours - 8;
              }
            } else if (dailyHours >= 3) {
              // Half Day credit (Equivalent to 4h work). 
              // Anything worked above 4h is surplus towards another day.
              if (dailyHours > 4) {
                creditBank += dailyHours - 4;
              }
            } else if (dailyHours > 0) {
              // Absence (<3h). 0 credit given, so all worked hours are surplus.
              creditBank += dailyHours;
            }
        }
    });

    monthlyRecords.forEach(r => {
      let dailyHours = 0;
      // Calculate from Punch Times if available
      if (r.punchTimes && r.punchTimes.length > 0) {
          const { totalHours } = calculateTimes(r.punchTimes);
           if(totalHours) {
              const [h, m] = totalHours.split(":").map(Number);
              dailyHours = h + (m/60);
           }
           // If totalHours is 0 / null, dailyHours stays 0 (don't fallback to r.hours)
      } else if (r.hours) {
        const [h, m] = r.hours.split(":").map(Number);
        dailyHours = h + (m/60);
      }
      actualHours += dailyHours;
      
          const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD", "MM-DD-YYYY", "D-MMM-YYYY"], false);
      if(d.isValid()) {
          recordedDates.push(d.format("YYYY-MM-DD"));

          // Apply Granted Shortage (Virtual)
          const isGranted = (currentMonthAdj.grantedShortageDates || []).includes(r.date);
          if (isGranted && dailyHours < 8 && !r.isLeave) {
               const shortage = 8 - dailyHours;
               if (shortage > 0) dailyHours += shortage;
          }
          
          const isWeekend = d.day() === 0 || d.day() === 6;

          // Rules Check

          // Rules Check - Removed 3h threshold to match AdminDashboard
          // if (dailyHours >= 3) { 
              let hoursToAdd = 0;
              if (isWeekend) {
                  if (r.weekendApproved) {
                      hoursToAdd = dailyHours;
                  }
              } else {
                  hoursToAdd = dailyHours;
              }
              
              eligibleHours += hoursToAdd;
              
              // Passed Hours
              if (d.isSameOrBefore(today, 'day')) {
                  passedEligibleHours += hoursToAdd;
              }
          // }
          
          // Short Days Logic
          // isGranted is already calculated above
          
          if (!isWeekend && !r.isLeave && dailyHours < 8) {
              const normalizedDate = d.format("YYYY-MM-DD");
              if (dailyHours >= 3) {
                  shortDays.push({ date: normalizedDate, dailyHours, shortage: 8 - dailyHours });
              } else if (dailyHours < 3) {
                  // Low Hours / Zero Days
                  // We track them to display as Absences later
                  zeroDays.push({ date: normalizedDate, dailyHours });
              }
          }

              const isHoliday = d.isValid() && holidayDates.includes(d.format("YYYY-MM-DD"));

              // Earned Days Calculation
              // SPECIAL RULE: Weekends and Holidays always give 1.0 credit if worked/recorded
              let hoursForPay = dailyHours;
              let earned = 0;
              if (isWeekend || isHoliday) {
                  earned = 1;
              } else {
                  if (hoursForPay >= 8 - SHORT_DAY_TOLERANCE) {
                      earned = 1;
                  } else if (hoursForPay >= 3) {
                      // Short Day Logic (3h - 8h)
                      const deficit = 8 - hoursForPay;
                      // Try to cover with Bank
                      // Use epsilon for float comparison safety
                      if (creditBank >= deficit - 0.001) {
                          earned = 1; // BOOSTED to Full Day
                          creditBank -= deficit; // Consume surplus
                      } else {
                          earned = 0.5; // Short Day Penalty
                      }
                      
                      }
               }
               earnedDays += earned;

               if (isWeekend || isHoliday || hoursForPay >= 3) {
                  presentDaysCount += 1;
              }
          }
    }); // End of monthlyRecords loop

    // Rule: Overtime CAP.
    // Earned Days cannot exceed Present Days count.
    // effectivelyEarnedDays = Math.min(effectivelyEarnedDays, presentDaysCount); // DISABLED to match Admin Strict Logic
    
    // Calculate Missing Days (Absences)
    const missingDays = [];
    const start = selectedMonth.clone().startOf("month");
    const end = selectedMonth.clone().endOf("month");
    
    // JOINING DATE LOGIC START
    let actualStart = start;
    if (joiningDate) {
        const jDate = dayjs(joiningDate);
        if (jDate.isValid() && jDate.isSame(selectedMonth, 'month')) {
            actualStart = jDate;
        }
    }
    // JOINING DATE LOGIC END

    let curr = actualStart.clone();
    let passedWorkingDays = 0;

    while (curr.isSameOrBefore(end)) {
        const dayStr = curr.format("YYYY-MM-DD");
        const day = curr.day();
        const isWeekend = day === 0 || day === 6;
        const isHoliday = holidayDates.includes(dayStr);
        const isFuture = curr.isAfter(today, 'day');
        

        // Count Passed Working Days
        if (!isWeekend && !isHoliday && !isFuture) {
            passedWorkingDays++;
        }

        // Check for missing days
        if (!isFuture) { // Don't count future days as missing
             if (!isWeekend && !isHoliday && !recordedDates.includes(dayStr)) {
                missingDays.push(dayStr);
            }
        }
       
        curr = curr.add(1, "day");
    }

    missingDays.sort();

    // Calculate Target
    const workingDays = calculateWorkingDays(selectedMonth, joiningDate);
    const targetHours = workingDays * 8;
    const passedTargetHours = passedWorkingDays * 8;
    
    const leavesCount = monthlyRecords.filter(r => r.isLeave).length;
    const paidLeavesCount = monthlyRecords.filter(r => r.isLeave && r.leaveType && r.leaveType.toLowerCase() === "paid").length;
    const totalLeaves = missingDays.length + zeroDays.length + leavesCount - paidLeavesCount;

    // --- SALARY / NET EARNING DAYS CALCULATION ---
    // Fix: Use earnedDays (calculated in loop) to account for Half Days / Short Days
    // Logic: Earned Days (from Work) + Paid Leaves + Weekends (Paid)
    
    // --- SANDWICH LEAVE LOGIC ---
    const sandwichDays = [];
    let sandwichDeduction = 0;

    // Helper: Check if Absent (Leave or Missing) using Context
    // Uses 'employeeRecords' which contains full history for this user
    const isAbsentOrLeave = (checkDateStr) => {
        // 1. Is it a Holiday?
        if (holidayDates.includes(checkDateStr)) return false;

        // 2. Check in Full Records
        const record = employeeRecords.find(r => r.date === checkDateStr); 

        if (!record) {
            // Missing -> Absent ONLY if in the current month AND not in the future
            // Fixed: We don't assume absence for missing records in DIFFERENT months (e.g. cross-month sandwich)
            const checkDate = dayjs(checkDateStr);
            if (checkDate.isSame(selectedMonth, 'month')) {
                return checkDate.isSameOrBefore(today, 'day');
            }
            return false; // Assume not absent if missing in a different month
        }
        
        // 3-hour working threshold: < 3h is considered leave (for sandwich purposes)
        let dailyHours = 0;
        if (record.punchTimes && record.punchTimes.length > 0) {
            const { totalHours } = calculateTimes(record.punchTimes);
            if (totalHours) {
                const [h, m] = totalHours.split(":").map(Number);
                dailyHours = h + (m / 60);
            }
        } else if (record.hours) {
            const [h, m] = record.hours.split(":").map(Number);
            dailyHours = h + (m / 60);
        }
        
        // REFINED: Even if it's marked as Leave (isLeave: true), 
        // if they worked >= 3 hours, it is NOT an "Absence" for sandwich rule.
        if (dailyHours < 3) {
            // No work done, but is it a leave? 
            if (record.isLeave) return true;
            // Or just missing hours?
            return true;
        }

        return false;
    };

    // Helper to check if a day is a "scheduled working day"
    const isScheduledWorkingDay = (date) => {
        const d = dayjs(date);
        const day = d.day();
        const isWeekend = day === 0 || day === 6;
        const isHoliday = holidayDates.includes(d.format("YYYY-MM-DD"));
        return !isWeekend && !isHoliday;
    };
    
    // Iterate through weekends/holidays in the month to check for Sandwich
    let sCurr = start.clone();
    let unworkedWeekendCount = 0;
    const cutoffDate = dayjs();

    while (sCurr.isSameOrBefore(end)) {
        const dayStr = sCurr.format("YYYY-MM-DD");
        const isWeekend = sCurr.day() === 6 || sCurr.day() === 0;
        const isHoliday = holidayDates.includes(dayStr);

        if (isWeekend) {
             // Count for Pay if NOT WORKED (Prevent Double Count)
             if (!recordedDates.includes(dayStr) && sCurr.isSameOrBefore(cutoffDate, 'day')) {
                 unworkedWeekendCount++;
             }
        }

        if (isWeekend || isHoliday) {
             // CHECK SANDWICH (Robust Logic)
             // Find nearest scheduled working day before
             let prev = sCurr.subtract(1, 'day');
             while (prev.isValid() && !isScheduledWorkingDay(prev.format('YYYY-MM-DD'))) {
                 prev = prev.subtract(1, 'day');
             }
             
             // Find nearest scheduled working day after
             let next = sCurr.add(1, 'day');
             while (next.isValid() && !isScheduledWorkingDay(next.format('YYYY-MM-DD'))) {
                 next = next.add(1, 'day');
             }
             
             if (isAbsentOrLeave(prev.format('YYYY-MM-DD')) && isAbsentOrLeave(next.format('YYYY-MM-DD'))) {
                 sandwichDays.push(dayStr);
                 sandwichDeduction++;
             }
        }
        sCurr = sCurr.add(1, 'day');
    }
    
    // SANDWICH LOGIC ENABLED full


    // --- HOLIDAY LOGIC ---
    let unworkedHolidayCount = 0;
    let hCurr = start.clone();
    while (hCurr.isSameOrBefore(end)) {
        const dayStr = hCurr.format("YYYY-MM-DD");
        const day = hCurr.day();
        const isWeekend = day === 0 || day === 6;
        if (!isWeekend && holidayDates.includes(dayStr)) {
            // Only count if NOT WORKED
            if (!recordedDates.includes(dayStr) && hCurr.isSameOrBefore(cutoffDate, 'day')) {
               unworkedHolidayCount++;
            }
        }
        hCurr = hCurr.add(1, 'day');
    }

    // --- SALARY CALCULATION (Synced with Admin) ---
    // Rule: Earned Days + Unworked Weekend + Unworked Holidays - Sandwich Deductions + Paid Leaves
    
    // Fix for "High Hours but Low Days"
    let effectivelyEarnedDays = earnedDays;

    // STRICT LOGIC RESTORED:
    // 1 Full Day = 1.0
    // 1 Half Day = 0.5
    // No boosting. Discrepancy is handled by straight sum.

    // New Formula: (Present Days + Unworked Weekends + Unworked Holidays)
    let daysForPay = effectivelyEarnedDays + unworkedWeekendCount + unworkedHolidayCount;
    
    // ADJUST FOR SANDWICH
    daysForPay -= sandwichDeduction;

    // APPLY GRANTED LEAVES (User Adjustment)
    // Adding granted leaves effectively pays for those days.

    // Calculate Billable Days (Denominator)
    const daysInCurrentMonth = selectedMonth.daysInMonth();
    const monthlySalary = (currentUserSalary && currentUserSalary > 0) ? currentUserSalary : 30000;
    const dailyRate = monthlySalary / daysInCurrentMonth;
    
    // User Request: Calculate strictly based on Net Earned Days
    // Formula: Net Earned * Daily Rate (Dynamic Basis)
    let payableSalary = daysForPay * dailyRate;
    
    // Incentive
    const monthlyIncentives = incentives.filter(inc => inc.month === selectedMonth.format("YYYY-MM"));
    const incentiveAmount = monthlyIncentives.reduce((sum, inc) => sum + (Number(inc.amount) || 0), 0);
    payableSalary += incentiveAmount;

    if (presentDaysCount === 0 && paidLeavesCount === 0) {
        payableSalary = 0 + incentiveAmount;
    }
    
    if (payableSalary < 0) payableSalary = 0;

    return {
      workingDays,
      targetHours,
      actualHours,
      difference: eligibleHours - targetHours,
      eligibleHours,
      missingDays,
      shortDays, 
      zeroDays, // Export for UI details
      totalLeaves,
      sandwichDays,
      passedWorkingDays,
      passedTargetHours,
      passedEligibleHours,
      passedDifference: passedEligibleHours - passedTargetHours,
      hasPenalty: effectivelyEarnedDays < presentDaysCount - 0.01,
      // Net Earning Days Logic
      netEarningDays: daysForPay,
      daysInMonth: selectedMonth.daysInMonth(),
      payableSalary,
      monthlySalary,
      incentiveAmount
    };
  };






  /* ================= RENDER HELPERS ================= */
  const renderPayrollStats = (payroll, darkMode) => (
      <div style={{ 
          marginBottom: 16, 
          padding: "12px 16px", 
          background: darkMode ? "#1f1f1f" : "#fff", 
          borderRadius: 8,
          boxShadow: darkMode ? "0 2px 8px rgba(0,0,0,0.5)" : "0 2px 8px rgba(0,0,0,0.05)",
          border: darkMode ? "1px solid #303030" : "1px solid #f0f0f0"
      }}>
          {/* COMPACT STATS ROW */}
          <Row gutter={[16, 16]} align="middle">

              <Col xs={12} sm={5}>
                  <Statistic 
                    title="Net Earned" 
                    value={payroll.netEarningDays} 
                    suffix={
                        <span>
                            {`/ ${payroll.daysInMonth} (Bank: ${payroll.creditBank ? payroll.creditBank.toFixed(2) : 0})`}
                            {payroll.shortDays && payroll.shortDays.length > 0 && payroll.hasPenalty && (
                                <Tooltip title="Warning: Short hours detected on some days (Risk of Half Day)">
                                    <span style={{width: 8, height: 8, borderRadius: '50%', background: '#faad14', display: 'inline-block', marginLeft: 8, verticalAlign: 'middle'}}></span>
                                </Tooltip>
                            )}
                        </span>
                    }
                    valueStyle={{ fontSize: 16, fontWeight: 600, color: payroll.netEarningDays < payroll.daysInMonth ? "#cf1322" : "#3f8600" }} 
                  />
              </Col>
              <Col xs={12} sm={4}>
                  <Statistic 
                    title="Passed Days" 
                    value={payroll.passedWorkingDays} 
                    suffix={`/ ${payroll.workingDays}`}
                    valueStyle={{ fontSize: 16, fontWeight: 600, color: "#722ed1" }} 
                  />
              </Col>
              <Col xs={12} sm={4}>
                   <Statistic 
                    title="Leaves" 
                    value={Math.max(0, payroll.totalLeaves)} 
                    valueStyle={{ fontSize: 16, color: (payroll.paidLeavesCount > 0) ? "#52c41a" : "#faad14", fontWeight: 600 }} 
                    suffix={payroll.paidLeavesCount > 0 ? <span style={{fontSize:11, color:'#888', marginLeft:5}}>(-{payroll.paidLeavesCount} Pd)</span> : null}
                  />
              </Col>
              <Col xs={12} sm={5}>
                  <Statistic 
                    title="Present Hours" 
                    value={payroll.passedEligibleHours.toFixed(2)} 
                    suffix={<span style={{fontSize: 12, color: '#888'}}>/ {payroll.targetHours}h</span>}
                    valueStyle={{ fontSize: 16, fontWeight: 600, color: "#1890ff" }} 
                  />
              </Col>
              <Col xs={12} sm={6}>
                  <Statistic 
                    title="Hours Short by" 
                    value={Math.abs(payroll.passedDifference).toFixed(2)} 
                    prefix={payroll.passedDifference >= 0 ? <PlusOutlined style={{fontSize: 14}}/> : <></>} 
                    suffix={<span style={{fontSize: 12, color: '#888'}}>h {payroll.passedDifference >= 0 ? "Ahead" : "Behind"}</span>}
                    valueStyle={{ fontSize: 16, color: payroll.passedDifference < 0 ? "#ff4d4f" : "#52c41a", fontWeight: 600 }} 
                  />
              </Col>

          </Row>

          {/* COLLAPSIBLE DETAILS SECTION */}
          {((payroll.shortDays && payroll.shortDays.length > 0) || 
            (payroll.zeroDays && payroll.zeroDays.length > 0) || 
            (payroll.missingDays && payroll.missingDays.length > 0) ||
            (payroll.pendingWeekends && payroll.pendingWeekends.length > 0)) && (
              
              <Row gutter={[16, 16]} style={{marginTop: 12}}>
                  
                  {/* Pending Requests Status - Employee View */}
                  {payroll.pendingWeekends && payroll.pendingWeekends.length > 0 && (
                    <Col span={24}>
                        <div style={{ fontSize: 12, fontWeight: "bold", color: "#faad14", marginBottom: 6 }}>
                            <ClockCircleOutlined /> Weekend Approvals Pending ({payroll.pendingWeekends.length})
                        </div>
                        {payroll.pendingWeekends.map(pw => (
                            <div key={pw.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4, background: darkMode ? "#222" : "#fffbe6", padding: "4px 8px", borderRadius: 4, border: "1px solid #faad14" }}>
                                <span style={{ fontSize: 12 }}>{pw.date} — {pw.dailyHours.toFixed(2)}h</span>
                                <Tag color="orange" style={{fontSize: 10}}>Waiting Admin</Tag>
                            </div>
                        ))}
                    </Col>
                  )}


              </Row>
          )}
      </div>
  );

  /* ================= FETCH ================= */
  const fetchMyData = async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, "punches"),
        where("email", "==", userEmail)
      );
      const snap = await getDocs(q);
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      
      // Sort Descending (Latest Date First)
      data.sort((a, b) => {
        // Parse with flexible format (non-strict) to handle 1-1-2025 vs 01-01-2025
        const dateA = dayjs(a.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        const dateB = dayjs(b.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        if (!dateA.isValid()) return 1; 
        if (!dateB.isValid()) return -1;
        return dateB.valueOf() - dateA.valueOf();
      });
      
      setRecords(data);

      // Fetch Employee ID & Name
      const empQ = query(collection(db, "employees"), where("email", "==", userEmail));
      const empSnap = await getDocs(empQ);
      if (!empSnap.empty) {
          const empData = empSnap.docs[0].data();
          setEmployeeId(empData.employeeId);
          setJoiningDate(empData.joiningDate || null);
          setCurrentUserName(empData.firstName ? `${empData.firstName} ${empData.lastName || ''}` : empData.employee);
      } else if (data.length > 0) {
           // Fallback to punch record name
           setEmployeeId(data[0].employeeId);
           setCurrentUserName(data[0].firstName || data[0].employee);
      }
    } catch {
      message.error("Failed to fetch data");
    }
    setLoading(false);
  };

  useEffect(() => {
    const fetchAdjustments = async () => {
        if (!employeeId) return;
        const monthStr = selectedMonth.format("YYYY-MM");
        const key = `${employeeId}_${monthStr}`;
        try {
            const docRef = doc(db, "payroll_adjustments", key);
            const docSnap = await getDoc(docRef);
            if (docSnap.exists()) {
                setAdjustments(prev => ({...prev, [monthStr]: docSnap.data()}));
            } else {
                setAdjustments(prev => ({...prev, [monthStr]: { grantedLeaves: 0, grantedHours: 0, grantedShortageDates: [] }}));
            }
        } catch (e) {
            console.error("Failed to fetch adjustments", e);
        }
    };
    fetchAdjustments();
  }, [employeeId, selectedMonth]);

  /* ================= LOGOUT ================= */
  const handleLogout = async () => {
    await signOut(auth);
    navigate("/");
  };

  /* ================= REQUEST ================= */
  // Renamed or Aliased for compatibility with UI call
  const openRequest = (record) => {
    setCurrentRecord(record);
    form.setFieldsValue({
      punchTimes: (record.punchTimes || []).join(", "),
      reason: "",
    });
    setEditOpen(true);
  };
  /* ================= REQUESTS ================= */
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [requestDate, setRequestDate] = useState(null);
  const [requestType, setRequestType] = useState("");
  const [requestReason, setRequestReason] = useState("");

  const openRequestModal = (date, type) => {
    setRequestDate(date);
    setRequestType(type);
    setRequestReason("");
    setRequestModalOpen(true);
  };
  const openEdit = (record) => {
    setCurrentRecord(record);
    setEditOpen(true);
  };

  const submitDirectRequest = async () => {
       if (!requestReason) {
           message.error("Please provide a reason");
           return;
       }
       try {
           await addDoc(collection(db, "requests"), {
              email: userEmail,
              date: requestDate,
              type: requestType, // 'Leave Request' or 'Missing Entry Correction'
              reason: requestReason,
              status: "pending",
              createdAt: new Date().toISOString(),
              employeeId: employeeId,
              employeeName: currentUserName
           });
           message.success("Request sent");
           setRequestModalOpen(false);
       } catch (e) {
           console.error(e);
           message.error("Failed to send request");
       }
  };


  const handleRequestUpdate = async (values) => {
    // Legacy Punch Update Request
    const punchTimes = values.punchTimes.split(",").map((t) => t.trim()).filter(Boolean);
    const { inTime, outTime, totalHours } = calculateTimes(punchTimes);

    if (!inTime || !outTime) {
      message.error("Could not calculate In/Out times. Check format (HH:MM)");
      return;
    }

    await addDoc(collection(db, "requests"), {
      punchId: currentRecord.id,
      email: userEmail,
      date: currentRecord.date,
      originalInTime: currentRecord.inTime,
      originalOutTime: currentRecord.outTime,
      inTime,
      outTime,
      punchTimes,
      numberOfPunches: punchTimes.length,
      hours: totalHours,
      reason: values.reason,
      status: "pending",
      createdAt: new Date().toISOString()
    });

    message.success("Request sent to Super Employee");
    setEditOpen(false);
  };

  const payroll = React.useMemo(() => getMonthlyPayroll(records), [records, selectedMonth, holidays, joiningDate]);
  
  
  /* ================= HELPERS (New) ================= */
  const formatDuration = (hoursDecimal) => {
    if (!hoursDecimal || hoursDecimal <= 0) return "0:00:00";
    const h = Math.floor(hoursDecimal);
    const m = Math.floor((hoursDecimal - h) * 60);
    const s = Math.round(((hoursDecimal - h) * 60 - m) * 60);
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const getDayOfWeek = (dateStr) => {
    const d = dayjs(dateStr, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
    return d.isValid() ? d.format("dddd, MMMM DD, YYYY") : dateStr;
  };

  /* ================= COMMENT/HIGHLIGHT LOGIC ================= */
  const toggleHighlight = async (record, timeVal) => {
    if (!timeVal) return;
    setHighlightRecord(record);
    setHighlightTime(timeVal);
    
    // Check if already highlighted/commented
    const currentComments = record.highlightComments || {};
    const existingComment = currentComments[timeVal] || "";
    
    setHighlightComment(existingComment);
    setHighlightModalOpen(true);
  };
  
  const handleSaveHighlight = async () => {
      if (!highlightRecord || !highlightTime) return;
      
      try {
          const docRef = doc(db, "punches", highlightRecord.id);
          const currentHighlights = highlightRecord.highlightedTimes || [];
          const currentComments = highlightRecord.highlightComments || {};
          
          let newHighlights = [...currentHighlights];
          let newComments = { ...currentComments };
          
          const trimmedComment = highlightComment.trim();

          if (trimmedComment) {
              // ADD/UPDATE
              if (!newHighlights.includes(highlightTime)) {
                  newHighlights.push(highlightTime);
              }
              newComments[highlightTime] = trimmedComment;
          } else {
              // REMOVE if empty (Enforce Comment for Highlight)
              newHighlights = newHighlights.filter(t => t !== highlightTime);
              delete newComments[highlightTime];
          }
          
          await updateDoc(docRef, {
              highlightedTimes: newHighlights,
              highlightComments: newComments
          });
          
          message.success(trimmedComment ? "Comment saved" : "Comment removed");
          setHighlightModalOpen(false);
          fetchMyData();
      } catch (e) {
          console.error(e);
          message.error("Failed to save comment");
      }
  };

  const handleRemoveHighlight = async () => {
      if (!highlightRecord || !highlightTime) return;
       try {
          const docRef = doc(db, "punches", highlightRecord.id);
          const currentHighlights = highlightRecord.highlightedTimes || [];
          const currentComments = highlightRecord.highlightComments || {};
          
          const newHighlights = currentHighlights.filter(t => t !== highlightTime);
          const newComments = { ...currentComments };
          delete newComments[highlightTime];
          
          await updateDoc(docRef, {
              highlightedTimes: newHighlights,
              highlightComments: newComments
          });
          
          message.success("Comment removed");
          setHighlightModalOpen(false);
          fetchMyData();
      } catch (e) {
          console.error(e);
          message.error("Failed to remove comment");
      }
  };



  /* ================= COMPUTED DATA ================= */
  // Removed duplicate payroll declaration
  
  const dataSource = React.useMemo(() => {
      // 1. Process existing records
      const processedRecords = records.map(r => {
        const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        const dayOfWeekIndex = d.day(); // 0=Sun, 6=Sat
        const isWeekend = dayOfWeekIndex === 0 || dayOfWeekIndex === 6;
        
        // Check if it is a holiday
        const holidayEntry = holidays.find(h => h.date === r.date);
        const holidayName = holidayEntry ? holidayEntry.name : "";
        const isHolidayRow = !!holidayName;
        // const presentDayCount = dailyHours >= 3 ? 1 : 0; // Keeping for logic if needed elsewhere
        // Punch parsing
        const sortedPunches = (r.punchTimes || []).sort();
        
        // Hours Calc
        let dailyHours = 0;
        if (r.punchTimes && r.punchTimes.length > 0) {
            const { totalHours } = calculateTimes(r.punchTimes);
            if (totalHours) {
                 const [h, m] = totalHours.split(":").map(Number);
                 dailyHours = h + (m/60);
            }
        } else if (r.hours) {
           const [h, m] = r.hours.split(":").map(Number);
           dailyHours = h + (m/60);
        }

        const targetHours = isWeekend ? 0 : 8;
        const shortfall = targetHours - dailyHours;
        const hoursShortBy = shortfall > 0 ? shortfall : 0;
        
        let isLowHoursLeave = false;
        if (!isWeekend && dailyHours < 3 && !r.isLeave) {
            isLowHoursLeave = true;
        }
        
        const isBoosted = (payroll.boostedDates || []).includes(r.date);
        
        const weekendCheck = isWeekend ? 1 : 0;
                // Present Days: Correct logic for Table display
            let earnedCredit = 0;
            if (isWeekend || isHolidayRow) {
                earnedCredit = 1;
            } else if (dailyHours >= 8 - (15 / 60) || isBoosted) {
                earnedCredit = 1;
            } else if (dailyHours >= 3) {
                earnedCredit = 0.5;
            }

            return {
                ...r,
                fullDate: getDayOfWeek(r.date) + (holidayName ? ` - ${holidayName}` : ""),
                sortedPunches,
                targetHoursFormatted: isWeekend ? "0:00:00" : "8:00:00",
                presentHoursFormatted: formatDuration(dailyHours),
                hoursShortByFormatted: formatDuration(hoursShortBy),
                presentDays: earnedCredit,
                leaveCheck: (r.isLeave || isLowHoursLeave) ? 1 : 0,
           daySwapOff: 0,
           weekendCheck,
           paidHolidays: holidayName ? 1 : 0,
           isWeekend,
           isHolidayRow: isHolidayRow,
           isBoosted
        };
      });

      // 2. Filter by month
      const filtered = processedRecords.filter(r => {
        if(!selectedMonth) return true;
        const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        return d.isValid() && d.isSame(selectedMonth, 'month');
      });

      // 3. Add Missing Days
      const missing = (payroll.missingDays || []).map(date => {
          const d = dayjs(date);
          const dayOfWeekIndex = d.day();
          const isWeekend = dayOfWeekIndex === 0 || dayOfWeekIndex === 6;
          const isHoliday = holidays.some(h => h.date === date); // Check if this missing day is also a holiday
          
          return {
            id: `missing-${date}`,
            date: date,
            fullDate: getDayOfWeek(date),
            in1: "", out1: "", in2: "", out2: "", in3: "",
            targetHoursFormatted: isWeekend ? "0:00:00" : "8:00:00",
            presentHoursFormatted: "0:00:00",
            hoursShortByFormatted: isWeekend ? "0:00:00" : "8:00:00",
            presentDays: 0, // Absent
            leaveCheck: (isWeekend || isHoliday) ? 0 : 1, // Using 1 for Absent on Weekdays, but 0 if weekend or holiday
            daySwapOff: 0,
            weekendCheck: isWeekend ? 1 : 0,
            paidHolidays: 0,
            isMissing: true,
            isWeekend,
            isHolidayRow: isHoliday,
            isBoosted: false
          };
      });
      
      // 4. Add Holiday Rows (for unworked holidays)
      const holidayRows = holidays.filter(h => {
          if(!selectedMonth) return true;
          const d = dayjs(h.date);
          return d.isValid() && d.isSame(selectedMonth, 'month');
      }).filter(h => {
          // Exclude if already in records (worked)
          const inRecords = records.some(r => r.date === h.date);
          // Also exclude if in missing? (Shouldn't be, logic confirmed)
          return !inRecords; 
      }).map(h => {
           const d = dayjs(h.date);
           const dayOfWeekIndex = d.day();
           const isWeekend = dayOfWeekIndex === 0 || dayOfWeekIndex === 6;
           
           return {
             id: `holiday-${h.date}`,
             date: h.date,
             fullDate: getDayOfWeek(h.date) + ` - ${h.name} (Holiday)`,
             in1: "", out1: "", in2: "", out2: "", in3: "",
             targetHoursFormatted: "8:00:00",
             presentHoursFormatted: "0:00:00", // Not worked
             hoursShortByFormatted: "0:00:00", // No shortage for holiday
             presentDays: 1, // Counts as present
             leaveCheck: 0,
             weekendCheck: isWeekend ? 1 : 0,
             paidHolidays: 1,
             isMissing: false,
             isWeekend,
             isHolidayRow: true
           };
      });

      const combined = [...filtered, ...missing, ...holidayRows];
      
      // 5. Sort Ascending
      combined.sort((a, b) => {
        const dateA = dayjs(a.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        const dateB = dayjs(b.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        return dateA.valueOf() - dateB.valueOf();
      });
      
      return combined;
  }, [records, payroll, selectedMonth, userEmail, holidays]);

  /* ================= TABLE ================= */
  const maxPunches = React.useMemo(() => {
    if (!dataSource || dataSource.length === 0) return 0;
    return Math.max(0, ...dataSource.map(r => (r.sortedPunches || []).length));
  }, [dataSource]);

  const maxPairs = Math.max(3, Math.ceil(maxPunches / 2));

  const columns = React.useMemo(() => {
     const punchCols = [];
     for (let i = 0; i < maxPairs; i++) {
        punchCols.push({
            title: `In ${i+1}`,
            dataIndex: ["sortedPunches", i*2],
            width: 100,
            align: "center",
            onCell: (record) => ({ onDoubleClick: () => record.sortedPunches && toggleHighlight(record, record.sortedPunches[i*2]) }),
            render: (t, r) => <span style={(r.highlightedTimes || []).includes(t) && t ? { background: '#fffb8f', fontWeight: 'bold', padding: '2px 4px', borderRadius: 4 } : {}}>{t}</span> 
        });
        punchCols.push({
            title: `Out ${i+1}`,
            dataIndex: ["sortedPunches", i*2+1],
            width: 100,
            align: "center",
            onCell: (record) => ({ onDoubleClick: () => record.sortedPunches && toggleHighlight(record, record.sortedPunches[i*2+1]) }),
            render: (t, r) => <span style={(r.highlightedTimes || []).includes(t) && t ? { background: '#fffb8f', fontWeight: 'bold', padding: '2px 4px', borderRadius: 4 } : {}}>{t}</span>
        });
     }

     return [
      { title: "Date", dataIndex: "fullDate", width: 220, fixed: 'left' },
      ...punchCols,
      { title: "Total Hours", dataIndex: "targetHoursFormatted", width: 100, align: "center" },
      { title: "Present Hours", dataIndex: "presentHoursFormatted", width: 120, align: "center" },
      { title: "Hours Short by", dataIndex: "hoursShortByFormatted", width: 120, align: "center" },
      { title: "Present Days", dataIndex: "presentDays", width: 100, align: "center", render: (v) => <span style={{ color: v ? "green" : "red" }}>{v}</span> },
      { title: "Leave check", dataIndex: "leaveCheck", width: 100, align: "center" },
      { title: "Day Swap off", dataIndex: "daySwapOff", width: 100, align: "center" },
      { title: "Weekend Checks", dataIndex: "weekendCheck", width: 120, align: "center", render: (v) => v ? 1 : 0 }, 
      { title: "Paid Holidays", dataIndex: "paidHolidays", width: 100, align: "center" },
      {
        title: "Action",
        width: 100,
        fixed: 'right',
        render: (_, r) => {
          if (r.isMissing || r.isLeave || r.isWeekend) return null;
          return (
              <Button type="link" icon={<EditOutlined />} onClick={() => openRequest(r)} />
          );
        },
      },
    ];
  }, [maxPairs]);

  return (
    <ConfigProvider
      theme={{ algorithm: darkMode ? darkAlgorithm : defaultAlgorithm }}
    >
      <div
        style={{
          minHeight: "100vh",
          background: darkMode ? DARK_BG : "#f0f2f5",
          padding: screens.xs ? 8 : 24,
        }}
      >
        {/* HEADER */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 16 }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
               <h2 style={{ color: darkMode ? "#fff" : "#000", margin: 0 }}>
                   My Punch Records {currentUserName && <span style={{fontSize:'0.8em', opacity:0.7}}>({currentUserName})</span>}
               </h2>
               <DatePicker.MonthPicker 
                  value={selectedMonth} 
                  onChange={setSelectedMonth} 
                  allowClear={false}
                  placeholder="Select Month"
                />
           </div>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <BulbOutlined style={{ color: darkMode ? "#fff" : "#000" }} />
            <Switch
              checked={darkMode}
              onChange={setDarkMode}
              checkedChildren="Dark"
              unCheckedChildren="Light"
            />

            <Button icon={<ReloadOutlined />} onClick={() => { fetchMyData(); fetchHolidays(); }}>
              Refresh
            </Button>
            {/* Upload Page Button */}
            {/* Upload Page Button Inline - Same as Admin */}
            <Upload beforeUpload={handleFileUpload} showUploadList={false} accept=".csv">
                <Button type="primary" icon={<UploadOutlined />} loading={uploading}>Upload CSV</Button>
            </Upload>
            <Button icon={<ClockCircleOutlined />} onClick={() => setHolidayModalOpen(true)}>Holidays</Button>
            <Button icon={<MessageOutlined />} onClick={() => setChatOpen(true)}>Chat</Button>
            <Button danger icon={<LogoutOutlined />} onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>

        {/* PAYROLL STATS - Collapsible? Or verify if needed. Keeping it for now as it doesn't conflict with screenshot request directly, but table is key. */}
        {/* PAYROLL STATS - Collapsible? Or verify if needed. Keeping it for now as it doesn't conflict with screenshot request directly, but table is key. */}
        {renderPayrollStats(payroll, darkMode)}

        {/* TABLE */}
        {dataSource.length === 0 ? (
          <Empty />
        ) : (
          <Table
            bordered
            loading={loading}
            columns={columns}
            dataSource={dataSource}
            rowKey="id"
            scroll={{ x: 1500 }}
            sticky
            pagination={false}
            rowClassName={(record) => {
                if (record.isMissing) return darkMode ? "dark-missing-row" : "light-missing-row";
                if (record.isLeave) {
                   if (record.leaveType === 'Paid') return darkMode ? "dark-paid-leave-row" : "light-paid-leave-row"; 
                   return darkMode ? "dark-unpaid-leave-row" : "light-unpaid-leave-row";
                }
                if (record.isWeekend) return darkMode ? "dark-weekend-row" : "light-weekend-row"; // Add styling for weekend
                return "";
            }}
            onRow={(record) => {
                let bg = "";
                if (record.isMissing) {
                    bg = darkMode ? "rgba(255, 77, 79, 0.1)" : "#ffeae8"; // Lighter red for missing
                } else if (record.isEdited) {
                    bg = darkMode ? "rgba(114, 46, 209, 0.15)" : "#f9f0ff"; // Purple for Edited
                } else if (record.isLeave) {
                   if (record.leaveType === 'Paid') bg = darkMode ? "rgba(183, 235, 143, 0.15)" : "#f6ffed";
                   else bg = darkMode ? "#333" : "#fafafa";
                } else if (record.isWeekend) {
                   bg = darkMode ? "rgba(76, 175, 80, 0.15)" : "#e6ffec"; // Light Green for weekend? Screenshot shows greenish for Sunday/Saturday rows
                }
                if(bg) return { style: { background: bg } };
                return {};
            }}
            style={{
              background: darkMode ? DARK_CARD : "#fff",
            }}
          />
        )}

        {/* EDIT MODAL */}
        <Modal
          open={editOpen}
          title={`Request Correction - ${currentRecord?.date}`}
          footer={null}
          onCancel={() => setEditOpen(false)}
          styles={{
            content: {
              background: darkMode ? DARK_CARD : "#fff",
            },
          }}
        >
          <Form layout="vertical" form={form} onFinish={handleRequestUpdate}>
            <div style={{ marginBottom: 16, color: "#888", fontSize: 12 }}>
              Edit the punch times below (comma separated, HH:MM). In Time and Out Time will be auto-calculated.
            </div>
            <Form.Item name="punchTimes" label="Punch Times" required>
              <Input />
            </Form.Item>
            <Form.Item name="reason" label="Reason for Correction" required>
              <Input.TextArea rows={2} />
            </Form.Item>
            <div style={{ textAlign: "right" }}>
              <Button onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button
                type="primary"
                htmlType="submit"
                style={{ marginLeft: 8 }}
              >
                Send Request
              </Button>
            </div>
          </Form>
        </Modal>

        {/* READ ONLY HOLIDAY MODAL */}
        <Modal 
            open={holidayModalOpen} 
            title="Holidays List" 
            footer={null} 
            onCancel={() => setHolidayModalOpen(false)}
        >
            <List
                bordered
                dataSource={holidays}
                renderItem={(item) => (
                    <List.Item>
                        <List.Item.Meta
                            title={item.name}
                            description={item.date}
                        />
                    </List.Item>
                )}
            />
            <div style={{ marginTop: 16, color: "#888", fontSize: 12 }}>
                Note: Weekends (Sat/Sun) are automatically excluded working days.
            </div>
        </Modal>
      </div>
      <ChatDrawer 
        open={chatOpen} 
        onClose={() => setChatOpen(false)} 
        currentUserEmail={userEmail}
        currentUserName={currentUserName}
        darkMode={darkMode}
      />
      <Modal
        title={requestType}
        open={requestModalOpen}
        onCancel={() => setRequestModalOpen(false)}
        onOk={submitDirectRequest}
        okText="Send Request"
      >
          <div style={{marginBottom: 16}}>
              <p>Requesting: <strong>{requestType}</strong> for <strong>{requestDate}</strong></p>
              <Input.TextArea 
                rows={4} 
                placeholder="Reason (e.g. Forgot to punch, Sick leave, etc.)"
                value={requestReason}
                onChange={e => setRequestReason(e.target.value)}
              />
          </div>
      </Modal>

      {/* HIGHLIGHT COMMENT MODAL - RENAMED TO ADD COMMENT */}
      <Modal
        title={`Add Comment for: ${highlightTime}`}
        open={highlightModalOpen}
        onCancel={() => setHighlightModalOpen(false)}
        footer={[
            <Button key="remove" danger onClick={handleRemoveHighlight}>Remove Comment</Button>,
            <Button key="cancel" onClick={() => setHighlightModalOpen(false)}>Cancel</Button>,
            <Button key="save" type="primary" onClick={handleSaveHighlight}>Save Comment</Button>
        ]}
      >
          <p>Add a note/comment for this specific time entry. This will be visible to Admin.</p>
          <Input.TextArea 
            rows={3} 
            placeholder="Type your comment here..."
            value={highlightComment}
            onChange={e => setHighlightComment(e.target.value)}
          />
      </Modal>
    </ConfigProvider>
  );
}
