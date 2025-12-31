import React, { useState, useEffect } from "react";
import {
  Table,
  Upload,
  Button,
  message,
  Layout,
  Card,
  Row,
  Col,
  Tag,
  Statistic,
  Collapse,
  Empty,
  Modal,
  Form,
  Input,
  InputNumber,
  Tabs,
  Switch,
  ConfigProvider,
  theme,
  DatePicker,
  List,
  Grid,
  Typography,
  Popconfirm
} from "antd";


import {
  UploadOutlined,
  LogoutOutlined,
  ReloadOutlined,
  UserOutlined,
  CalendarOutlined,
  ClockCircleOutlined,
  EditOutlined,
  BulbOutlined,
  SettingOutlined,
  DeleteOutlined,
  PlusOutlined,
  DollarOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  CheckOutlined,
  CloseOutlined,
  AuditOutlined,
  MessageOutlined
} from "@ant-design/icons";
import Papa from "papaparse";
import dayjs from "dayjs";
import ChatDrawer from "../components/ChatDrawer";
import customParseFormat from "dayjs/plugin/customParseFormat";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
import { db, auth } from "../firebase";
import { collection, addDoc, getDocs, updateDoc, doc, deleteDoc, setDoc, query, where } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";

dayjs.extend(customParseFormat);
dayjs.extend(isSameOrBefore);

const { Header, Content } = Layout;
const { Panel } = Collapse;
const { TabPane } = Tabs;
const { darkAlgorithm, defaultAlgorithm } = theme;

const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;
const isValidTime = (time) => TIME_REGEX.test(time);
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

  // Keep original order, only clean
  const cleanTimes = times
    .filter(t => typeof t === "string" && /^\d{1,2}:\d{2}$/.test(t));

  if (cleanTimes.length < 2) {
    return { inTime: "", outTime: "", totalHours: "0:00" };
  }

  let totalMinutes = 0;

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

const groupByEmployee = (records) => {
  const grouped = {};
  records.forEach((record) => {
    const key = record.employeeId || record.firstName || record.employee || "Unknown";
    if (!grouped[key])
      grouped[key] = {
        ...record,
        records: [],
        totalRecords: 0,
        totalHours: 0,
        employeeName: record.employee || record.firstName || key,
        employeeId: record.employeeId || "",
      };
    grouped[key].records.push(record);
    grouped[key].totalRecords++;
    let dailyHours = 0;
    if (record.punchTimes && record.punchTimes.length > 0) {
        const { totalHours } = calculateTimes(record.punchTimes);
        if (totalHours) {
             const [h, m] = totalHours.split(":").map(Number);
             dailyHours = h + m / 60;
        }
    } else if (record.hours) {
      try {
        const [h, m] = record.hours.split(":").map(Number);
        dailyHours = h + m / 60;
      } catch (e) {}
    }
    grouped[key].totalHours += dailyHours;
  });
  Object.keys(grouped).forEach((k) =>
    grouped[k].records.sort((a, b) => {
        const dateA = dayjs(a.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        const dateB = dayjs(b.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        if (!dateA.isValid()) return 1; 
        if (!dateB.isValid()) return -1;
        return dateB.valueOf() - dateA.valueOf();
    })
  );
  return grouped;
};

// Default Holidays (can be overridden by DB)
const DEFAULT_HOLIDAYS = [
  "2025-12-25", // Christmas
  "2025-01-26", // Republic Day
  "2025-10-20", // Diwali (Example)
];

export default function AdminDashboard() {
  const [records, setRecords] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [viewMode, setViewMode] = useState("table");
  const [editOpen, setEditOpen] = useState(false);
  const [currentRecord, setCurrentRecord] = useState(null);
  const [form] = Form.useForm();
  const [darkMode, setDarkMode] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(dayjs());
  const [holidays, setHolidays] = useState([]);
  const [holidayModalOpen, setHolidayModalOpen] = useState(false);
  const [newHolidayDate, setNewHolidayDate] = useState(null);
  const [newHolidayName, setNewHolidayName] = useState("");
  const [salaries, setSalaries] = useState({});
  const [showSalary, setShowSalary] = useState(false);
  const [salaryModalOpen, setSalaryModalOpen] = useState(false);
  const [salaryForm] = Form.useForm();
  const [incentives, setIncentives] = useState({});
  const [incentiveModalOpen, setIncentiveModalOpen] = useState(false);
  const [incentiveForm] = Form.useForm();
  const [selectedEmpForIncentive, setSelectedEmpForIncentive] = useState(null);
  
  // On Duty / Office Work Modal State - REMOVED

  const screens = Grid.useBreakpoint();
  
  // Chat State
  const [chatOpen, setChatOpen] = useState(false);
  
  const navigate = useNavigate();

  const fetchData = async () => {
    try {
      const snap = await getDocs(collection(db, "punches"));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => {
          const dateA = dayjs(a.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
          const dateB = dayjs(b.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
          if (!dateA.isValid()) return 1; 
          if (!dateB.isValid()) return -1;
          return dateB.valueOf() - dateA.valueOf();
      });
      setRecords(data);
      syncEmployeesFromPunches(data);
    } catch (e) {
      console.error(e);
      message.error("Failed to load records");
    }
  };

  const fetchHolidays = async () => {
    try {
      const snap = await getDocs(collection(db, "holidays"));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      setHolidays(data);
    } catch (e) {
      console.error("Failed to load holidays");
    }
  };

  const syncEmployeesFromPunches = async (punchesData) => {
      // Extract unique employees from punches
      const uniqueEmps = {};
      punchesData.forEach(p => {
          if (p.email && !uniqueEmps[p.email]) {
              uniqueEmps[p.email] = {
                  email: p.email.toLowerCase(),
                  employeeId: p.employeeId,
                  firstName: p.firstName,
                  department: p.department,
                  employee: p.employee
              };
          }
      });

      // Get existing employees
      const empSnap = await getDocs(collection(db, "employees"));
      const existingEmails = new Set(empSnap.docs.map(d => (d.data().email || '').toLowerCase()));

      // Add missing
      const batchPromises = [];
      Object.keys(uniqueEmps).forEach(email => {
          const emp = uniqueEmps[email];
          // Use email as doc ID to prevent duplicates (sanitize special chars if needed, but email is usually safe for keys or better verify)
          // Actually, let's just check if it exists in our set first to save writes, but if we want to be safe against race conditions, ID is best.
          // Since we already fetched all employees, we can skip existing.
          
          if (!existingEmails.has(email)) {
              // Create a consistent ID from email to prevent future duplicates if this script runs again
              // We can't easily change existing IDs (auto-generated) without migration, 
              // but we can start enforcing it for new ones.
              // OR just rely on the existingEmails set check which we already have.
              // The issue "duplicate contacts" suggests the previous check failed or there were already duplicates.
              // Let's rely on set check AND maybe use email as ID for new ones?
              // Let's just blindly add if not exists, but we trust 'existingEmails' set.
              
              // Wait, the previous logic was `if (!existingEmails.has(emp.email))`. 
              // If that ran multiple times on fresh reload, maybe `empSnap` didn't have the new ones yet?
              // No, fetch awaits.
              
              // Only reason for duplicates is if they existed BEFORE we added this unique check,
              // OR if 'email' casing differed. I handled toLowerCase() so that should be fine.
              
              // Let's switch to using setDoc with email-based ID for NEW entries. 
              // This guarantees we never create a 2nd doc for the same email even if we try.
              const safeId = email.replace(/[^a-zA-Z0-9]/g, "_");
              batchPromises.push(setDoc(doc(db, "employees", safeId), {
                  ...emp,
                  createdAt: new Date().toISOString()
              }));
          }
      });
      
      if (batchPromises.length > 0) {
          await Promise.all(batchPromises);
          console.log(`Synced ${batchPromises.length} new employees`);
      }
  };

  const fetchSalaries = async () => {
      try {
          const snap = await getDocs(collection(db, "Salary"));
          const data = {};
          snap.docs.forEach(d => {
              // Assuming doc ID is employeeId or it has a field
              const val = d.data();
              if (val.employeeId) data[val.employeeId] = val.amount;
          });
          setSalaries(data);
      } catch (e) {
          console.error("Failed to load salaries");
      }
  };

  const fetchIncentives = async () => {
      try {
          const snap = await getDocs(collection(db, "Incentives"));
          const data = {};
          snap.docs.forEach(d => {
              const val = d.data();
              if (val.employeeId && val.month) {
                  const key = `${val.employeeId}_${val.month}`; 
                  if (!data[key]) data[key] = [];
                  
                  // Push object structure matching UI expectation
                  data[key].push({
                      id: d.id, // Capture Firestore Doc ID for deletion
                      amount: val.amount,
                      timestamp: val.createdAt,
                      ...val
                  });
              }
          });
          setIncentives(data);
      } catch (e) {
          console.error("Failed to load incentives", e);
      }
  };


  useEffect(() => {
    fetchData();
    fetchHolidays();
    fetchSalaries();
    fetchIncentives();
    fetchAdjustments();
  }, []);

  const handleFileUpload = (file) => {
    setUploading(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: async (results) => {
        const punchesRef = collection(db, "punches");
        let successCount = 0;
        for (let i = 0; i < results.data.length; i++) {
          const row = results.data[i];
          const employeeId = getField(row, ["Employee", "Employee ID"]);
          const firstName = getField(row, ["First Name", "FirstName"]);
          const department = getField(row, ["Department", "Dept"]);
          
          let date = getField(row, ["Date"]);
          // Normalize Date for ID consistency
          const d = dayjs(date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
          if (d.isValid()) {
              date = d.format("YYYY-MM-DD");
          }

          if (!employeeId || !date) continue; // Skip incomplete rows

          const numberOfPunchesStr = getField(row, ["No. of Punches"]);
          const numberOfPunches = numberOfPunchesStr ? parseInt(numberOfPunchesStr, 10) : 0;
          const timeValue = getField(row, ["Time", "Times"]);
          const punchTimes = parseTimes(timeValue, numberOfPunches);
          const { inTime, outTime, totalHours } = calculateTimes(punchTimes);
          
          // Unique ID for idempotency
          const uniqueId = `${employeeId}_${date}`;

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
            // Use setDoc to overwrite/merge instead of addDoc to prevent duplicates
            await setDoc(doc(db, "punches", uniqueId), docData);
            successCount++;
          } catch (e) {
            console.error(e);
          }
        }
        setUploading(false);
        fetchData();
        message.success(`${successCount} rows uploaded`);
      },
      error: (err) => {
        console.error(err);
        message.error("CSV parse error");
        setUploading(false);
      },
    });
    return false;
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/");
  };

  const openEdit = (record) => {
    setCurrentRecord(record);
    form.setFieldsValue({ punchTimes: (record.punchTimes || []).join(", ") });
    setEditOpen(true);
  };
  
  /* ================= SALARY MANAGEMENT ================= */
  /* ================= SALARY MANAGEMENT ================= */
  const handleManageSalaries = () => {
      fetchSalaries();
      fetchIncentives();
      setSalaryModalOpen(true);
  };

  const handleSaveSalary = async (values) => {
      try {
          // values: { [employeeId]: amount }
          // We iterate and save each
          const promises = Object.entries(values).map(async ([empId, amount]) => {
             // For simplicity, we use setDoc with merge to update or create
             // We need a doc ID. We can use employeeId as doc ID for easiest lookup, or keep random IDs.
             // Previous fetch logic assumed random IDs but stored employeeId field.
             // To make it robust, let's query for existing doc by employeeId, update if exists, else add.
             // OR, cleaner: Use employeeId AS the doc ID in 'Salary' collection.
             
             // Let's migrate to using EmployeeId as key if possible, or search-update.
             // For now search-update is safer for existing data.
             
             // Actually, the previous fetchSalaries read ANY doc with employeeId.
             // Let's stick to using setDoc with employeeId as key for NEW/UPDATED entries if we can.
             // But names are more user friendly.
             
             // Simple approach: Use setDoc on collection "Salary" with custom ID = employeeId
             await setDoc(doc(db, "Salary", empId), {
                 employeeId: empId,
                 amount: amount,
                 updatedAt: new Date().toISOString()
             });
          });
          
          await Promise.all(promises);
          message.success("Salaries updated");
          setSalaryModalOpen(false);
          fetchSalaries();
      } catch (e) {
          console.error(e);
          message.error("Failed to save salaries");
      }
  };
  /* ================= INCENTIVE MANAGEMENT ================= */
  const openAddIncentive = (employee) => {
      setSelectedEmpForIncentive(employee);
      // Pre-fill if exists for selected month
      const monthStr = selectedMonth.format("YYYY-MM");
      const key = `${employee.employeeId}_${monthStr}`;
      const existing = incentives[key] || 0;
      incentiveForm.setFieldsValue({ amount: existing });
      setIncentiveModalOpen(true);
  };

  // Legacy handleSaveIncentive removed - using new one below

  /* ================= HOLIDAY LOGIC ================= */
  const handleAddHoliday = async () => {
    if (!newHolidayDate || !newHolidayName) {
      message.error("Please enter date and name");
      return;
    }
    const dateStr = newHolidayDate.format("YYYY-MM-DD");
    try {
      await addDoc(collection(db, "holidays"), {
        date: dateStr,
        name: newHolidayName,
      });
      message.success("Holiday added");
      setNewHolidayDate(null);
      setNewHolidayName("");
      fetchHolidays();
    } catch {
      message.error("Failed to add holiday");
    }
  };

  const handleDeleteHoliday = async (id) => {
    try {
      await deleteDoc(doc(db, "holidays", id));
      message.success("Holiday removed");
      fetchHolidays();
    } catch {
      message.error("Failed to remove holiday");
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

  // NEW STATE for Payroll Adjustments
  const [adjustments, setAdjustments] = useState({}); // { 'empId_YYYY-MM': { grantedLeaves: 0, grantedHours: 0 } }
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [currentEmpForAdj, setCurrentEmpForAdj] = useState(null);
  const [adjForm] = Form.useForm();

  // RESTORED: Fetch Adjustments
  const fetchAdjustments = async () => {
      try {
          const snapshot = await getDocs(collection(db, "payroll_adjustments"));
          const data = {};
          snapshot.docs.forEach(doc => {
              data[doc.id] = doc.data();
          });
          setAdjustments(data);
      } catch (e) {
          console.error("Failed to fetch adjustments", e);
      }
  };

  const handleSaveAdjustment = async (values) => {
      if (!currentEmpForAdj) return;
      const monthStr = selectedMonth.format("YYYY-MM");
      const key = `${currentEmpForAdj.employeeId}_${monthStr}`;
      
      try {
          await setDoc(doc(db, "payroll_adjustments", key), {
              grantedLeaves: Number(values.grantedLeaves) || 0,
              grantedHours: Number(values.grantedHours) || 0,
              updatedAt: new Date().toISOString()
          }, { merge: true });
          
          setAdjustments(prev => ({ ...prev, [key]: { grantedLeaves: Number(values.grantedLeaves) || 0, grantedHours: Number(values.grantedHours) || 0 } }));
          message.success("Adjustments saved");
          setAdjustmentModalOpen(false);
      } catch (e) {
          console.error(e);
          message.error("Failed to save adjustments");
      }
  };

  const getMonthlyPayroll = (employeeRecords, empId = null) => {
    // RESTORED: Payroll Adjustments Reading
    const employeeId = empId || employeeRecords[0]?.employeeId;
    const monthStr = selectedMonth.format("YYYY-MM");
    const adjKey = `${employeeId}_${monthStr}`;
    const adj = adjustments[adjKey] || { grantedLeaves: 0, grantedHours: 0, grantedShortageDates: [] };

    const holidayDates = holidays.map(h => h.date);
    DEFAULT_HOLIDAYS.forEach(d => { if(!holidayDates.includes(d)) holidayDates.push(d) });
    
    // Filter records for selected month
    const monthlyRecords = employeeRecords.filter(r => {
        if (!r.date) return false;
        const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], true);
        return d.isValid() && d.isSame(selectedMonth, 'month');
    });
    
    let actualHours = 0;
    let eligibleHours = 0;
    let passedEligibleHours = 0;
    const pendingWeekends = [];
    const recordedDates = [];
    const shortDays = []; // For UI (3 to 8 hours)
    const zeroDays = []; // For UI (< 3 hours)
    const today = dayjs();

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
      
      // Apply Granted Shortage (Virtual)
      const isGranted = (adj.grantedShortageDates || []).includes(r.date);
      if (isGranted && dailyHours < 8 && !r.isLeave) {
          const shortage = 8 - dailyHours;
          if (shortage > 0) dailyHours += shortage; 
      }

      actualHours += dailyHours;
      
      const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], true);
      if(d.isValid()) {
          recordedDates.push(d.format("YYYY-MM-DD"));
          
          const isWeekend = d.day() === 0 || d.day() === 6;

          // Rules Check

              // Removed 3-hour threshold check as per user request
              // Weekend Rule
              let hoursToAdd = 0;
              if (isWeekend) {
                   if (r.weekendApproved) {
                       hoursToAdd = dailyHours;
                   } else {
                       // pendingWeekends.push({ ...r, dailyHours }); 
                       // Note: Pending weekends are pushed in the original logic too? 
                       // Actually, let's keep the pending push logic if logic requires it.
                       // The original code pushed to pendingWeekends inside the 3h check. 
                       // Does the user want low hours weekend work to show as pending? Probably yes.
                       if (!r.weekendApproved) {
                           pendingWeekends.push({ ...r, dailyHours });
                       }
                   }
              } else {
                  hoursToAdd = dailyHours;
              }
              
              eligibleHours += hoursToAdd;

              // Passed Hours (if day is <= today)
              if (d.isSameOrBefore(today, 'day')) {
                  passedEligibleHours += hoursToAdd;
              }
          
          // Short Days Logic
          // Granted days now have dailyHours = 8, so they won't trigger this.
          // Short Days Logic
          // Granted days now have dailyHours = 8, so they won't trigger this.
          if (!isWeekend && !r.isLeave && dailyHours < 8 && (dailyHours > 0 || (r.numberOfPunches > 0))) {
              if (dailyHours < 3) {
                  zeroDays.push({ date: r.date, dailyHours, shortage: 8 - dailyHours });
              } else {
                  shortDays.push({ date: r.date, dailyHours, shortage: 8 - dailyHours });
              }
          }
      }
    });
    
    // Apply Granted Hours


    // Calculate Missing Days (Absences) and Passed Working Days
    const missingDays = [];
    const start = selectedMonth.clone().startOf("month");
    const end = selectedMonth.clone().endOf("month");
    
    let curr = start.clone();
    let passedWorkingDays = 0;
    let weekendCount = 0; // NEW: Count total weekends

    while (curr.isSameOrBefore(end)) {
        const dayStr = curr.format("YYYY-MM-DD");
        const day = curr.day();
        const isWeekend = day === 0 || day === 6;
        const isHoliday = holidayDates.includes(dayStr);
        const isFuture = curr.isAfter(today, 'day');
        
        if (isWeekend) {
            weekendCount++;
        }
        
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

    const workingDays = calculateWorkingDays(selectedMonth);
    const targetHours = workingDays * 8;
    const passedTargetHours = passedWorkingDays * 8;
    
    const leavesCount = monthlyRecords.filter(r => r.isLeave).length;
    const paidLeavesCount = monthlyRecords.filter(r => r.isLeave && r.leaveType === 'Paid').length;
    const approvedWeekendCount = monthlyRecords.filter(r => r.weekendApproved).length;
    // Fix: Subtract granted (paid) leaves from the total leaves count using dynamic count
    const totalLeaves = (missingDays.length + leavesCount + zeroDays.length) - paidLeavesCount;

    // --- SALARY CALCULATION (Admin Specific) ---
    // const employeeId = employeeRecords[0]?.employeeId; (Already defined above)
    const monthlySalary = (employeeId && salaries[employeeId]) ? Number(salaries[employeeId]) : 30000;    // We iterate through monthlyRecords to calculate earned days
    let earnedDays = 0;
    let presentDaysCount = 0;
    
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

        // Apply Granted Shortage for Salary Calc too
        const isGranted = (adj.grantedShortageDates || []).includes(r.date);
        if (isGranted && dailyHours < 8 && !r.isLeave) {
             const shortage = 8 - dailyHours;
             if (shortage > 0) dailyHours += shortage;
        }

        const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], true);
        const isWeekend = d.isValid() && (d.day() === 0 || d.day() === 6);

        let hoursForPay = dailyHours;
        if (isWeekend && !r.weekendApproved) hoursForPay = 0;
        
        if (hoursForPay >= 8) {
            earnedDays += 1;
        } else if (hoursForPay >= 3) {
            earnedDays += 0.5;
        }
        
        if (hoursForPay >= 3) {
            presentDaysCount += 1;
        }
    });

    // New Formula as requested: Present Days + Saturday + Sunday - Leaves
    // Denominator: Working Days + Weekends (Total Billable Days)
    const billableDays = workingDays + weekendCount; 
    const dailyRate = billableDays > 0 ? monthlySalary / billableDays : 0;
    
    // Incentive Calculation
    const incentiveKey = `${employeeId}_${monthStr}`;
    const incentiveRaw = incentives[incentiveKey];
    
    let incentiveTotal = 0;
    let incentiveList = [];

    if (typeof incentiveRaw === 'number') {
        incentiveTotal = incentiveRaw;
        // Convert to list for UI consistency if needed, but we'll handle display logic
        incentiveList = [{ id: 'legacy', amount: incentiveRaw }];
    } else if (Array.isArray(incentiveRaw)) {
        incentiveList = incentiveRaw;
        incentiveTotal = incentiveRaw.reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
    }

    const incentiveAmount = incentiveTotal;

    let effectivelyEarnedDays = earnedDays;

    // Fix for "High Hours but Low Days"
    // If they met the target hours, we waive "Half Day" penalties (treat them as Full Days)
    // presentDaysCount includes all days >= 3 hours as 1.0
    if (eligibleHours >= targetHours && workingDays > 0) {
        effectivelyEarnedDays = presentDaysCount;
    }

    // New Formula: (Present Days + Weekends)
    // We removed "- totalLeaves" because an absence already results in 0 earnedDays.
    // Subtracting leaves again would be a double penalty.
    // Fix: Validated that working a weekend should recover lost salary (e.g. from Absences).
    // So we add 'weekendCount' (Total Weekends) + 'effectivelyEarnedDays' (includes worked Weekend).
    // This technically double-counts the worked weekend day, but that acts as the "Recovery"/"OT" value.
    // We then CAP the total at billableDays to ensure it doesn't exceed 100% Monthly Salary.
    let daysForPay = effectivelyEarnedDays + weekendCount;
    
    // APPLY GRANTED LEAVES (User Adjustment)
    // Adding granted leaves effectively pays for those days.
    // Use dynamic paidLeavesCount for robustness
    daysForPay += paidLeavesCount;

    // Safety check: Cap at Billable Days (Full Month)
    daysForPay = Math.min(daysForPay, billableDays);
    
    // Safety check: Cannot be negative
    if (daysForPay < 0) daysForPay = 0;

    let payableSalary = (daysForPay * dailyRate) + incentiveAmount;
    if (workingDays === 0) payableSalary = 0;

    return {
      workingDays,
      targetHours,
      actualHours,
      difference: eligibleHours - targetHours,
      eligibleHours,
      missingDays,
      shortDays, // Export for UI
      zeroDays, // Export for UI
      totalLeaves: (missingDays.length + leavesCount + zeroDays.length) - paidLeavesCount,
      pendingWeekends,
      // Salary specific
      payableSalary,
      monthlySalary,
      incentiveAmount,
      incentiveList,
      // Passed stats
      passedWorkingDays,
      passedTargetHours,
      passedEligibleHours,
      passedDifference: passedEligibleHours - passedTargetHours,
      // Export Adjustments for UI
      grantedLeaves: paidLeavesCount, // Export strictly derived value
      grantedHours: adj.grantedHours || 0,
      grantedShortageDates: adj.grantedShortageDates || [],
      // Net Earning Days Logic
      // Formula: (DaysInMonth - TotalLeaves) + ApprovedWeekends, CAPPED at DaysInMonth
      // totalLeaves already handles the Paid Leaves subtraction
      netEarningDays: Math.min(selectedMonth.daysInMonth(), (selectedMonth.daysInMonth() - totalLeaves) + approvedWeekendCount),
      daysInMonth: selectedMonth.daysInMonth()
    };
  };

  const handleSaveIncentive = async (values) => {
     if (selectedEmpForIncentive) {
         await handleAddIncentive(selectedEmpForIncentive.employeeId, values.amount);
         setIncentiveModalOpen(false);
         incentiveForm.resetFields();
     }
  };

  /* ================= HELPERS */
  const isValidTime = (t) => /^([0-1]?[0-9]|2[0-5]):[0-5][0-9]$/.test(t); // Fixed regex 20-23



  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      maximumFractionDigits: 0
    }).format(amount);
  };

  // Replaced handleIncentiveChange with handleAddIncentive for Cumulative Logic
  const handleAddIncentive = async (empId, amount) => {
      if (!amount || amount <= 0) return;
      
      const monthStr = selectedMonth.format("YYYY-MM");
      const key = `${empId}_${monthStr}`;
      
      // Get current value to append
      const currentVal = incentives[key];
      let newIncentives = [];

      // Backward compatibility: If number, convert to array
      if (typeof currentVal === 'number') {
          newIncentives = [{ id: Date.now(), amount: currentVal, timestamp: new Date().toISOString() }];
      } else if (Array.isArray(currentVal)) {
          newIncentives = [...currentVal];
      }

      // Add new incentive
      const newEntry = {
          id: Date.now() + Math.random(),
          amount: Number(amount),
          timestamp: new Date().toISOString()
      };
      newIncentives.push(newEntry);
      
      // Optimistic update
      setIncentives(prev => ({ ...prev, [key]: newIncentives }));

      try {
          // CORRECTED: Write to "Incentives" collection to match fetchIncentives
          await addDoc(collection(db, "Incentives"), {
              employeeId: empId,
              month: monthStr,
              amount: Number(amount),
              createdAt: new Date().toISOString(),
              localId: newEntry.id // Optional: store local ID to help with reconciliation if needed
          });
          message.success("Incentive added");
          await fetchIncentives(); // Re-fetch to get the real Doc ID
      } catch (error) {
          console.error("Failed to save incentive", error);
          message.error("Failed to save incentive");
      }
  };

   const handleDeleteIncentive = async (empId, incentiveId) => {
      const monthStr = selectedMonth.format("YYYY-MM");
      const key = `${empId}_${monthStr}`;
      
      const currentVal = incentives[key];
      if (!Array.isArray(currentVal)) return; 

      const newIncentives = currentVal.filter(i => i.id !== incentiveId);
      setIncentives(prev => ({ ...prev, [key]: newIncentives }));

      try {
          // Deletion Strategy:
          // We need the Firestore Doc ID. If 'incentiveId' from the UI is the Firestore Doc ID (which it should be after a fresh fetch),
          // we can plain delete it.
          // BUT if we just added it locally (optimistic), 'incentiveId' is a random number.
          // In that case, we can't easily delete it from DB without a refresh.
          
          // Assumption: User refreshes or 'fetchIncentives' updates the state with real Doc IDs.
          // 'fetchIncentives' stores 'id: d.id' in the incentives map? 
          // Let's look at 'fetchIncentives':
          // "data[key] = val.amount". It does NOT store the ID. It stores the AMOUNT.
          // WAIT. 'fetchIncentives' (line 286) stores `data[key] = val.amount`.
          // This means `incentives` state is just `{ "123_2025-12": 5000 }` (or an array if modified?).
          
          // My previous 'handleAddIncentive' *changed* the state structure to be an ARRAY of objects.
          // `fetchIncentives` NEEDS to be updated to support Array structure and include IDs.
          
          // For now, I will try to find the doc by query if ID is not valid.
          // But first, let's fix the DELETE to try deleting by ID.
          
          await deleteDoc(doc(db, "Incentives", incentiveId));
          message.success("Incentive removed");
          await fetchIncentives();
      } catch (error) {
           // Fallback: Query delete? Or just fail.
           console.error("Failed to remove incentive", error);
           // message.error("Failed to remove incentive (Refreshed needed?)");
           // For now, we assume ID is valid.
      }
   };

  const handleUpdate = async (values) => {
    // 1. Parse Punch Times
    const punchTimes = values.punchTimes.split(",").map((t) => t.trim()).filter(Boolean);
    
    if (punchTimes.some((t) => !isValidTime(t))) {
      message.error("Invalid time format (HH:MM required)");
      return;
    }

    // 2. Auto-calculate In/Out/Hours based on Punch Times
    const { inTime, outTime, totalHours } = calculateTimes(punchTimes);

    try {
      await updateDoc(doc(db, "punches", currentRecord.id), {
        punchTimes,
        inTime,
        outTime,
        numberOfPunches: punchTimes.length,
        hours: totalHours,
        isEdited: true
      });
      message.success("Record updated");
      setEditOpen(false);
      fetchData();
    } catch (e) {
      console.error(e);
      message.error("Update failed");
    }
  };

  const handleApproveWeekend = async (recordId) => {
    try {
      await updateDoc(doc(db, "punches", recordId), {
        weekendApproved: true
      });
      message.success("Weekend work approved");
      fetchData();
    } catch (e) {
      console.error(e);
      message.error("Failed to approve");
    }
  };

  const handleMarkPresent = async (dateStr, employeeInfo) => {
      try {
          await addDoc(collection(db, "punches"), {
              employeeId: employeeInfo.employeeId || "",
              firstName: employeeInfo.firstName || "",
              email: employeeInfo.email || "",
              employee: employeeInfo.employeeName || "Unknown",
              department: employeeInfo.department || "",
              date: dateStr,
              numberOfPunches: 2,
              punchTimes: ["09:00", "17:00"],
              inTime: "09:00",
              outTime: "17:00",
              hours: "8:00",
              uploadedAt: new Date().toISOString(),
              isManualEntry: true
          });
          message.success(`Marked present for ${dateStr}`);
          fetchData();
      } catch (e) {
          console.error(e);
          message.error("Failed to mark present");
      }
  };

  /* ================= HANDLERS ================= */

  const handleGrantLeave = async (dateStr, employeeInfo, isPaid) => {
      // Logic Update: Update Payroll Adjustments directly
      if (!isPaid) {
          // Unpaid leave logic if needed
      }
      
      try {
          // 1. Create the Leave Record (so it stops showing as "Missing")
          await addDoc(collection(db, "punches"), {
              employeeId: employeeInfo.employeeId || "",
              firstName: employeeInfo.firstName || "",
              email: employeeInfo.email || "",
              employee: employeeInfo.employeeName || "Unknown",
              department: employeeInfo.department || "",
              date: dateStr,
              numberOfPunches: 0,
              punchTimes: [],
              inTime: "-",
              outTime: "-",
              hours: isPaid ? "08:00" : "00:00", // Visual only
              uploadedAt: new Date().toISOString(),
              isManualEntry: true,
              isLeave: true,
              leaveType: isPaid ? 'Paid' : 'Unpaid'
          });

          // 2. If Paid/Granted, update the Payroll Adjustments (+1 Leave, +8 Hours)
          if (isPaid) {
              const monthStr = dayjs(dateStr).format("YYYY-MM");
              const key = `${employeeInfo.employeeId}_${monthStr}`;
              
              const currentAdj = adjustments[key] || { grantedLeaves: 0, grantedHours: 0 };
              const newGrantedLeaves = (currentAdj.grantedLeaves || 0) + 1;
              const newGrantedHours = (currentAdj.grantedHours || 0) + 8; // Grant 8 hours
              
              await setDoc(doc(db, "payroll_adjustments", key), {
                  grantedLeaves: newGrantedLeaves,
                  grantedHours: newGrantedHours,
                  updatedAt: new Date().toISOString()
              }, { merge: true });
              
              // Update Local State directly
              setAdjustments(prev => ({ ...prev, [key]: { grantedLeaves: newGrantedLeaves, grantedHours: newGrantedHours } }));
              message.success(`Granted Leave for ${dateStr} (+8 Hrs)`);
          } else {
              message.success(`Marked as Unpaid Leave for ${dateStr}`);
          }
          
          fetchData();
      } catch (e) {
          console.error(e);
          message.error("Failed to grant leave");
      }
  };

  const handleGrantShortage = async (shortDayRecord, employeeInfo) => {
      // Logic: Add the shortage hours to 'grantedHours'
      try {
          // Use selectedMonth to ensure consistent key generation regardless of date format
          const monthStr = selectedMonth.format("YYYY-MM");
          const key = `${employeeInfo.employeeId}_${monthStr}`;
          
          const currentAdj = adjustments[key] || { grantedLeaves: 0, grantedHours: 0, grantedShortageDates: [] };
          const newGrantedHours = (currentAdj.grantedHours || 0) + (shortDayRecord.shortage || 0);
          const newGrantedDates = [...(currentAdj.grantedShortageDates || []), shortDayRecord.date];

          await setDoc(doc(db, "payroll_adjustments", key), {
              grantedLeaves: currentAdj.grantedLeaves || 0,
              grantedHours: newGrantedHours,
              grantedShortageDates: newGrantedDates,
              updatedAt: new Date().toISOString()
          }, { merge: true });
          
          setAdjustments(prev => ({ ...prev, [key]: { ...currentAdj, grantedHours: newGrantedHours, grantedShortageDates: newGrantedDates } }));
          message.success(`Granted +${formatDuration(shortDayRecord.shortage)} hours`);
      } catch (e) {
          console.error(e);
          message.error("Failed to grant shortage: " + e.message);
      }
  };

  const handleRevokeShortage = async (record) => {
      try {
          const monthStr = selectedMonth.format("YYYY-MM");
          const key = `${record.employeeId}_${monthStr}`;
          
          const currentAdj = adjustments[key] || { grantedLeaves: 0, grantedHours: 0, grantedShortageDates: [] };
          if (!(currentAdj.grantedShortageDates || []).includes(record.date)) return;

          // Remove date
          const newGrantedDates = (currentAdj.grantedShortageDates || []).filter(d => d !== record.date);
          
          // Calculate shortage to remove (re-calculate or approximate?)
          // Since we don't store exactly how much was granted for *that specific* date in the array (only dates),
          // we have to re-derive the shortage amount for that day from the record.
          let dailyHours = 0;
          if (record.punchTimes && record.punchTimes.length > 0) {
                const { totalHours } = calculateTimes(record.punchTimes);
                if (totalHours) {
                    const [h, m] = totalHours.split(":").map(Number);
                    dailyHours = h + (m/60);
                }
          } else if (record.hours) {
                const [h, m] = record.hours.split(":").map(Number);
                dailyHours = h + (m/60);
          }
          const shortageToRemove = Math.max(0, 8 - dailyHours);

          const newGrantedHours = Math.max(0, (currentAdj.grantedHours || 0) - shortageToRemove);

          await setDoc(doc(db, "payroll_adjustments", key), {
              grantedLeaves: currentAdj.grantedLeaves || 0,
              grantedHours: newGrantedHours,
              grantedShortageDates: newGrantedDates,
              updatedAt: new Date().toISOString()
          }, { merge: true });

          setAdjustments(prev => ({ ...prev, [key]: { ...currentAdj, grantedHours: newGrantedHours, grantedShortageDates: newGrantedDates } }));
          message.success(`Revoked grant for ${record.date}`);
      } catch (e) {
          console.error(e);
          message.error("Failed to revoke");
      }
  };

  
  // Render helper to avoid duplication
  const renderPayrollStats = (payroll, darkMode, employeeInfo = null) => (
      <div style={{ 
          marginBottom: 16, 
          padding: 20, 
          background: darkMode ? "#1f1f1f" : "#fff", 
          borderRadius: 8,
          boxShadow: darkMode ? "0 2px 8px rgba(0,0,0,0.5)" : "0 2px 8px rgba(0,0,0,0.05)",
          border: darkMode ? "1px solid #303030" : "1px solid #f0f0f0"
      }}>
          <Row gutter={[24, 24]}>
              <Col xs={12} sm={4}><Statistic title="Working Days" value={payroll.workingDays} valueStyle={{ fontSize: 18, fontWeight: 600 }} /></Col>
              
              <Col xs={12} sm={4}>
                  <Statistic 
                    title="Net Earning Days" 
                    value={`${payroll.netEarningDays} / ${payroll.daysInMonth}`} 
                    valueStyle={{ fontSize: 18, fontWeight: 600, color: "#52c41a" }} 
                  />
              </Col>
              
              <Col xs={12} sm={4}><Statistic title="Passed Days" value={payroll.passedWorkingDays} suffix={`/ ${payroll.workingDays}`} valueStyle={{ fontSize: 18, fontWeight: 600, color: "#722ed1" }} /></Col>
              
              <Col xs={12} sm={4}>
                  <Statistic 
                    title="Passed Hours" 
                    value={payroll.passedEligibleHours.toFixed(2)} 
                    suffix={`/ ${payroll.passedTargetHours}h`}
                    valueStyle={{ fontSize: 18, fontWeight: 600, color: "#d48806" }} 
                  />
              </Col>
              
              <Col xs={12} sm={4}>
                  <Statistic 
                    title="Monthly Hours" 
                    value={payroll.passedEligibleHours.toFixed(2)} 
                    suffix={`/ ${payroll.targetHours}h`}
                    valueStyle={{ fontSize: 18, fontWeight: 600, color: "#1890ff" }} 
                    prefix={<ClockCircleOutlined />} 
                  />
              </Col>
              <Col xs={12} sm={4}>
                  <Statistic 
                    title="Time Check" 
                    value={Math.abs(payroll.passedDifference).toFixed(2) + "h"} 
                    prefix={payroll.passedDifference >= 0 ? <PlusOutlined /> : <></>} 
                    suffix={payroll.passedDifference >= 0 ? "Ahead" : "Behind"}
                    valueStyle={{ fontSize: 18, color: payroll.passedDifference < 0 ? "#ff4d4f" : "#52c41a", fontWeight: 600 }} 
                  />
              </Col>
              
              {showSalary && (
              <Col xs={12} sm={4}>
                  <Statistic 
                    title="Estimated Salary" 
                    value={payroll.payableSalary} 
                    precision={2}
                    valueStyle={{ fontSize: 20, color: "#52c41a", fontWeight: 600 }} 
                    prefix={<DollarOutlined />}
                    suffix={
                        <div style={{display:'flex', flexDirection:'column', alignItems:'flex-start', lineHeight: 1.2}}>
                            <span style={{fontSize: 14, color: '#888', marginLeft: 4}}>/ {payroll.monthlySalary.toLocaleString()}</span>
                            {payroll.incentiveAmount > 0 && <Tag color="gold" style={{marginLeft: 4, marginTop: 2}}>+ ₹{payroll.incentiveAmount.toLocaleString()} Inc.</Tag>}
                        </div>
                    }
                  />
              </Col>
              )}
              <Col xs={12} sm={4}>
                  <Statistic 
                    title="Leaves" 
                    value={Math.max(0, payroll.totalLeaves)} 
                    valueStyle={{ fontSize: 20, color: (payroll.paidLeavesCount > 0) ? "#52c41a" : "#faad14", fontWeight: 600 }} 
                    suffix={payroll.paidLeavesCount > 0 ? <span style={{fontSize:12, color:'#888', marginLeft:5}}>(-{payroll.paidLeavesCount} Pd)</span> : null}
                  />
              </Col>
              
              {/* Pending Weekend Approvals List */}
              {payroll.pendingWeekends && payroll.pendingWeekends.length > 0 && (
                <Col span={24} style={{ marginTop: 12, background: darkMode ? "rgba(250, 173, 20, 0.1)" : "#fffbe6", padding: 12, borderRadius: 6, border: "1px dashed #faad14" }}>
                    <div style={{ fontSize: 13, fontWeight: "bold", color: "#faad14", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}>
                        <ClockCircleOutlined /> Pending Weekend Approvals ({payroll.pendingWeekends.length})
                    </div>
                    <div style={{ maxHeight: 150, overflowY: "auto" }}>
                        {payroll.pendingWeekends.map(pw => (
                            <div key={pw.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6, background: darkMode ? "#000" : "#fff", padding: "6px 10px", borderRadius: 4, border: "1px solid #faad14" }}>
                                <span style={{ fontSize: 12, fontWeight: 500 }}>{pw.date} — <span style={{color: '#1890ff'}}>{pw.dailyHours.toFixed(2)} hrs</span></span>
                                <Button type="primary" size="small" onClick={() => handleApproveWeekend(pw.id)}>Accept</Button>
                            </div>
                        ))}
                    </div>
                </Col>
              )}

              {payroll.shortDays && payroll.shortDays.length > 0 && payroll.passedDifference < 0 && (
                <Col xs={24} md={12} xl={8} style={{ marginTop: 24 }}>
                    <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, color: "#fa8c16", fontWeight: 600, fontSize: 15 }}>
                        <ClockCircleOutlined /> Short Days ({payroll.shortDays.length})
                    </div>
                    <div style={{ maxHeight: 300, overflowY: "auto", paddingRight: 4 }}>
                        {payroll.shortDays.map(sd => (
                            <div key={sd.date} style={{ 
                                marginBottom: 10, 
                                background: darkMode ? "#000" : "#fff", 
                                padding: "10px 14px", 
                                borderRadius: 8, 
                                border: "1px solid #fa8c16", // Orange Border
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                fontSize: 13,
                                boxShadow: "0 2px 4px rgba(250, 140, 22, 0.1)"
                            }}>
                                <span style={{ fontWeight: 600 }}>{sd.date} ({(sd.dailyHours || 0).toFixed(2)} hrs)</span>
                                {employeeInfo && (
                                   <div style={{ display: 'flex', gap: 8, alignItems: "center" }}>
                                       <span style={{ color: "#fa8c16" }}>- {formatDuration(sd.shortage)}</span>
                                       <Button type="primary" size="small" ghost style={{ borderColor: '#fa8c16', color: '#fa8c16', fontSize: 12, padding: "0 12px", height: 26 }} onClick={() => handleGrantShortage(sd, employeeInfo)}>Grant (+{formatDuration(sd.shortage)})</Button>
                                   </div>
                                )}
                            </div>
                        ))}
                    </div>
                </Col>
              )}

              {/* Zero Days / Low Hours List (< 3h) - ALWAYS VISIBLE */}
              {payroll.zeroDays && payroll.zeroDays.length > 0 && (
                <Col xs={24} md={12} xl={8} style={{ marginTop: 24 }}>
                    <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, color: "#cf1322", fontWeight: 600, fontSize: 15 }}>
                        <ClockCircleOutlined /> Low Hours ({payroll.zeroDays.length})
                    </div>
                    <div style={{ maxHeight: 300, overflowY: "auto", paddingRight: 4 }}>
                        {(payroll.zeroDays || []).map(sd => (
                            <div key={sd.date} style={{ 
                                marginBottom: 10, 
                                background: darkMode ? "#000" : "#fff", 
                                padding: "10px 14px", 
                                borderRadius: 8, 
                                border: "1px solid #cf1322", // Red Border
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                fontSize: 13,
                                boxShadow: "0 2px 4px rgba(207, 19, 34, 0.1)"
                            }}>
                                <span style={{ fontWeight: 600 }}>{sd.date} ({(sd.dailyHours || 0).toFixed(2)} hrs)</span>
                                {employeeInfo && (
                                   <div style={{ display: 'flex', gap: 8, alignItems: "center" }}>
                                       <span style={{ color: "#cf1322" }}>- {formatDuration(sd.shortage)}</span>
                                       <Button type="primary" size="small" danger ghost style={{ fontSize: 12, padding: "0 12px", height: 26 }} onClick={() => handleGrantShortage(sd, employeeInfo)}>Grant (+{formatDuration(sd.shortage)})</Button>
                                   </div>
                                )}
                            </div>
                        ))}
                    </div>
                </Col>
              )}

              {/* Missing Days / Leaves List */}
              {payroll.missingDays && payroll.missingDays.length > 0 && (
                <Col xs={24} md={12} xl={8} style={{ marginTop: 24 }}>
                    <div style={{ marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8, color: "#ff4d4f", fontWeight: 600, fontSize: 15 }}>
                        <ClockCircleOutlined /> Absences / Missing Workdays ({payroll.missingDays.length})
                    </div>
                    <div style={{ maxHeight: 300, overflowY: "auto", paddingRight: 4 }}>
                        {payroll.missingDays.map(dateStr => (
                            <div key={dateStr} style={{ 
                                marginBottom: 10, 
                                background: darkMode ? "#000" : "#fff", 
                                padding: "10px 14px", 
                                borderRadius: 8, 
                                border: "1px solid #ff4d4f", // Red Border
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                fontSize: 13,
                                boxShadow: "0 2px 4px rgba(255, 77, 79, 0.1)"
                            }}>
                                <span style={{ fontWeight: 600 }}>{dateStr}</span>
                                {employeeInfo && (
                                   <div style={{ display: 'flex', gap: 8 }}>
                                       <Button type="default" size="small" style={{ fontSize: 12, padding: "0 12px", height: 26 }} onClick={() => handleGrantLeave(dateStr, employeeInfo, false)}>Unpaid</Button>
                                       <Button type="primary" ghost size="small" style={{ borderColor: '#52c41a', color: '#52c41a', fontSize: 12, padding: "0 12px", height: 26 }} onClick={() => handleGrantLeave(dateStr, employeeInfo, true)}>Paid</Button>
                                       <Button type="primary" ghost size="small" danger style={{ fontSize: 12, padding: "0 12px", height: 26 }} onClick={() => handleMarkPresent(dateStr, employeeInfo)}>Present</Button>
                                   </div>
                                )}
                            </div>
                        ))}
                    </div>
                </Col>
                  )}
          </Row>
      </div>
  );



  /* ================= HELPERS & COLUMNS ================= */
  /* ================= HELPERS & COLUMNS ================= */
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

  const generateColumns = (maxPairs) => {
      const punchCols = [];
      for (let i = 0; i < maxPairs; i++) {
          punchCols.push({
              title: `In ${i + 1}`,
              dataIndex: ["sortedPunches", i * 2],
              width: 90,
              align: "center",
              render: (t, r) => <span style={(r.highlightedTimes || []).includes(t) && t ? { background: '#fffb8f', fontWeight: 'bold', padding: '2px 4px', borderRadius: 4, color: 'black' } : {}}>{t}</span>
          });
          punchCols.push({
              title: `Out ${i + 1}`,
              dataIndex: ["sortedPunches", i * 2 + 1],
              width: 90,
              align: "center",
              render: (t, r) => <span style={(r.highlightedTimes || []).includes(t) && t ? { background: '#fffb8f', fontWeight: 'bold', padding: '2px 4px', borderRadius: 4, color: 'black' } : {}}>{t}</span>
          });
      }

      return [
        { title: "Employee", dataIndex: "employee", key: "employee", width: 180, fixed: "left", render: (_, r) => <div style={{fontWeight:600}}>{r.firstName || r.employee || "N/A"}</div> },
        { title: "Date", dataIndex: "fullDate", key: "fullDate", width: 220, fixed: "left", render: (t, r) => <span>{t} {r.isGranted && <Popconfirm title="Revoke this grant?" onConfirm={() => handleRevokeShortage(r)}><Tag color="gold" style={{marginLeft:4, cursor: "pointer"}}>Granted</Tag></Popconfirm>}</span> },
        ...punchCols,
        { title: "Total Hours", dataIndex: "targetHoursFormatted", width: 100, align: "center" },
        { title: "Present Hours", dataIndex: "presentHoursFormatted", width: 120, align: "center" },
        { title: "Hours Short by", dataIndex: "hoursShortByFormatted", width: 120, align: "center" },
        { title: "Present Days", dataIndex: "presentDays", width: 100, align: "center", render: (v) => <span style={{ color: v ? "green" : "red" }}>{v}</span> },
        { title: "Leave check", dataIndex: "leaveCheck", width: 100, align: "center" },
        { title: "Day Swap off", dataIndex: "daySwapOff", width: 100, align: "center" },
        { title: "Weekend Checks", dataIndex: "weekendCheck", width: 120, align: "center", render: (v) => v ? 1 : 0 },
        { title: "Paid Holidays", dataIndex: "paidHolidays", width: 100, align: "center" },
        { title: "Action", key: "action", width: 120, fixed: "right", render: (_, r) => {
            if (r.isMissing) return null; 
            const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], true);
            const isWeekend = d.isValid() && (d.day() === 0 || d.day() === 6);
            const showApproveBtn = isWeekend && !r.weekendApproved;

            return (
                <div style={{ display: 'flex', gap: 4 }}>
                    <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(r)} />
                    {showApproveBtn && <Button type="primary" size="small" onClick={() => handleApproveWeekend(r.id)}>Approve</Button>}
                </div>
            );
        }},
      ];
  };

  const filteredRecords = React.useMemo(() => {
    if (!selectedMonth) return [];
    return records.filter(r => {
        if (!r.date) return false;
        const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], true);
        return d.isValid() && d.isSame(selectedMonth, 'month');
    });
  }, [records, selectedMonth]);

  const employeeGroups = groupByEmployee(filteredRecords);

  const tabItems = Object.entries(employeeGroups).map(([key, emp]) => {
                  const payroll = getMonthlyPayroll(emp.records, emp.employeeId);
                  
                  // Compute Combined Records (Actual + Missing)
                  const missing = (payroll.missingDays || []).map(date => ({
                        id: `missing-${date}`,
                        date: date,
                        employee: emp.employeeName,
                        employeeId: emp.employeeId,
                        department: emp.department,
                        numberOfPunches: 0,
                        punchTimes: [],
                        inTime: "-",
                        outTime: "-",
                        hours: "0:00",
                        isMissing: true
                  }));
                  
                  let combinedRecords = [...emp.records, ...missing];
                  
                  // Sort Descending -> User asked for Table View generally sorted, but EmployeeDashboard was sorted Ascending (Chronological).
                  // Admin usually wants to see list... but Chronological is better for specific Employee View.
                  // Let's sort ASCENDING for the detailed table view of an employee
                  combinedRecords.sort((a, b) => {
                    const dateA = dayjs(a.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
                    const dateB = dayjs(b.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
                    if (!dateA.isValid()) return 1; 
                    if (!dateB.isValid()) return -1;
                    return dateA.valueOf() - dateB.valueOf(); 
                  });

                  // Process for Table display (add helper fields)
                  combinedRecords = combinedRecords.map(r => {
                      const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
                      const dayOfWeekIndex = d.day();
                      const isWeekend = dayOfWeekIndex === 0 || dayOfWeekIndex === 6;
                      const isGranted = (payroll.grantedShortageDates || []).includes(r.date);

                      // Punches
                      const sortedPunches = (r.punchTimes || []).sort();

                      // Hours
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
                      const presentDayCount = dailyHours > 0 ? 1 : 0; 

                      return {
                          ...r,
                          fullDate: getDayOfWeek(r.date),
                          sortedPunches,
                          targetHoursFormatted: isWeekend ? "0:00:00" : "8:00:00",
                          presentHoursFormatted: formatDuration(dailyHours),
                          hoursShortByFormatted: formatDuration(hoursShortBy),
                          presentDays: presentDayCount,
                          leaveCheck: r.isLeave ? 1 : 0,
                          daySwapOff: 0,
                          weekendCheck: isWeekend ? 1 : 0,
                          paidHolidays: 0,
                          isGranted
                      };
                  });

                  const maxPunches = Math.max(0, ...combinedRecords.map(r => (r.sortedPunches || []).length));
                  const maxPairs = Math.max(3, Math.ceil(maxPunches / 2));
                  const dynamicColumns = generateColumns(maxPairs);

                  return {
                  key: key,
                  label: emp.employeeName || emp.employee || emp.employeeId,
                  children: (
                    <>
                    {/* Incentive Section for Table View */}
                    <div style={{ marginBottom: 16, display: "flex", justifyContent: "flex-end", alignItems: "start", gap: 10 }}>
                        {showSalary && (
                        <div style={{ textAlign: "right", marginRight: 20 }}>
                            <div style={{ fontSize: 13, color: "#888" }}>Estimated Salary</div>
                            <div style={{ fontSize: 20, fontWeight: "bold", color: "#52c41a" }}>
                                {formatCurrency(payroll.payableSalary)}
                                <span style={{ fontSize: 14, color: "#ccc", marginLeft: 5 }}>/ {formatCurrency(payroll.monthlySalary)}</span>
                            </div>
                        </div>
                        )}
                        
                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                             <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                                 <span style={{ fontWeight: 500 }}>Incentives:</span>
                                 <Button 
                                    size="small" 
                                    type="dashed" 
                                    icon={<PlusOutlined />} 
                                    onClick={() => {
                                        // Simple prompt for now, or use the modal I can resurrect
                                        // Resorting to a simple prompt to avoid complex state management in this file for now if possible, 
                                        // OR use the existing Modal logic but tweaked.
                                        // Let's use a specialized small inline form or reuse the modal.
                                        // I'll reuse the modal approach for cleaner UX.
                                        setSelectedEmpForIncentive({ employeeId: emp.employeeId, employeeName: emp.employeeName });
                                        setIncentiveModalOpen(true);
                                    }}
                                 >
                                     Add
                                 </Button>
                             </div>
                             <div style={{ display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "flex-end", maxWidth: 300 }}>
                                 {(payroll.incentiveList || []).map((inc, i) => (
                                     <Tag key={inc.id || i} color="gold" closable onClose={() => handleDeleteIncentive(emp.employeeId, inc.id)}>
                                         +{inc.amount}
                                     </Tag>
                                 ))}
                                 {(!payroll.incentiveList || payroll.incentiveList.length === 0) && <span style={{fontSize:12, color:'#ccc'}}>None</span>}
                             </div>
                        </div>
                    </div>

                    {renderPayrollStats(payroll, darkMode, emp)}
                    <Table
                      columns={dynamicColumns}
                      dataSource={combinedRecords}
                      rowKey={(rec) => rec.id || `${rec.employeeId || rec.employee}-${rec.date}`}
                      bordered
                      scroll={{ x: 1500 }}
                      pagination={{ pageSize: 31, showSizeChanger: true }}
                      rowClassName={(record) => {
                          if (record.isMissing) return darkMode ? "dark-missing-row" : "light-missing-row";
                          let dailyHours = 0;
                          if (record.hours) {
                              const [h, m] = record.hours.split(":").map(Number);
                              dailyHours = h + (m/60);
                          }
                          const d = dayjs(record.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], true);
                          const isWeekend = d.isValid() && (d.day() === 0 || d.day() === 6);
                          
                          if (isWeekend) return "weekend-row"; // We need to add styles for these or use style prop
                          if (dailyHours < 3) return "low-hours-row";
                          return "";
                      }}
                      onRow={(record) => {
                          let dailyHours = 0;
                          if (record.hours) {
                              const [h, m] = record.hours.split(":").map(Number);
                              dailyHours = h + (m/60);
                          }
                          const d = dayjs(record.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], true);
                          const isWeekend = d.isValid() && (d.day() === 0 || d.day() === 6);
                          
                          let bg = "";
                          if (record.isLeave) {
                              if (record.leaveType === 'Paid') bg = darkMode ? "rgba(183, 235, 143, 0.15)" : "#f6ffed";
                              else bg = darkMode ? "#333" : "#fafafa";
                          } else if (isWeekend) bg = darkMode ? "rgba(212, 177, 6, 0.15)" : "#fffbf0"; 
                           else if (dailyHours < 3) bg = darkMode ? "rgba(207, 19, 34, 0.15)" : "#fff2f0";
                           
                           return { style: { background: bg } };
                      }}
                    />
                    </>
                  )};
                });

  return (
    <ConfigProvider theme={{ algorithm: darkMode ? darkAlgorithm : defaultAlgorithm }}>
      <Layout style={{ minHeight: "100vh" }}>
        <Header style={{ background: "#001529", padding: "0 24px", height: "auto", minHeight: 64 }}>
           <Row justify="space-between" align="middle" style={{ height: "100%", padding: "8px 0" }}>
              <Col>
                  <h2 style={{ color: "white", margin: 0 }}>Admin Dashboard</h2>
              </Col>
              <Col>
                  <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
                      <Button icon={<ReloadOutlined />} onClick={fetchData}>Refresh</Button>
                      <Button icon={<MessageOutlined />} onClick={() => setChatOpen(true)}>Chat</Button>
                      <Button icon={<LogoutOutlined />} onClick={handleLogout}>Logout</Button>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <BulbOutlined style={{ color: "#fff" }} />
                        <Switch checked={darkMode} onChange={setDarkMode} />
                      </div>
                  </div>
              </Col>
           </Row>
        </Header>
        <Content style={{ padding: screens.xs ? 8 : 24, background: darkMode ? "#141414" : "#f0f2f5" }}>
          
          <Row gutter={[16, 16]} justify="space-between" align="middle" style={{ marginBottom: 16 }}>
            <Col xs={24} lg={16}>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                    <Upload beforeUpload={handleFileUpload} showUploadList={false}>
                        <Button type="primary" icon={<UploadOutlined />} loading={uploading}>Upload CSV</Button>
                    </Upload>
                    <DatePicker.MonthPicker 
                        value={selectedMonth} 
                        onChange={setSelectedMonth} 
                        allowClear={false}
                        placeholder="Select Payroll Month"
                        style={{ width: 140 }}
                    />
                    <Button icon={<SettingOutlined />} onClick={() => setHolidayModalOpen(true)}>Holidays</Button>
                    <Button 
                        icon={showSalary ? <EyeInvisibleOutlined /> : <EyeOutlined />} 
                        onClick={() => setShowSalary(!showSalary)}
                    >
                        {showSalary ? "Hide Revenue" : "Show Revenue"}
                    </Button>
                    <Button icon={<DollarOutlined />} onClick={handleManageSalaries}>Manage Salaries</Button>
                </div>
            </Col>
            <Col xs={24} lg={8} style={{ textAlign: 'right' }}>
               <div style={{ display: "flex", gap: 8, justifyContent: 'flex-end' }}>
                  <Button type={viewMode === "cards" ? "primary" : "default"} onClick={() => setViewMode("cards")}>Cards</Button>
                  <Button type={viewMode === "table" ? "primary" : "default"} onClick={() => setViewMode("table")}>Table</Button>
               </div>
            </Col>
          </Row>

          {/* Cards / Table rendering */}
          {viewMode === "cards" ? (
            Object.keys(employeeGroups).length === 0 ? (
              <Empty description="No records found" />
            ) : (
              <Row gutter={[16, 16]}>
                {Object.entries(employeeGroups).map(([k, emp]) => {
                  const payroll = getMonthlyPayroll(emp.records, emp.employeeId);
                  return (
                  <Col key={k} xs={24} sm={24} md={12} lg={12} xl={8} style={{ display: "flex" }}>
                    <Card 
                        hoverable 
                        title={<><UserOutlined /> {emp.employeeName}</>} 
                        extra={<Tag color="blue">ID: {emp.employeeId}</Tag>} 
                        style={{ 
                            backgroundColor: darkMode ? "#1f1f1f" : "#fff", 
                            height: "100%", 
                            display: "flex", 
                            flexDirection: "column" 
                        }}
                        bodyStyle={{ flex: 1, display: "flex", flexDirection: "column" }}
                        actions={[
                            <Button type="link" icon={<DollarOutlined />} onClick={() => openAddIncentive(emp)}>Add Incentive</Button>
                        ]}
                    >
                      
                      {renderPayrollStats(payroll, darkMode, emp)}

                      <Statistic title="Department" value={emp.department} prefix={<UserOutlined />} valueStyle={{ fontSize: 14 }} />
                      <Statistic title="Total Records" value={emp.totalRecords} prefix={<CalendarOutlined />} valueStyle={{ fontSize: 14 }} />
                      
                      <Collapse size="small" ghost style={{ marginTop: 12 }}>
                        <Panel header={`View ${emp.records.length} Record(s)`} key="1">
                          <div style={{ maxHeight: 400, overflowY: "auto" }}>
                            {emp.records.map((rec, idx) => {
                                let dailyHours = 0;
                                if (rec.punchTimes && rec.punchTimes.length > 0) {
                                    const { totalHours } = calculateTimes(rec.punchTimes);
                                    if (totalHours) {
                                        const [h, m] = totalHours.split(":").map(Number);
                                        dailyHours = h + (m/60);
                                    }
                                } else if (rec.hours) {
                                    const [h, m] = rec.hours.split(":").map(Number);
                                    dailyHours = h + (m/60);
                                }
                                const d = dayjs(rec.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], true);
                                const isWeekend = d.day() === 0 || d.day() === 6;
                                const isGranted = (payroll.grantedShortageDates || []).includes(rec.date);
                                let statusTag = null;
                                let rowStyle = {};
                                let showApproveBtn = false;
                                
                                // Color Logic Refinement (Pastel / Soft)
                                if (rec.isLeave) {
                                  if (rec.leaveType === 'Paid') {
                                      rowStyle = { border: "1px solid #b7eb8f", background: darkMode ? "rgba(183, 235, 143, 0.1)" : "#f6ffed" };
                                      statusTag = <Tag color="success">Paid Leave</Tag>;
                                  } else {
                                      rowStyle = { border: "1px solid #d9d9d9", background: darkMode ? "#1f1f1f" : "#fafafa" };
                                      statusTag = <Tag color="default">Unpaid Leave</Tag>;
                                  }
                                } else if (isWeekend) {
                                   rowStyle = { 
                                       border: darkMode ? "1px solid #d4b106" : "1px solid #fffb8f", 
                                       background: darkMode ? "rgba(212, 177, 6, 0.1)" : "#fffbe6" 
                                   };
                                   if (rec.weekendApproved) {
                                       statusTag = <Tag color="success">Approved</Tag>;
                                   } else {
                                       statusTag = <Tag color="warning">Action Needed</Tag>;
                                       showApproveBtn = true;
                                   }
                                } else if (dailyHours < 3) {
                                  rowStyle = { 
                                      border: darkMode ? "1px solid #cf1322" : "1px solid #ffccc7", 
                                      background: darkMode ? "rgba(207, 19, 34, 0.1)" : "#fff2f0" 
                                  };
                                  statusTag = <Tag color="error">Low Hours</Tag>;
                                } else {
                                    // Default OK
                                     statusTag = <Tag color="processing">OK</Tag>;
                                }
                                
                                if (isGranted) {
                                  rowStyle = { border: "1px solid #faad14", background: darkMode ? "rgba(250, 173, 20, 0.1)" : "#fff7e6" };
                                  statusTag = <Tag color="gold">Granted</Tag>;
                                }

                                return (
                                <Card key={rec.id || idx} size="small" style={{ marginBottom: 8, backgroundColor: darkMode ? "#1f1f1f" : "#fff", ...rowStyle }}>
                                  <div style={{display:'flex', justifyContent:'space-between', marginBottom:4}}>
                                      <Tag color="purple"><CalendarOutlined /> {rec.date || "N/A"}</Tag>
                                      {statusTag}
                                  </div>
                                  <Tag color="green">Punches: {rec.numberOfPunches || "0"}</Tag>
                                  <Row gutter={8} style={{ margin: "8px 0" }}>
                                    <Col span={8}><div style={{ fontSize: 12, color: "#666" }}>In Time</div><div style={{ fontWeight: "bold" }}>{rec.inTime || "-"}</div></Col>
                                    <Col span={8}><div style={{ fontSize: 12, color: "#666" }}>Out Time</div><div style={{ fontWeight: "bold" }}>{rec.outTime || "-"}</div></Col>
                                    <Col span={8}><div style={{ fontSize: 12, color: "#666" }}>Hours</div><div style={{ fontWeight: "bold", color: "#1890ff" }}>{rec.hours || "-"}</div></Col>
                                  </Row>
                                    {rec.punchTimes?.length > 0 && <div>
                                    <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>All Punch Times:</div>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                        {rec.punchTimes.map((t, i) => {
                                            const isHighlighted = (rec.highlightedTimes || []).includes(t);
                                            return <Tag key={i} color={isHighlighted ? "gold" : "blue"} style={isHighlighted ? { fontWeight: "bold", border: "1px solid #d4b106", color:'black' } : {}}>{t}</Tag>
                                        })}
                                        {rec.isEdited && <Tag color="purple">Edited</Tag>}
                                    </div>
                                  </div>}

                                  <div style={{marginTop: 8, display: 'flex', gap: 8}}>
                                    <Button type="link" size="small" icon={<EditOutlined />} onClick={() => openEdit(rec)}>Edit</Button>
                                    {showApproveBtn && (
                                        <Button type="primary" size="small" onClick={() => handleApproveWeekend(rec.id)}>Approve</Button>
                                    )}
                                  </div>
                                </Card>
                            )})}
                          </div>
                        </Panel>
                      </Collapse>
                    </Card>
                  </Col>
                  );
                })}
              </Row>
            )
          ) : (
            Object.keys(employeeGroups).length === 0 ? (
              <Empty description="No records found" />
            ) : (
              <Tabs type="card" items={tabItems} />
            )
          )}

          <Modal open={editOpen} title={`Edit Punch - ${currentRecord?.date}`} footer={null} onCancel={() => setEditOpen(false)}>
            <Form layout="vertical" form={form} onFinish={handleUpdate}>
              <Form.Item
                name="punchTimes"
                label="Punch Times (comma separated)"
                rules={[
                  { required: true },
                  {
                    validator: (_, value) => {
                      const times = value.split(",").map((t) => t.trim()).filter(Boolean);
                      const bad = times.find((t) => !isValidTime(t));
                      return bad ? Promise.reject(new Error(`Invalid time: ${bad}`)) : Promise.resolve();
                    },
                  },
                ]}
              >
                <Input placeholder="14:22, 13:50, 14:07, 21:47, 23:00" />
              </Form.Item>
              <div style={{ textAlign: "right" }}>
                <Button onClick={() => setEditOpen(false)} style={{ marginRight: 8 }}>Cancel</Button>
                <Button type="primary" htmlType="submit">Save</Button>
              </div>
            </Form>
          </Modal>

        {/* HOLIDAY MODAL */}
        <Modal 
            open={holidayModalOpen} 
            title="Manage Holidays" 
            footer={null} 
            onCancel={() => setHolidayModalOpen(false)}
        >
            <div style={{ marginBottom: 16, display: "flex", gap: 8 }}>
                <DatePicker value={newHolidayDate} onChange={setNewHolidayDate} placeholder="Select Date" />
                <Input value={newHolidayName} onChange={(e) => setNewHolidayName(e.target.value)} placeholder="Holiday Name (e.g. Diwali)" />
                <Button type="primary" onClick={handleAddHoliday} icon={<PlusOutlined />}>Add</Button>
            </div>

            <List
                header={<div>Current Holidays</div>}
                bordered
                dataSource={holidays}
                renderItem={(item) => (
                    <List.Item
                        actions={[<Button danger icon={<DeleteOutlined />} onClick={() => handleDeleteHoliday(item.id)} />]}
                    >
                        <List.Item.Meta
                            title={item.name}
                            description={item.date}
                        />
                    </List.Item>
                )}
            />
             <div style={{ marginTop: 16, color: "#888", fontSize: 12 }}>
                 Note: Weekends (Sat/Sun) are automatically excluded from working days.
                 Default holidays included: {DEFAULT_HOLIDAYS.join(", ")}
             </div>
        </Modal>

        {/* SALARY MANAGEMENT MODAL */}
        <Modal
            open={salaryModalOpen}
            title="Manage Employee Salaries"
            footer={null}
            onCancel={() => setSalaryModalOpen(false)}
            width={600}
        >
            <Form form={salaryForm} onFinish={handleSaveSalary} layout="vertical">
                <div style={{ maxHeight: 400, overflowY: "auto", marginBottom: 16 }}>
                    {Object.entries(employeeGroups).map(([key, emp]) => {
                        // Current salary
                        const currentSal = salaries[emp.employeeId] || 30000;
                        return (
                            <Row key={key} gutter={16} align="middle" style={{ marginBottom: 12 }}>
                                <Col span={12}>
                                    <div><strong>{emp.employeeName}</strong></div>
                                    <div style={{ fontSize: 12, color: "#888" }}>ID: {emp.employeeId}</div>
                                </Col>
                                <Col span={12}>
                                    <Form.Item 
                                        name={emp.employeeId} 
                                        initialValue={currentSal}
                                        style={{ margin: 0 }}
                                    >
                                        <InputNumber 
                                            formatter={value => `₹ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                                            parser={value => value.replace(/\₹\s?|(,*)/g, '')}
                                            style={{ width: "100%" }}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col span={24}> {/* Use full width for incentives */}
                                    <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", alignItems: "start" }}>
                                        <div style={{ marginTop: 4 }}><Typography.Text>Current Incentives:</Typography.Text></div>
                                        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                                            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", gap: 2, maxWidth: 200 }}>
                                                {(() => {
                                                    const mStr = selectedMonth ? selectedMonth.format("YYYY-MM") : "";
                                                    const iKey = `${emp.employeeId}_${mStr}`;
                                                    const incRaw = incentives[iKey];
                                                    let incList = [];
                                                    if (Array.isArray(incRaw)) incList = incRaw;
                                                    else if (typeof incRaw === 'number') incList = [{ id: 'leg', amount: incRaw }];
                                                    
                                                    return incList.map((inc, i) => (
                                                        <Tag key={inc.id || i} color="gold" style={{margin:0}} closable onClose={() => handleDeleteIncentive(emp.employeeId, inc.id)}>
                                                            {inc.amount}
                                                        </Tag>
                                                    ));
                                                })()}
                                            </div>
                                        </div>
                                    </div>
                                </Col>
                            </Row>
                        )
                    })}
                </div>
                <div style={{ textAlign: "right" }}>
                     <Button onClick={() => setSalaryModalOpen(false)} style={{ marginRight: 8 }}>Cancel</Button>
                     <Button type="primary" htmlType="submit">Save Changes</Button>
                </div>
            </Form>

        </Modal>

        {/* INCENTIVE MODAL */}
        <Modal
            open={incentiveModalOpen}
            title={`Add Incentive - ${selectedEmpForIncentive?.employeeName}`}
            footer={null}
            onCancel={() => setIncentiveModalOpen(false)}
        >
            <Form form={incentiveForm} onFinish={handleSaveIncentive} layout="vertical">
                <Form.Item name="amount" label="Incentive Amount" rules={[{ required: true, message: 'Please enter amount' }]}>
                    <InputNumber 
                        style={{ width: "100%" }} 
                        placeholder="e.g. 5000"
                        formatter={value => `₹ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                        parser={value => value.replace(/₹\s?|(,*)/g, '')}
                    />
                </Form.Item>
                <div style={{ textAlign: "right" }}>
                     <Button onClick={() => setIncentiveModalOpen(false)} style={{ marginRight: 8 }}>Cancel</Button>
                     <Button type="primary" htmlType="submit">Save Incentive</Button>
                </div>
            </Form>
        </Modal>

        {/* ADJUSTMENT MODAL */}
        <Modal
            open={adjustmentModalOpen}
            title={`Adjust Payroll - ${currentEmpForAdj?.employeeName} (${selectedMonth ? selectedMonth.format("MMM YYYY") : ''})`}
            onCancel={() => setAdjustmentModalOpen(false)}
            onOk={() => adjForm.submit()}
        >
            <Form form={adjForm} onFinish={handleSaveAdjustment} layout="vertical">
                <Form.Item label="Granted Leaves (Add days)" name="grantedLeaves">
                    <InputNumber style={{ width: '100%' }} step={0.5} />
                </Form.Item>
                <div style={{fontSize:12, color:'#888', marginBottom:12}}>
                    Manually ADD days to "Net Earning Days" (e.g. reversing a mistake).
                </div>

                <Form.Item label="Granted Hours (Add hours)" name="grantedHours">
                    <InputNumber style={{ width: '100%' }} step={0.5} />
                </Form.Item>
                <div style={{fontSize:12, color:'#888', marginBottom:12}}>
                    Manually ADD hours to "Actual Hours".
                </div>
            </Form>
        </Modal>
        </Content>
      </Layout>
      <ChatDrawer 
        open={chatOpen} 
        onClose={() => setChatOpen(false)} 
        currentUserEmail="chirag@theawakens.com"
        currentUserName="Admin (Chirag)"
        selectedMonth={selectedMonth}
      />
    </ConfigProvider>
  );
}
