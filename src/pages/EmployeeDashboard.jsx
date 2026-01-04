import React, { useState, useEffect } from "react";
import {
  Table,
  Empty,
  Button,
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
  Grid
} from "antd";
import {
  ReloadOutlined,
  LogoutOutlined,
  EditOutlined,
  BulbOutlined,
  UploadOutlined,
  ClockCircleOutlined,
  PlusOutlined,
  MessageOutlined
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
  updateDoc
} from "firebase/firestore";
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

  // Sum IN → OUT pairs
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
  const [selectedMonth, setSelectedMonth] = useState(dayjs());
  const [chatOpen, setChatOpen] = useState(false);
  const [holidays, setHolidays] = useState([]);
  const [adjustments, setAdjustments] = useState({}); // Stores adjustments for current month
  const [employeeId, setEmployeeId] = useState(null);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  
  const [currentUserName, setCurrentUserName] = useState("");

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
    }
  }, [userEmail]);  

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
  const calculateWorkingDays = (monthDayjs) => {
    if (!monthDayjs) return 0;
    const start = monthDayjs.clone().startOf("month");
    const end = monthDayjs.clone().endOf("month");
    
    let workingDays = 0;
    const holidayDates = holidays.map(h => h.date);
    // Add defaults
    DEFAULT_HOLIDAYS.forEach(d => { if(!holidayDates.includes(d)) holidayDates.push(d) });
    
    let curr = start.clone();
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
        const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
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
    let boostedDays = 0; // NEW: To track earned days if we allow boosting short days

    let earnedDays = 0;
    let presentDaysCount = 0;


    const currentMonthAdj = adjustments[selectedMonth.format("YYYY-MM")] || { grantedLeaves: 0, grantedHours: 0, grantedShortageDates: [] };
 
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
      
          const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
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
          if (isGranted && dailyHours < 8 && !r.isLeave) {
             // Already handled above for calculation, but we verify here for the list
             // Actually, if we adjusted dailyHours to 8 above, this condition (dailyHours < 8) might FAIL now?
             // YES. If we set dailyHours = 8, then dailyHours < 8 is false.
             // So it won't be pushed to shortDays. This is DESIRED behavior.
             // But we need to make sure we don't push it.
             // So current logic: `if (isWeekend... && dailyHours < 8 ...)`
             // Since dailyHours is now 8, it won't be pushed.
             // So existing logic is mostly fine, just need to remove the re-declaration and the filtering check inside the if?
             // Wait. Previous logic was: `if (... && !isGranted)`.
             // Now `dailyHours` is 8. So `dailyHours < 8` is FALSE.
             // So it naturally falls out.
             // We can just revert the specific lines that check `!isGranted` back to normal logic, OR leaves it as is.
             // Let's just remove the re-declaration line.
          }
          
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
              let boosted = 0;

              if (isWeekend || isHoliday) {
                  earned = 1;
                  boosted = 1;
              } else {
                  if (hoursForPay >= 8) {
                      earned = 1;
                      boosted = 1;
                  } else if (hoursForPay >= 3) {
                      earned = 0.5;
                      
                      if (r.isManualEntry) {
                        boosted = 0.5;
                      } else {
                        boosted = 1;
                      }
                  }
              }
              earnedDays += earned;
              boostedDays += boosted; // Accumulate boosted days

              if (isWeekend || isHoliday || hoursForPay >= 3) {
                  presentDaysCount += 1;
              }
          }
    }); // End of monthlyRecords loop

    // Rule: Overtime CAP.
    // Earned Days cannot exceed Present Days count.
    earnedDays = Math.min(earnedDays, presentDaysCount);
    
    // Calculate Missing Days (Absences)
    const missingDays = [];
    const start = selectedMonth.clone().startOf("month");
    const end = selectedMonth.clone().endOf("month");
    
    let curr = start.clone();
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
    const workingDays = calculateWorkingDays(selectedMonth);
    const targetHours = workingDays * 8;
    const passedTargetHours = passedWorkingDays * 8;
    
    const leavesCount = monthlyRecords.filter(r => r.isLeave).length;
    const paidLeavesCount = monthlyRecords.filter(r => r.isLeave && r.leaveType === 'Paid').length;
    const totalLeaves = missingDays.length + zeroDays.length + leavesCount;

    // --- SALARY / NET EARNING DAYS CALCULATION ---
    // Fix: Use earnedDays (calculated in loop) to account for Half Days / Short Days
    // Logic: Earned Days (from Work) + Paid Leaves + Weekends (Paid)
    
    // --- SANDWICH LEAVE LOGIC ---
    const sandwichDays = [];
    let sandwichDeduction = 0;
    
    // Iterate through weekends in the month to count Weekends for Pay AND Check Sandwich
    let sCurr = start.clone();
    let unworkedWeekendCount = 0;

    while (sCurr.isSameOrBefore(end)) {
        const dayStr = sCurr.format("YYYY-MM-DD");
        if (sCurr.day() === 6 || sCurr.day() === 0) { // Weekend
             // Count for Pay if NOT WORKED (Prevent Double Count)
             if (!recordedDates.includes(dayStr)) {
                 unworkedWeekendCount++;
             }

             if (sCurr.day() === 6) { // Saturday
                 const saturday = sCurr;
                 const sunday = sCurr.add(1, 'day');
                 
                 const fridayStr = saturday.subtract(1, 'day').format("YYYY-MM-DD");
                 const mondayStr = saturday.add(2, 'day').format("YYYY-MM-DD");
                 
                 const isFriAbsent = missingDays.includes(fridayStr);
                 const isMonAbsent = missingDays.includes(mondayStr);
                 
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
        sCurr = sCurr.add(1, 'day');
    }
    
    // SANDWICH LOGIC ENABLED


    // --- HOLIDAY LOGIC ---
    let unworkedHolidayCount = 0;
    let hCurr = start.clone();
    while (hCurr.isSameOrBefore(end)) {
        const dayStr = hCurr.format("YYYY-MM-DD");
        const day = hCurr.day();
        const isWeekend = day === 0 || day === 6;
        if (!isWeekend && holidayDates.includes(dayStr)) {
            // Only count if NOT WORKED
            if (!recordedDates.includes(dayStr)) {
               unworkedHolidayCount++;
            }
        }
        hCurr = hCurr.add(1, 'day');
    }

    // Fix for "High Hours but Low Days" (Restored)
    let effectivelyEarnedDays = earnedDays;
    if (eligibleHours >= targetHours && workingDays > 0) {
        effectivelyEarnedDays = boostedDays;
    } else {
        // NEW: HOURS-BASED FALLBACK
        const shortage = Math.max(0, targetHours - eligibleHours);
        const shortageDays = shortage / 8;
        const hoursBasedDays = Math.max(0, workingDays - shortageDays);
        
        // Round to nearest 0.5 (Half Day)
        const snappedDays = Math.floor(hoursBasedDays * 2) / 2;

        if (snappedDays > effectivelyEarnedDays) {
            effectivelyEarnedDays = snappedDays;
        }
    }

    // Logic: Earned Days + Unworked Weekend + Unworked Holidays (minus sandwich) + Paid Leaves
    // This prevents double counting.
    let netEarningDays = effectivelyEarnedDays + unworkedWeekendCount + unworkedHolidayCount + paidLeavesCount - sandwichDeduction;

    // --- FINAL SALARY CAPPING ---
    // Rule: We deduct Unpaid Leaves from the max possible days.
    const actualAbsencesCount = (missingDays.length || 0) + (zeroDays.length || 0);
    let unpaidLeavesCount = (missingDays.length || 0) + (zeroDays.length || 0) + ((leavesCount || 0) - (paidLeavesCount || 0));

    if (eligibleHours >= targetHours && workingDays > 0) {
        unpaidLeavesCount = (actualAbsencesCount || 0) + ((leavesCount || 0) - (paidLeavesCount || 0));
    }
    
    // Max Payable = Total Days - Unpaid Leaves
    const maxPayableDays = selectedMonth.daysInMonth() - unpaidLeavesCount;
    netEarningDays = Math.min(netEarningDays, maxPayableDays);

    netEarningDays = Math.min(netEarningDays, selectedMonth.daysInMonth()); // Logical Cap
    if (netEarningDays < 0) netEarningDays = 0;

    return {
      workingDays,
      targetHours,
      actualHours,
      difference: eligibleHours - targetHours,
      eligibleHours,
      missingDays,
      shortDays, 
      totalLeaves,
      sandwichDays,
      passedWorkingDays,
      passedTargetHours,
      passedEligibleHours,
      passedDifference: passedEligibleHours - passedTargetHours,
      // Net Earning Days Logic
      netEarningDays: netEarningDays,
      daysInMonth: selectedMonth.daysInMonth()
    };
  };



  /* ================= RENDER HELPERS ================= */
  const renderPayrollStats = (payroll) => (
      <div style={{ 
          marginBottom: 16, 
          padding: 20, 
          background: darkMode ? "#1f1f1f" : "#fff", 
          borderRadius: 8,
          boxShadow: darkMode ? "0 2px 8px rgba(0,0,0,0.5)" : "0 2px 8px rgba(0,0,0,0.05)",
          border: darkMode ? "1px solid #303030" : "1px solid #f0f0f0"
      }}>
          <Row gutter={[16, 16]}>
              <Col xs={12} sm={3}><Statistic title="Working Days" value={payroll.workingDays} valueStyle={{ fontSize: 16, fontWeight: 500 }} /></Col>
              
              {/* NEW: Net Earning Days */}
              <Col xs={12} sm={4}>
                  <Statistic 
                    title="Net Earning Days" 
                    value={`${payroll.netEarningDays} / ${payroll.daysInMonth}`} 
                    valueStyle={{ fontSize: 16, fontWeight: "bold", color: "#52c41a" }} 
                  />
              </Col>

              <Col xs={12} sm={4}><Statistic title="Passed Days" value={payroll.passedWorkingDays} suffix={`/ ${payroll.workingDays}`} valueStyle={{ fontSize: 16, fontWeight: 500, color: "#722ed1" }} /></Col>
              
              <Col xs={12} sm={4}>
                  <Statistic 
                    title="Passed Hours" 
                    value={payroll.passedEligibleHours.toFixed(2)} 
                    suffix={`/ ${payroll.passedTargetHours}h`}
                    valueStyle={{ fontSize: 16, fontWeight: 500, color: "#1890ff" }} 
                    prefix={<ClockCircleOutlined />} 
                  />
              </Col>
              <Col xs={12} sm={4}>
                  <Statistic 
                    title="Monthly Hours" 
                    value={payroll.passedEligibleHours.toFixed(2)} 
                    suffix={`/ ${payroll.targetHours}h`}
                    valueStyle={{ fontSize: 16, fontWeight: 500, color: "#722ed1" }} 
                  />
              </Col>
              <Col xs={12} sm={4}>
                  <Statistic 
                    title="Time Check" 
                    value={Math.abs(payroll.passedDifference).toFixed(2) + "h"} 
                    prefix={payroll.passedDifference >= 0 ? <PlusOutlined /> : <></>} 
                    suffix={payroll.passedDifference >= 0 ? "Ahead" : "Behind"}
                    valueStyle={{ fontSize: 16, color: payroll.passedDifference < 0 ? "#ff4d4f" : "#52c41a", fontWeight: "bold" }} 
                  />
              </Col>

              <Col xs={12} sm={4}>
                  <Statistic 
                    title="Difference (Total)" 
                    value={payroll.difference.toFixed(2)} 
                    valueStyle={{ fontSize: 20, color: payroll.difference < 0 ? "#ff4d4f" : "#52c41a", fontWeight: "bold" }} 
                    prefix={payroll.difference > 0 ? <PlusOutlined /> : <></>} 
                  />
              </Col>
              <Col xs={12} sm={4}>
                  <Statistic 
                    title="Leaves" 
                    value={payroll.totalLeaves || 0} 
                    valueStyle={{ fontSize: 20, color: "#faad14", fontWeight: "bold" }} 
                  />
              </Col>
              {payroll.shortDays && payroll.shortDays.length > 0 && payroll.passedDifference < 0 && (
                <Col span={24} style={{ marginTop: 12, background: darkMode ? "rgba(250, 140, 22, 0.1)" : "#fff7e6", padding: 12, borderRadius: 6, border: "1px dashed #fa8c16" }}>
                    <div style={{ fontSize: 13, fontWeight: "bold", color: "#fa8c16", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                        <ClockCircleOutlined /> Short Days (Less than 8h) ({payroll.shortDays.length})
                    </div>
                    <div style={{ maxHeight: 150, overflowY: "auto", display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {payroll.shortDays.map(sd => (
                            <Tag key={sd.date} color="warning" style={{ fontSize: 14, padding: "4px 10px" }}>
                                {sd.date} ({(sd.dailyHours || 0).toFixed(2)}h) - {formatDuration(sd.shortage)}
                            </Tag>
                        ))}
                    </div>
                </Col>
              )}
              {payroll.missingDays && payroll.missingDays.length > 0 && (
                <Col span={24} style={{ marginTop: 12, background: darkMode ? "rgba(255, 77, 79, 0.1)" : "#fff1f0", padding: 12, borderRadius: 6, border: "1px dashed #ff4d4f" }}>
                    <div style={{ fontSize: 13, fontWeight: "bold", color: "#ff4d4f", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                        <ClockCircleOutlined /> Absences / Missing Workdays ({payroll.missingDays.length})
                    </div>
                    <div style={{ maxHeight: 150, overflowY: "auto", display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                        {payroll.missingDays.map(dateStr => (
                            <Tag key={dateStr} color="error" style={{ fontSize: 14, padding: "4px 10px" }}>{dateStr}</Tag>
                        ))}
                    </div>
                </Col>
              )}
          </Row>
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
  const openRequest = (record) => {
    setCurrentRecord(record);
    form.setFieldsValue({
      punchTimes: (record.punchTimes || []).join(", "),
      reason: "",
    });
    setEditOpen(true);
  };

  const handleRequestUpdate = async (values) => {
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

  /* ================= COMPUTED DATA ================= */
  const payroll = React.useMemo(() => getMonthlyPayroll(records), [records, selectedMonth, holidays]);
  
  
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

  /* ================= HIGHLIGHT LOGIC ================= */
  const toggleHighlight = async (record, timeVal) => {
    if (!timeVal) return;
    try {
      const currentHighlights = record.highlightedTimes || [];
      let newHighlights;
      if (currentHighlights.includes(timeVal)) {
        newHighlights = currentHighlights.filter(t => t !== timeVal);
      } else {
        newHighlights = [...currentHighlights, timeVal];
      }
      
      await updateDoc(doc(db, "punches", record.id), {
        highlightedTimes: newHighlights
      });
      message.success("Time highlight updated");
      fetchMyData(); 
    } catch (e) {
      console.error(e);
      message.error("Failed to update highlight");
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

        // Target & Shortfall
        // Weekends target is 0 unless manually overridden or logic changes?
        // Screenshot shows Weekends have "Total Hours" (meaning target) as 0:00:00.
        // And "Present Hours" as 0:00:00.
        // Normal days have 8:00:00.
        
        const targetHours = isWeekend ? 0 : 8;
        const shortfall = targetHours - dailyHours;
        const hoursShortBy = shortfall > 0 ? shortfall : 0;
        
        // Present Days
        // Logic: If working on a weekday or approved weekend? 
        // Screenshot shows "1" for Present Days on normal working days. "0" on Sunday/Saturday (even if absent).
        // If absent on Monday, it is "1" in Present Days? No, Screenshot Monday has "1" and Present Hours > 0.
        // Wait, screenshot shows Saturday/Sunday have "0" Present Days.
        // Present Days: Days with >= 3 hours (Half Day or Full Day)
        const presentDayCount = dailyHours >= 3 ? 1 : 0; 

        // Checks
        // Weekend Checks: 1 if it IS a weekend? Screenshot shows "1" for Sat/Sun.
        const weekendCheck = isWeekend ? 1 : 0;

        // Leave Check: Explicit Leave OR Low Hours (< 3) on a Weekday
        let isLowHoursLeave = false;
        if (!isWeekend && dailyHours < 3 && !r.isLeave) {
            isLowHoursLeave = true;
        }

        const leaveCheck = (r.isLeave || isLowHoursLeave) ? 1 : 0;
        
        return {
           ...r,
           fullDate: getDayOfWeek(r.date),
           sortedPunches,
           targetHoursFormatted: isWeekend ? "0:00:00" : "8:00:00",
           presentHoursFormatted: formatDuration(dailyHours),
           hoursShortByFormatted: formatDuration(hoursShortBy),
           presentDays: presentDayCount,
           leaveCheck: (r.isLeave || isLowHoursLeave) ? 1 : 0,
           daySwapOff: 0, // Placeholder
           weekendCheck,
           paidHolidays: 0, // Need to cross-check with holidays array if possible, but 'r' might not have it unless joined
           isWeekend
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
          
          return {
            id: `missing-${date}`,
            date: date,
            fullDate: getDayOfWeek(date),
            in1: "", out1: "", in2: "", out2: "", in3: "",
            targetHoursFormatted: isWeekend ? "0:00:00" : "8:00:00",
            presentHoursFormatted: "0:00:00",
            hoursShortByFormatted: isWeekend ? "0:00:00" : "8:00:00",
            presentDays: 0, // Absent
            leaveCheck: isWeekend ? 0 : 1, // Using 1 for Absent on Weekdays as requested ("show as Leave")
            daySwapOff: 0,
            weekendCheck: isWeekend ? 1 : 0,
            paidHolidays: 0,
            isMissing: true,
            isWeekend
          };
      });

      const combined = [...filtered, ...missing];
      
      // 4. Sort Ascending for the table (Screenshot usually shows chronological, but code was Descending. Let's make it Ascending based on screenshot)
      combined.sort((a, b) => {
        const dateA = dayjs(a.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        const dateB = dayjs(b.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        return dateA.valueOf() - dateB.valueOf();
      });
      
      return combined;
  }, [records, payroll, selectedMonth, userEmail]);

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
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => navigate("/upload")}
            >
              Upload CSV
            </Button>
            <Button icon={<MessageOutlined />} onClick={() => setChatOpen(true)}>Chat</Button>
            <Button danger icon={<LogoutOutlined />} onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>

        {/* PAYROLL STATS - Collapsible? Or verify if needed. Keeping it for now as it doesn't conflict with screenshot request directly, but table is key. */}
        {renderPayrollStats(payroll)}

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
      </div>
      <ChatDrawer 
        open={chatOpen} 
        onClose={() => setChatOpen(false)} 
        currentUserEmail={userEmail}
        currentUserName={currentUserName}
        selectedMonth={selectedMonth}
      />
    </ConfigProvider>
  );
}
