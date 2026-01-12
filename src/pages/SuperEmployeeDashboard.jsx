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
  Card,
  Tag,
  Space,
  DatePicker,
  Row,
  Col,
  Statistic,
  Grid,
  List // Added List
} from "antd";
import {
  ReloadOutlined,
  LogoutOutlined,
  EditOutlined,
  BulbOutlined,
  UploadOutlined,
  CheckOutlined,
  CloseOutlined,
  ClockCircleOutlined,
  PlusOutlined,
  MessageOutlined,
  DollarOutlined
} from "@ant-design/icons";
import { db, auth } from "../firebase";
import ChatDrawer from "../components/ChatDrawer";
import {
  collection,
  getDocs,
  query,
  where,
  updateDoc,
  doc,
  deleteDoc,
  getDoc,
  setDoc, // Added setDoc
  addDoc
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



export default function SuperEmployeeDashboard() {
  const [records, setRecords] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [currentRecord, setCurrentRecord] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [darkMode, setDarkMode] = useState(false);

  const [selectedMonth, setSelectedMonth] = useState(dayjs());
  const [chatOpen, setChatOpen] = useState(false);
  const [holidays, setHolidays] = useState([]);
  const [holidayModalOpen, setHolidayModalOpen] = useState(false); // Added State
  const [adjustments, setAdjustments] = useState({});
  const [employeeId, setEmployeeId] = useState(null);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [currentUserName, setCurrentUserName] = useState("");
  const [currentUserSalary, setCurrentUserSalary] = useState(0);
  const screens = Grid.useBreakpoint();

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

   const fetchHolidays = async () => {
    try {
      const snap = await getDocs(collection(db, "holidays"));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setHolidays(data);
    } catch {
      console.error("Failed to load holidays");
    }
  };
  
  const [joiningDate, setJoiningDate] = useState(null); // Added Joining Date

    useEffect(() => {
        const fetchEmpId = async () => {
            if (!userEmail) return;
            const q = query(collection(db, "employees"), where("email", "==", userEmail));
            const snap = await getDocs(q);
            if (!snap.empty) {
                const empData = snap.docs[0].data();
                setEmployeeId(empData.employeeId);
                setCurrentUserName(empData.firstName ? `${empData.firstName} ${empData.lastName || ''}` : empData.employee);
                if (empData.salary) setCurrentUserSalary(Number(empData.salary));
                if (empData.joiningDate) setJoiningDate(empData.joiningDate); // Set Joining Date
            }
        };
        fetchEmpId();
    }, [userEmail]);

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



  const [uploading, setUploading] = useState(false);

  const handleFileUpload = (file) => {
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
          // Normalize Date
          const d = dayjs(date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD", "MM-DD-YYYY", "D-MMM-YYYY"], false);
          if (d.isValid()) {
              date = d.format("YYYY-MM-DD");
          }

          if (!employeeId || !date) continue; // Skip incomplete

          const numberOfPunchesStr = getField(row, ["No. of Punches"]);
          const numberOfPunches = numberOfPunchesStr ? parseInt(numberOfPunchesStr, 10) : 0;
          const timeValue = getField(row, ["Time", "Times"]);
          const punchTimes = parseTimes(timeValue, numberOfPunches);
          const { inTime, outTime, totalHours } = calculateTimes(punchTimes);
          
          // Unique ID
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

          // CRITICAL: Filter Removed as per User Request
          try {
            await setDoc(doc(db, "punches", uniqueId), docData);
            successCount++;
          } catch (e) {
            console.error(e);
          }
        }
        setUploading(false);
        fetchMyData(); // Refresh list
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
  const getMonthlyPayroll = (employeeRecords) => {
    if (!selectedMonth) return { targetHours: 0, actualHours: 0, workingDays: 0, difference: 0, eligibleHours: 0, missingDays: [], totalLeaves: 0, passedWorkingDays: 0, passedTargetHours: 0, passedEligibleHours: 0 };
    
    // Prepare Holidays
    const holidayDates = holidays.map(h => h.date);
    DEFAULT_HOLIDAYS.forEach(d => { if(!holidayDates.includes(d)) holidayDates.push(d) });
    
    // Filter records for selected month
    const rawMonthlyRecords = employeeRecords.filter(r => {
        if (!r.date) return false;
        const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD", "MM-DD-YYYY", "D-MMM-YYYY"], false);
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
    const zeroDays = []; // NEW
    let earnedDays = 0;
    let presentDaysCount = 0;
    const today = dayjs();
    let boostedDays = 0; // NEW: To track earned days if we allow boosting short days

    

    const currentMonthAdj = adjustments[selectedMonth.format("YYYY-MM")] || { grantedLeaves: 0, grantedHours: 0, grantedShortageDates: [] };
    
    monthlyRecords.forEach(r => {
      let dailyHours = 0;
      if (r.punchTimes && r.punchTimes.length > 0) {
          const { totalHours } = calculateTimes(r.punchTimes);
          if (totalHours) {
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

      // Apply Granted Shortage (Virtual)
      const isGranted = (currentMonthAdj.grantedShortageDates || []).includes(r.date);
      if (d.isValid() && isGranted && dailyHours < 8 && !r.isLeave) {
           const shortage = 8 - dailyHours;
           if (shortage > 0) {
              dailyHours += shortage;
              // Update actualHours which was already added, so add the diff
              actualHours += shortage; 
           }
      }
      if(d.isValid()) {
          recordedDates.push(d.format("YYYY-MM-DD"));
          const isWeekend = d.isValid() && (d.day() === 0 || d.day() === 6);
          const isHoliday = d.isValid() && holidayDates.includes(d.format("YYYY-MM-DD"));

          // Rules Check - Removed 3h threshold to match AdminDashboard
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

          if (!isWeekend && !r.isLeave && dailyHours < 8) {
              const normalizedDate = d.format("YYYY-MM-DD");
              if (dailyHours < 3) {
                  zeroDays.push({ date: normalizedDate, dailyHours, shortage: 8 - dailyHours });
              } else {
                  shortDays.push({ date: normalizedDate, dailyHours, shortage: 8 - dailyHours });
              }
          }

          // Salary Calculation Logic Integration (Calculated per record loop)
          let hoursForPay = dailyHours;
          
          // Calculate Worked Days (Discrete Logic)
          // SPECIAL RULE: Weekends and Holidays always give 1.0 credit if worked/recorded
          let earned = 0;
          if (isWeekend || isHoliday) {
              earned = 1;
          } else {
              if (hoursForPay >= 8) {
                  earned = 1;
              } else if (hoursForPay >= 3) {
                  earned = 0.5;
              }
          }
          earnedDays += earned;
       
          if (isWeekend || isHoliday || hoursForPay >= 3) {
              presentDaysCount++;
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
 // NEW

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

        if (!isFuture) {
            if (!isWeekend && !isHoliday && !recordedDates.includes(dayStr)) {
                missingDays.push(dayStr);
            }
        }
        curr = curr.add(1, "day");
    }

    missingDays.sort();

    // Calculate Target
    const workingDays = calculateWorkingDays(selectedMonth, joiningDate); // Pass joiningDate
    const targetHours = workingDays * 8;
    const passedTargetHours = passedWorkingDays * 8;
    
    const leavesCount = monthlyRecords.filter(r => r.isLeave).length;
    const paidLeavesCount = monthlyRecords.filter(r => r.isLeave && r.leaveType === 'Paid').length;
    const totalLeaves = missingDays.length + zeroDays.length + leavesCount;

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

    // --- SALARY CALCULATION (Synced with Admin) ---
    // Rule: Earned Days + Unworked Weekend + Unworked Holidays - Sandwich Deductions + Paid Leaves
    
    // Fix for "High Hours but Low Days"
    let effectivelyEarnedDays = earnedDays;
    
    // STRICT LOGIC RESTORED:
    // 1 Full Day = 1.0
    // 1 Half Day = 0.5
    // No boosting. Discrepancy is handled by straight sum.

    // Rule: Overtime CAP.
    effectivelyEarnedDays = Math.min(effectivelyEarnedDays, presentDaysCount);

    // New Formula: (Present Days + Unworked Weekends + Unworked Holidays)
    let daysForPay = effectivelyEarnedDays + unworkedWeekendCount + unworkedHolidayCount;
    
    // ADJUST FOR SANDWICH
    daysForPay -= sandwichDeduction;

    // APPLY GRANTED LEAVES (User Adjustment)
    daysForPay += paidLeavesCount;

    // Calculate Billable Days (Denominator)
    const fixedDaysBasis = 30;
    const monthlySalary = (currentUserSalary && currentUserSalary > 0) ? currentUserSalary : 30000;
    const dailyRate = monthlySalary / fixedDaysBasis;
    
    const totalDaysInMonth = selectedMonth.daysInMonth();
    let unpaidDays = totalDaysInMonth - daysForPay;
    if (unpaidDays < 0) unpaidDays = 0;
    
    let payableSalary = monthlySalary - (unpaidDays * dailyRate);
    
    // Incentive
    const incentiveAmount = incentives.reduce((sum, inc) => sum + (Number(inc.amount) || 0), 0);
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
      zeroDays, // Export for UI
      totalLeaves: (missingDays.length + zeroDays.length + leavesCount) - paidLeavesCount,
      sandwichDays, 
      passedWorkingDays,
      passedTargetHours,
      passedEligibleHours,
      passedDifference: passedEligibleHours - passedTargetHours,
      // Salary specific exports
      payableSalary: Math.round(payableSalary), 
      monthlySalary,
      incentiveAmount: 0, 
      grantedLeaves: paidLeavesCount,
      grantedHours: currentMonthAdj.grantedHours || 0,
      grantedShortageDates: currentMonthAdj.grantedShortageDates || [],
      // Net Earning Days Logic
      netEarningDays: daysForPay,
      daysInMonth: selectedMonth.daysInMonth()
    };
  };

  /* ================= FETCH DATA ================= */
  const fetchMyData = React.useCallback(async () => {
    setLoading(true);
    try {
      const startOfMonth = selectedMonth.startOf('month').format('YYYY-MM-DD');
      const endOfMonth = selectedMonth.endOf('month').format('YYYY-MM-DD');

      const q = query(
        collection(db, "punches"),
        where("email", "==", userEmail),
        where("date", ">=", startOfMonth),
        where("date", "<=", endOfMonth)
      );
      const snap = await getDocs(q);
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      
      // Sort Descending
      data.sort((a, b) => {
        const dateA = dayjs(a.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        const dateB = dayjs(b.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        if (!dateA.isValid()) return 1; 
        if (!dateB.isValid()) return -1;
        return dateB.valueOf() - dateA.valueOf();
      });
      
      setRecords(data);
    } catch {
      message.error("Failed to fetch data");
    }
    setLoading(false);
  }, [userEmail, selectedMonth]); // Added selectedMonth dependency

  const fetchRequests = React.useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, "requests"));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      
      data.sort((a, b) => {
        const dateA = dayjs(a.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        const dateB = dayjs(b.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        if (!dateA.isValid()) return 1; 
        if (!dateB.isValid()) return -1;
        return dateB.valueOf() - dateA.valueOf();
      });

      // Filter requests by user? The original code didn't seems to filter requests by user, 
      // but logic suggests we should. However, sticking to optimization:
      // Assuming 'requests' collection is small or irrelevant to the Quota issue compared to punches.
      setRequests(data);
    } catch {
      console.error("Failed to fetch requests");
    }
  }, []);

  useEffect(() => {
    if (userEmail) {
      fetchMyData();
      fetchRequests();
      fetchHolidays();
    }
  }, [userEmail, fetchMyData, fetchRequests]); // fetchMyData now depends on selectedMonth, so this triggers on month change

  // Render helper to avoid duplication
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
              <Col xs={12} sm={3}>
                  <Statistic title="Working Days" value={payroll.workingDays} valueStyle={{ fontSize: 16, fontWeight: 600 }} />
              </Col>
              <Col xs={12} sm={3}>
                  <Statistic 
                    title="Net Earned" 
                    value={payroll.netEarningDays} 
                    suffix={`/ ${payroll.daysInMonth}`}
                    valueStyle={{ fontSize: 16, fontWeight: 600, color: "#52c41a" }} 
                  />
              </Col>
              <Col xs={12} sm={3}>
                  <Statistic 
                    title="Passed Days" 
                    value={payroll.passedWorkingDays} 
                    suffix={`/ ${payroll.workingDays}`}
                    valueStyle={{ fontSize: 16, fontWeight: 600, color: "#722ed1" }} 
                  />
              </Col>
              <Col xs={12} sm={3}>
                   <Statistic 
                    title="Leaves" 
                    value={Math.max(0, payroll.totalLeaves)} 
                    valueStyle={{ fontSize: 16, color: (payroll.paidLeavesCount > 0) ? "#52c41a" : "#faad14", fontWeight: 600 }} 
                    suffix={payroll.paidLeavesCount > 0 ? <span style={{fontSize:11, color:'#888', marginLeft:5}}>(-{payroll.paidLeavesCount} Pd)</span> : null}
                  />
              </Col>
              <Col xs={12} sm={4}>
                  <Statistic 
                    title="Present Hours" 
                    value={payroll.passedEligibleHours.toFixed(2)} 
                    suffix={<span style={{fontSize: 12, color: '#888'}}>/ {payroll.targetHours}h</span>}
                    valueStyle={{ fontSize: 16, fontWeight: 600, color: "#1890ff" }} 
                  />
              </Col>
              <Col xs={12} sm={4}>
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

                  {/* Short Days */}
                  {payroll.shortDays && payroll.shortDays.length > 0 && (
                    <Col xs={24} md={12} lg={8}>
                        <div style={{ marginBottom: 6, color: "#fa8c16", fontWeight: 600, fontSize: 13 }}>
                            Short Days ({payroll.shortDays.length})
                        </div>
                        <div style={{ maxHeight: 200, overflowY: "auto" }}>
                            {payroll.shortDays.map(sd => (
                                <div key={sd.date} style={{ marginBottom: 4, padding: "4px 8px", border: "1px solid #fa8c16", borderRadius: 4, fontSize: 12, display: 'flex', justifyContent: 'space-between' }}>
                                    <span>{sd.date} ({sd.dailyHours.toFixed(2)}h)</span>
                                    <span style={{ color: "#fa8c16" }}>- {formatDuration(sd.shortage)}</span>
                                </div>
                            ))}
                        </div>
                    </Col>
                  )}

                  {/* Low Hours */}
                  {payroll.zeroDays && payroll.zeroDays.length > 0 && (
                    <Col xs={24} md={12} lg={8}>
                        <div style={{ marginBottom: 6, color: "#cf1322", fontWeight: 600, fontSize: 13 }}>
                            Low Hours ({payroll.zeroDays.length})
                        </div>
                        <div style={{ maxHeight: 200, overflowY: "auto" }}>
                            {payroll.zeroDays.map(sd => (
                                <div key={sd.date} style={{ marginBottom: 4, padding: "4px 8px", border: "1px solid #cf1322", borderRadius: 4, fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>{sd.date} ({sd.dailyHours.toFixed(2)}h)</span>
                                    <Button type="primary" size="small" onClick={() => openRequestModal(sd.date, 'Missing Entry Correction')} style={{height: 22, fontSize: 11}}>Request</Button>
                                </div>
                            ))}
                        </div>
                    </Col>
                  )}

                  {/* Missing Days */}
                  {payroll.missingDays && payroll.missingDays.length > 0 && (
                    <Col xs={24} md={12} lg={8}>
                        <div style={{ marginBottom: 6, color: "#ff4d4f", fontWeight: 600, fontSize: 13 }}>
                            Absences ({payroll.missingDays.length})
                        </div>
                        <div style={{ maxHeight: 200, overflowY: "auto" }}>
                            {payroll.missingDays.map(dateStr => (
                                <div key={dateStr} style={{ marginBottom: 4, padding: "4px 8px", border: "1px solid #ff4d4f", borderRadius: 4, fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>{dateStr}</span>
                                </div>
                            ))}
                        </div>
                    </Col>
                  )}
              </Row>
          )}
      </div>
  );

  /* ================= LOGOUT ================= */
  const handleLogout = async () => {
    await signOut(auth);
    navigate("/");
  };

  /* ================= HELPERS ================= */
  /* ================= HELPERS ================= */
  const calculateTimes = (times) => {
  if (!Array.isArray(times) || times.length < 2) {
    return { inTime: "", outTime: "", totalHours: "0:00" };
  }

  // Clean only — DO NOT sort (sorting breaks IN/OUT pairing)
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

 
  /* ================= EDIT (Self) ================= */
  const openEdit = (record) => {
    setCurrentRecord(record);
    form.setFieldsValue({
      inTime: record.inTime,
      outTime: record.outTime,
      punchTimes: (record.punchTimes || []).join(", "),
    });
    setEditOpen(true);
  };

  const handleUpdate = async (values) => {
    // Make sure we calculate from the *Punch Times*, not just assume manual input is correct
    const punchTimes = values.punchTimes.split(",").map((t) => t.trim()).filter(Boolean);
    const { inTime, outTime, totalHours } = calculateTimes(punchTimes);

    // Validate if calculation worked (simple check)
    if (!inTime || !outTime) {
         message.error("Invalid punch times format");
         return;
    }

    const [inH, inM] = inTime.split(":").map(Number);
    const [outH, outM] = outTime.split(":").map(Number);
    const minutes = outH * 60 + outM - (inH * 60 + inM);

    if (minutes < 0) {
      message.error("Calculated Out Time is before In Time");
      return;
    }

    await updateDoc(doc(db, "punches", currentRecord.id), {
      inTime,
      outTime,
      punchTimes,
      numberOfPunches: punchTimes.length,
      hours: totalHours,
      isEdited: true
    });

    message.success("Punch updated (times auto-calculated)");
    setEditOpen(false);
    fetchMyData();
  };

  /* ================= REQUESTS ================= */
  const handleApproveRequest = async (req) => {
    try {
      if (req.punchId) {
          // 1. Standard Punch Update Request (Has ID and Times)
          await updateDoc(doc(db, "punches", req.punchId), {
            inTime: req.inTime,
            outTime: req.outTime,
            punchTimes: req.punchTimes,
            numberOfPunches: req.numberOfPunches,
            hours: req.hours,
            isEdited: true
          });
          message.success("Record updated successfully");

      } else if (req.type === 'Leave Request') {
          // 2. Leave Request (Create/Update Punch as Leave)
          // Find existing punch for this date/email to avoid duplicates
          const q = query(
            collection(db, "punches"), 
            where("email", "==", req.email), 
            where("date", "==", req.date)
          );
          const snap = await getDocs(q);
          
          if (!snap.empty) {
              // Update existing
              await updateDoc(doc(db, "punches", snap.docs[0].id), {
                 isLeave: true,
                 leaveType: 'Unpaid', // Default to Unpaid, Admin can change
                 isEdited: true
              });
          } else {
              // Create new Leave Record
              await addDoc(collection(db, "punches"), {
                  email: req.email,
                  date: req.date,
                  isLeave: true,
                  leaveType: 'Unpaid',
                  punchTimes: [],
                  hours: "0:00",
                  employeeId: req.employeeId || "",
                  firstName: req.employeeName || "", 
                  isEdited: true
              });
          }
          message.success("Leave marked for " + req.date);

      } else {
          // 3. Generic Request (Missing Entry etc.) with NO data
          // We cannot auto-update data because we don't know what the times should be.
          // Just acknowledge and remove the request.
          message.info("Request approved. Please manually update the record if needed.");
      }

      // Delete the request
      await deleteDoc(doc(db, "requests", req.id));
      fetchRequests();
      
      // If we updated our own record, refresh self data
      if (req.email === userEmail) fetchMyData();
      
    } catch (e) {
      console.error(e);
      message.error("Failed to approve request: " + e.message);
    }
  };

  const handleRejectRequest = async (id) => {
    try {
      await deleteDoc(doc(db, "requests", id));
      message.success("Request rejected");
      fetchRequests();
    } catch {
      message.error("Failed to reject request");
    }
  };


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

  const submitDirectRequest = async () => {
       if (!requestReason) {
           message.error("Please provide a reason");
           return;
       }
       try {
           const empQ = query(collection(db, "employees"), where("email", "==", userEmail));
           const empSnap = await getDocs(empQ);
           let empId = "";
           let empName = "";
           if (!empSnap.empty) {
               empId = empSnap.docs[0].data().employeeId;
               empName = empSnap.docs[0].data().firstName;
           }

           await addDoc(collection(db, "requests"), {
              email: userEmail,
              date: requestDate,
              type: requestType, // 'Leave Request' or 'Missing Entry Correction'
              reason: requestReason,
              status: "pending",
              createdAt: new Date().toISOString(),
              employeeId: empId,
              employeeName: empName || userEmail
           });
           message.success("Request sent");
           setRequestModalOpen(false);
       } catch (e) {
           console.error(e);
           message.error("Failed to send request");
       }
  };

  /* ================= COMPUTED DATA ================= */
  const payroll = React.useMemo(() => getMonthlyPayroll(records), [records, selectedMonth, holidays, joiningDate]);
  

  const dataSource = React.useMemo(() => {
      // 1. Process existing records
      const processedRecords = records.map(r => {
        const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        const dayOfWeekIndex = d.day(); // 0=Sun, 6=Sat
        const isWeekend = dayOfWeekIndex === 0 || dayOfWeekIndex === 6;
        
        // Check if it is a holiday
        const holidayObj = holidays.find(h => h.date === r.date);
        const holidayName = holidayObj ? holidayObj.name : null;

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
        
        const presentDayCount = dailyHours >= 3 ? 1 : 0; 
        const weekendCheck = isWeekend ? 1 : 0;

        let isLowHoursLeave = false;
        if (!isWeekend && dailyHours < 3 && !r.isLeave) {
            isLowHoursLeave = true;
        }

        return {
           ...r,
           fullDate: getDayOfWeek(r.date) + (holidayName ? ` - ${holidayName}` : ""),
           sortedPunches,
           targetHoursFormatted: isWeekend ? "0:00:00" : "8:00:00",
           presentHoursFormatted: formatDuration(dailyHours),
           hoursShortByFormatted: formatDuration(hoursShortBy),
           presentDays: presentDayCount,
           leaveCheck: (r.isLeave || isLowHoursLeave) ? 1 : 0,
           daySwapOff: 0, 
           weekendCheck,
           paidHolidays: holidayName ? 1 : 0,
           isWeekend,
           isHolidayRow: !!holidayName
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
            render: (t, r) => <span style={(r.highlightedTimes || []).includes(t) && t ? { background: '#fffb8f', fontWeight: 'bold', padding: '2px 4px', borderRadius: 4, color: 'black' } : {}}>{t}</span> 
        });
        punchCols.push({
            title: `Out ${i+1}`,
            dataIndex: ["sortedPunches", i*2+1],
            width: 100,
            align: "center",
            onCell: (record) => ({ onDoubleClick: () => record.sortedPunches && toggleHighlight(record, record.sortedPunches[i*2+1]) }),
            render: (t, r) => <span style={(r.highlightedTimes || []).includes(t) && t ? { background: '#fffb8f', fontWeight: 'bold', padding: '2px 4px', borderRadius: 4, color: 'black' } : {}}>{t}</span>
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
              <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(r)}>
              Edit
              </Button>
          );
        },
      },
    ];
  }, [maxPairs, toggleHighlight, openEdit]);

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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 16,
            flexWrap: "wrap",
            gap: 16
          }}
        >
           <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
               <h2 style={{ color: darkMode ? "#fff" : "#000", margin: 0 }}>
                   Super Employee Dashboard {currentUserName && <span style={{fontSize:'0.8em', opacity:0.7}}>({currentUserName})</span>}
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
            <Button icon={<ReloadOutlined />} onClick={() => { fetchMyData(); fetchRequests(); fetchHolidays(); }}>
              Refresh
            </Button>
            <Button icon={<MessageOutlined />} onClick={() => setChatOpen(true)}>Chat</Button>

            {/* Upload Page Button Inline - Same as Admin */}
            <Upload beforeUpload={handleFileUpload} showUploadList={false} accept=".csv">
                <Button type="primary" icon={<UploadOutlined />} loading={uploading}>Upload CSV</Button>
            </Upload>
            <Button danger icon={<LogoutOutlined />} onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>

        {/* PAYROLL STATS */}
        {renderPayrollStats(payroll)}

        {/* REQUESTS SECTION */}
        {requests.length > 0 && (
          <Card 
            title="Pending Requests" 
            style={{ marginBottom: 24, background: darkMode ? DARK_CARD : "#fff" }}
            bodyStyle={{ padding: 0 }}
          >
             <Table
                dataSource={requests}
                rowKey="id"
                pagination={false}
                columns={[
                  { title: "Employee", dataIndex: "email" },
                  { title: "Date", dataIndex: "date" },
                  { title: "Requested In", dataIndex: "inTime", render: (t, r) => <Space><Tag>New: {t}</Tag><Tag color="red">Old: {r.originalInTime}</Tag></Space> },
                  { title: "Requested Out", dataIndex: "outTime", render: (t, r) => <Space><Tag>New: {t}</Tag><Tag color="red">Old: {r.originalOutTime}</Tag></Space> },
                  { title: "Reason", dataIndex: "reason" },
                  { 
                    title: "Action", 
                    render: (_, r) => (
                      <Space>
                        <Button type="primary" size="small" icon={<CheckOutlined />} onClick={() => handleApproveRequest(r)}>Approve</Button>
                        <Button danger size="small" icon={<CloseOutlined />} onClick={() => handleRejectRequest(r.id)}>Reject</Button>
                      </Space>
                    ) 
                  }
                ]}
             />
          </Card>
        )}

        {/* MY RECORDS */}
        <Card title="My Punch Records" bordered={false} style={{ background: darkMode ? DARK_CARD : "#fff" }}>
            {records.length === 0 ? (
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
                    if (record.isWeekend) return darkMode ? "dark-weekend-row" : "light-weekend-row";
                    return "";
                }}
                onRow={(record) => {
                    let bg = "";
                    if (record.isMissing) {
                        bg = darkMode ? "rgba(255, 77, 79, 0.1)" : "#ffeae8";
                    } else if (record.isLeave) {
                       if (record.leaveType === 'Paid') bg = darkMode ? "rgba(183, 235, 143, 0.15)" : "#f6ffed";
                       else bg = darkMode ? "#333" : "#fafafa";
                    } else if (record.isWeekend) {
                       bg = darkMode ? "rgba(76, 175, 80, 0.15)" : "#e6ffec";
                    }
                    if(bg) return { style: { background: bg } };
                    return {};
                }}
                style={{
                background: darkMode ? DARK_CARD : "#fff",
                }}
            />
            )}
        </Card>

        {/* EDIT MODAL */}
        <Modal
          open={editOpen}
          title={`Edit Punch - ${currentRecord?.date}`}
          footer={null}
          onCancel={() => setEditOpen(false)}
          styles={{
            content: {
              background: darkMode ? DARK_CARD : "#fff",
            },
          }}
        >
          <Form layout="vertical" form={form} onFinish={handleUpdate}>
            <Form.Item name="inTime" label="In Time" required>
              <Input />
            </Form.Item>
            <Form.Item name="outTime" label="Out Time" required>
              <Input />
            </Form.Item>
            <Form.Item name="punchTimes" label="Punch Times" required>
              <Input />
            </Form.Item>
            <div style={{ textAlign: "right" }}>
              <Button onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button
                type="primary"
                htmlType="submit"
                style={{ marginLeft: 8 }}
              >
                Save
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

    </ConfigProvider>
  );
}
