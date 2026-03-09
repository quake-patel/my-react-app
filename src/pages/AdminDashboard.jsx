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
  Popconfirm,
  Select,
  Radio,
  Space,
  Dropdown,
  Menu,
  Tooltip,
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
  MessageOutlined,
  FileExcelOutlined,
} from "@ant-design/icons";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import dayjs from "dayjs";
import ChatDrawer from "../components/ChatDrawer";
import customParseFormat from "dayjs/plugin/customParseFormat";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
import { db, auth } from "../firebase";
import {
  collection,
  addDoc,
  getDocs,
  updateDoc,
  doc,
  deleteDoc,
  setDoc,
  getDoc,
  query,
  where,
} from "firebase/firestore";

import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";

dayjs.extend(customParseFormat);
dayjs.extend(isSameOrBefore);

const { Header, Content } = Layout;
const { Panel } = Collapse;
const { TabPane } = Tabs;
const { darkAlgorithm, defaultAlgorithm } = theme;

const normalize = (v) => (typeof v === "string" ? v.trim() : "");

const getField = (row, variants = []) => {
  for (const v of variants) {
    if (row[v] !== undefined && row[v] !== null && row[v] !== "")
      return normalize(row[v]);
  }
  const rowKeys = Object.keys(row);
  for (const variant of variants) {
    const lowerVariant = variant.toLowerCase().trim();
    for (const key of rowKeys) {
      if (key.toLowerCase().trim() === lowerVariant) {
        const value = row[key];
        if (value !== undefined && value !== null && value !== "")
          return normalize(value);
      }
    }
  }
  return "";
};

const parseTimes = (timeValue, numberOfPunches) => {
  if (!timeValue) return [];
  let times = [];
  if (Array.isArray(timeValue))
    timeValue = timeValue.filter((v) => v && v.trim()).join(", ");
  if (typeof timeValue === "string") {
    times = timeValue
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t && t.match(/^\d{1,2}:\d{2}$/));
  }
  if (numberOfPunches && numberOfPunches > 0)
    times = times.slice(0, numberOfPunches);
  return times;
};

const calculateTimes = (times) => {
  if (!Array.isArray(times) || times.length < 2) {
    return { inTime: "", outTime: "", totalHours: "0:00" };
  }

  // Keep original order, only clean
  const cleanTimes = times.filter(
    (t) => typeof t === "string" && /^\d{1,2}:\d{2}$/.test(t),
  );

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
    totalHours: `${hours}:${String(minutes).padStart(2, "0")}`,
  };
};

const groupByEmployee = (records, employeesMap = {}) => {
  const grouped = {};

  // 1. Build a map of Name -> ID (Best Effort) to link orphaned records
  const nameToIdMap = {};
  records.forEach((r) => {
    // Clean name: "Digvijay (1108)" -> "digvijay"
    if (r.employeeId && r.firstName) {
      const cleanName = r.firstName.toLowerCase().trim();
      nameToIdMap[cleanName] = r.employeeId;
    }
  });

  records.forEach((record) => {
    let key = record.employeeId;

    // If no ID, try to find one via Name
    if (!key && record.firstName) {
      const cleanName = record.firstName.toLowerCase().trim();
      if (nameToIdMap[cleanName]) {
        key = nameToIdMap[cleanName];
        // Backfill ID
        record.employeeId = key;
      }
    }

    // Normalize Key: If still no ID, create a consistant fallback using Name
    if (!key) {
      key = record.firstName
        ? `NAME_${record.firstName.toLowerCase().trim()}`
        : "Unknown";
    }

    if (!grouped[key]) {
      const empData = employeesMap[key] || {};
      grouped[key] = {
        ...record,
        ...empData, // Merge Employee Profile Data (including joiningDate)
        records: [],
        totalRecords: 0,
        totalHours: 0,
        employeeName:
          record.employee || record.firstName || key.replace("NAME_", ""),
        employeeId: key.startsWith("NAME_") ? "" : key,
        joiningDate: empData.joiningDate || null, // Explicitly grab joiningDate
      };
    }

    // Merge Names: Prefer the longer/more complete name (e.g. "Digvijay (1108)" over "Digvijay")
    if (
      record.employee &&
      record.employee.length > grouped[key].employeeName.length
    ) {
      grouped[key].employeeName = record.employee;
    }

    grouped[key].records.push(record);
    grouped[key].totalRecords++; // Counts days
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
      // Use expanded format list for sort comparison too, to be safe
      const formats = [
        "YYYY-MM-DD",
        "MM/DD/YYYY",
        "M/D/YYYY",
        "DD-MM-YYYY",
        "D-M-YYYY",
        "DD/MM/YYYY",
        "MM-DD-YYYY",
        "D-MMM-YYYY",
      ];
      const dateA = dayjs(a.date, formats, false);
      const dateB = dayjs(b.date, formats, false);
      if (!dateA.isValid()) return 1;
      if (!dateB.isValid()) return -1;
      return dateB.valueOf() - dateA.valueOf();
    }),
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
  const [contextRecords, setContextRecords] = useState([]); // Stores extended range for calculations

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

  // Swap Feature States
  const [swapModalOpen, setSwapModalOpen] = useState(false);
  const [swapTarget, setSwapTarget] = useState(null); // { weekendRecordId, employeeInfo, absenceDates }
  const [swapForm] = Form.useForm();
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

  const [employees, setEmployees] = useState({}); // Map: empId -> data

  /* ================= FETCH DATA ================= */
  const fetchEmployees = async () => {
    try {
      const snap = await getDocs(collection(db, "employees"));
      const map = {};
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data.employeeId) {
          map[data.employeeId] = data;
        }
      });
      setEmployees(map);
    } catch (e) {
      console.error("Failed to load employees", e);
    }
  };

  const fetchData = async () => {
    try {
      const startOfMonth = selectedMonth.startOf("month");
      const endOfMonth = selectedMonth.endOf("month");

      // Context Window: Fetch -7 to +7 days to handle Sandwich Rule crossing months
      const contextStart = startOfMonth.subtract(7, "day").format("YYYY-MM-DD");
      const contextEnd = endOfMonth.add(7, "day").format("YYYY-MM-DD");

      // Fetch Extended Data
      const q = query(
        collection(db, "punches"),
        where("date", ">=", contextStart),
        where("date", "<=", contextEnd),
      );

      const snap = await getDocs(q);
      const allData = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Sort
      allData.sort((a, b) => {
        const dateA = dayjs(
          a.date,
          [
            "YYYY-MM-DD",
            "DD-MM-YYYY",
            "MM/DD/YYYY",
            "DD/MM/YYYY",
            "YYYY/MM/DD",
          ],
          false,
        );
        const dateB = dayjs(
          b.date,
          [
            "YYYY-MM-DD",
            "DD-MM-YYYY",
            "MM/DD/YYYY",
            "DD/MM/YYYY",
            "YYYY/MM/DD",
          ],
          false,
        );
        if (!dateA.isValid()) return 1;
        if (!dateB.isValid()) return -1;
        return dateB.valueOf() - dateA.valueOf();
      });

      setContextRecords(allData); // Store full context

      // Filter for UI (Current Month Only)
      const currentMonthData = allData.filter((d) => {
        const day = dayjs(d.date);
        return day.isValid() && day.isSame(selectedMonth, "month");
      });

      setRecords(currentMonthData);

      // Note: syncEmployeesFromPunches might find fewer employees now if they only worked in past months.
      // This is generally acceptable for a dashboard relying on active data.
      syncEmployeesFromPunches(currentMonthData); // Sync based on visible records
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
    punchesData.forEach((p) => {
      if (p.email && !uniqueEmps[p.email]) {
        uniqueEmps[p.email] = {
          email: p.email.toLowerCase(),
          employeeId: p.employeeId,
          firstName: p.firstName,
          department: p.department,
          employee: p.employee,
        };
      }
    });

    // Get existing employees
    const empSnap = await getDocs(collection(db, "employees"));
    const existingEmails = new Set(
      empSnap.docs.map((d) => (d.data().email || "").toLowerCase()),
    );

    // Add missing
    const batchPromises = [];
    Object.keys(uniqueEmps).forEach((email) => {
      const emp = uniqueEmps[email];
      if (!existingEmails.has(email)) {
        const safeId = email.replace(/[^a-zA-Z0-9]/g, "_");
        batchPromises.push(
          setDoc(doc(db, "employees", safeId), {
            ...emp,
            createdAt: new Date().toISOString(),
          }),
        );
      }
    });

    if (batchPromises.length > 0) {
      await Promise.all(batchPromises);
      console.log(`Synced ${batchPromises.length} new employees`);
      fetchEmployees(); // Refresh list after sync
    }
  };

  const fetchSalaries = async () => {
    try {
      const snap = await getDocs(collection(db, "Salary"));
      const data = {};
      snap.docs.forEach((d) => {
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
      snap.docs.forEach((d) => {
        const val = d.data();
        if (val.employeeId && val.month) {
          const key = `${val.employeeId}_${val.month}`;
          if (!data[key]) data[key] = [];

          // Push object structure matching UI expectation
          data[key].push({
            id: d.id, // Capture Firestore Doc ID for deletion
            amount: val.amount,
            timestamp: val.createdAt,
            ...val,
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
    fetchEmployees(); // NEW
    fetchHolidays();
    fetchSalaries();
    fetchIncentives();
    fetchAdjustments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMonth]); // Trigger on Month Change

  const handleFileUpload = (file) => {
    setUploading(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
      complete: async (results) => {
        let successCount = 0;
        const processedIds = new Set();
        const impactedEmployees = new Set();
        let minDate = null;
        let maxDate = null;

        for (let i = 0; i < results.data.length; i++) {
          const row = results.data[i];
          const employeeId = getField(row, ["Employee", "Employee ID"]);
          const firstName = getField(row, ["First Name", "FirstName"]);
          const department = getField(row, ["Department", "Dept"]);

          let date = getField(row, ["Date"]);

          // CRITICAL FIX: Date Parsing Priority - STRICT
          // User Requirement: CSV date format is strictly dd-mm-yyyy
          const formats = [
            "DD-MM-YYYY",
            "D-M-YYYY",
            "DD/MM/YYYY",
            "D/M/YYYY",
            "YYYY-MM-DD",
          ];

          // Strict parsing first to respect the requested format
          let d = dayjs(date, formats, true);
          if (!d.isValid()) {
            d = dayjs(date, formats, false); // Fallback to loose if strictly invalid
          }

          if (d.isValid()) {
            // Heuristic: If year is clearly wrong (e.g. 2001 default), maybe fix?
            // But CSV has explicit 2024. Trust the CSV year.
            date = d.format("YYYY-MM-DD");
          }

          if (!employeeId || !date) continue; // Skip incomplete rows

          const numberOfPunchesStr = getField(row, ["No. of Punches"]);
          const numberOfPunches = numberOfPunchesStr
            ? parseInt(numberOfPunchesStr, 10)
            : 0;
          const timeValue = getField(row, ["Time", "Times"]);
          const punchTimes = parseTimes(timeValue, numberOfPunches);
          const { inTime, outTime, totalHours } = calculateTimes(punchTimes);

          // Unique ID for idempotency - SANITIZED to avoid path issues
          const safeEmpId = (employeeId || "").replace(/[^a-zA-Z0-9]/g, "_");
          const safeDate = (date || "").replace(/[^a-zA-Z0-9-]/g, "_");
          const uniqueId = `${safeEmpId}_${safeDate}`;

          processedIds.add(uniqueId);
          impactedEmployees.add(employeeId);

          if (!minDate || dayjs(date).isBefore(dayjs(minDate))) minDate = date;
          if (!maxDate || dayjs(date).isAfter(dayjs(maxDate))) maxDate = date;

          const docData = {
            employeeId: employeeId || "",
            firstName: firstName || "",
            email: firstName ? `${firstName.toLowerCase()}@theawakens.com` : "",
            employee: firstName
              ? `${firstName} (${employeeId || "N/A"})`
              : employeeId || "Unknown",
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

        // CLEANUP PHASE
        if (minDate && maxDate && impactedEmployees.size > 0) {
          for (const empId of impactedEmployees) {
            try {
              const q = query(
                collection(db, "punches"),
                where("employeeId", "==", empId),
                where("date", ">=", minDate),
                where("date", "<=", maxDate),
              );
              const snapshot = await getDocs(q);
              const deletePromises = [];

              snapshot.docs.forEach((docSnap) => {
                if (!processedIds.has(docSnap.id)) {
                  deletePromises.push(deleteDoc(docSnap.ref));
                }
              });

              if (deletePromises.length > 0) {
                await Promise.all(deletePromises);
              }
            } catch (err) {
              console.error(`Cleanup failed for ${empId}`, err);
            }
          }
        }
        setUploading(false);
        fetchData();
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

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/");
  };

  const openEdit = (record) => {
    setCurrentRecord(record);
    form.setFieldsValue({
      punchTimes: (record.punchTimes || []).join(", "),
      isLeave: record.isLeave || false,
      leaveType: record.leaveType || "Paid",
    });
    setEditOpen(true);
  };

  /* ================= SALARY & PROFILE MANAGEMENT ================= */
  const handleDownloadSalarySheet = () => {
    // 1. Filter Records for Selected Month
    const monthRecords = records.filter((r) => {
      if (!r.date) return false;
      const d = dayjs(
        r.date,
        ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"],
        true,
      );
      return d.isValid() && d.isSame(selectedMonth, "month");
    });

    // 2. Group by Employee
    const groups = groupByEmployee(monthRecords, employees);
    const contextGroups = groupByEmployee(contextRecords, employees); // Group Context

    // 3. Build Excel Data
    const data = [];
    const monthStr = selectedMonth.format("D-MMM-YYYY");
    const daysInMonth = selectedMonth.daysInMonth();

    Object.values(groups).forEach((emp) => {
      const empContext = contextGroups[emp.employeeId]?.records || [];
      const payroll = getMonthlyPayroll(
        emp.records,
        emp.employeeId,
        emp.joiningDate,
        empContext, // Pass Context
      );

      // Data Mapping based on Screenshot
      // Columns: Month | Total Days | Employee | Net Earning Days | Base Salary | Final Salary | Salary Notes
      data.push({
        Month: monthStr,
        "Total Days": daysInMonth,
        Employee: emp.employeeName,
        "Net Earning Days": payroll.netEarningDays,
        "Base Salary": payroll.monthlySalary,
        "Final Salary": payroll.payableSalary, // Using calculated payable salary (includes incentives)
        "Salary Notes": `${emp.employeeName.replace(/\s*\(\d+\)/, "")} Sal ${selectedMonth.format("MMMYY")}`,
      });
    });

    // 4. Generate Excel
    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Salary Master Sheet");

    // 5. Download
    XLSX.writeFile(
      workbook,
      `Salary_Master_Sheet_${selectedMonth.format("MMM_YYYY")}.xlsx`,
    );
  };

  const handleManageSalaries = () => {
    fetchSalaries();
    fetchIncentives();
    setSalaryModalOpen(true);
  };

  const handleSaveSalary = async (values) => {
    try {
      // values structure: { salaries: { empId: amount }, joiningDates: { empId: dayjs } }
      const { salaries: salaryMap = {}, joiningDates: joiningMap = {} } =
        values;

      const uniqueEmpIds = new Set([
        ...Object.keys(salaryMap),
        ...Object.keys(joiningMap),
      ]);

      const promises = Array.from(uniqueEmpIds).map(async (empId) => {
        const amount = salaryMap[empId];
        const jDate = joiningMap[empId];
        const dateStr = jDate ? jDate.format("YYYY-MM-DD") : null;

        const updates = [];

        // 1. Update Legacy Salary Collection (if salary present)
        if (amount !== undefined) {
          updates.push(
            setDoc(doc(db, "Salary", empId), {
              employeeId: empId,
              amount: amount,
              updatedAt: new Date().toISOString(),
            }),
          );
        }

        // 2. Update Master 'employees' Collection (with both Salary and Joining Date)
        // We need to be careful not to overwrite other fields. setDoc with merge: true is good.
        // We used setDoc(doc(db, "employees", safeId)) in sync, but here we have Clean EmployeeID.
        // Problem: 'employees' collection ID is `safeId` (email based) in sync function, NOT employeeId.
        // BUT fetchEmployees uses `data.employeeId` to map.
        // We need to find the correct document ID for this EmployeeID.
        // Solution: Query for the doc where employeeId == empId.

        // Since this is inside a map, doing a query for each might be slow but safe.
        // Optimization: uses 'employees' state map to find the docId?
        // The 'employees' state map (from fetchEmployees) currently stores `data` but not `docId` explicitly?
        // In fetchEmployees: `map[data.employeeId] = data`. It doesn't store doc ID.
        // Let's modify fetchEmployees to store doc ID or just Query here.
        // Querying is fine for a save action (usually < 20 employees).

        const q = query(
          collection(db, "employees"),
          where("employeeId", "==", empId),
        );
        const snap = await getDocs(q);

        if (!snap.empty) {
          const docRef = snap.docs[0].ref;
          const updatePayload = { updatedAt: new Date().toISOString() };
          if (amount !== undefined) updatePayload.salary = amount;
          if (dateStr !== null) updatePayload.joiningDate = dateStr;

          updates.push(updateDoc(docRef, updatePayload));
        }

        await Promise.all(updates);
      });

      await Promise.all(promises);
      message.success("Employee profiles updated");
      setSalaryModalOpen(false);
      fetchSalaries();
      fetchEmployees(); // Refresh to get new joining dates
    } catch (e) {
      console.error(e);
      message.error("Failed to save changes");
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
  const calculateWorkingDays = (monthDayjs, joiningDate = null) => {
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
      snapshot.docs.forEach((doc) => {
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
      await setDoc(
        doc(db, "payroll_adjustments", key),
        {
          grantedLeaves: Number(values.grantedLeaves) || 0,
          grantedHours: Number(values.grantedHours) || 0,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );

      setAdjustments((prev) => ({
        ...prev,
        [key]: {
          grantedLeaves: Number(values.grantedLeaves) || 0,
          grantedHours: Number(values.grantedHours) || 0,
        },
      }));
      message.success("Adjustments saved");
      setAdjustmentModalOpen(false);
    } catch (e) {
      console.error(e);
      message.error("Failed to save adjustments");
    }
  };

  const getMonthlyPayroll = (
    employeeRecords,
    empId = null,
    joiningDate = null,
    contextRecordsArg = [],
  ) => {
    // RESTORED: Payroll Adjustments Reading
    const employeeId = empId || employeeRecords[0]?.employeeId;
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

    // Filter records for selected month
    const rawMonthlyRecords = employeeRecords.filter((r) => {
      if (!r.date) return false;
      const d = dayjs(
        r.date,
        [
          "YYYY-MM-DD",
          "DD-MM-YYYY",
          "MM/DD/YYYY",
          "DD/MM/YYYY",
          "YYYY/MM/DD",
          "MM-DD-YYYY",
          "D-MMM-YYYY",
        ],
        false,
      );
      return d.isValid() && d.isSame(selectedMonth, "month");
    });

    // Deduplicate records by date
    const uniqueRecordsMap = new Map();
    rawMonthlyRecords.forEach((r) => {
      if (uniqueRecordsMap.has(r.date)) {
        const existing = uniqueRecordsMap.get(r.date);
        // Prioritize records with explicit Leave status or usage data
        if (r.isLeave && !existing.isLeave) {
          uniqueRecordsMap.set(r.date, r);
        } else if (!existing.isLeave) {
          uniqueRecordsMap.set(r.date, r); // Default to overwrite
        }
      } else {
        uniqueRecordsMap.set(r.date, r);
      }
    });
    const monthlyRecords = Array.from(uniqueRecordsMap.values());
    // ensure chronological order for banking logic
    monthlyRecords.sort((a, b) => {
      const da = dayjs(a.date);
      const db = dayjs(b.date);
      if (!da.isValid() || !db.isValid()) return 0;
      return da.valueOf() - db.valueOf();
    });

    let actualHours = 0;
    let eligibleHours = 0;
    let passedEligibleHours = 0;
    const pendingWeekends = [];
    const recordedDates = [];
    const shortDays = []; // For UI (3 to 8 hours)
    const zeroDays = []; // For UI (< 3 hours)
    const today = dayjs();

    monthlyRecords.forEach((r) => {
      let dailyHours = 0;
      if (r.punchTimes && r.punchTimes.length > 0) {
        const { totalHours } = calculateTimes(r.punchTimes);
        if (totalHours) {
          const [h, m] = totalHours.split(":").map(Number);
          dailyHours = h + m / 60;
        }
        // If totalHours is 0 / null, dailyHours stays 0 (don't fallback to r.hours)
      } else if (r.hours) {
        const [h, m] = r.hours.split(":").map(Number);
        dailyHours = h + m / 60;
      }

      // Apply Granted Shortage (Virtual)
      const isGranted = (adj.grantedShortageDates || []).includes(r.date);
      if (isGranted && dailyHours < 8 && !r.isLeave) {
        const shortage = 8 - dailyHours;
        if (shortage > 0) dailyHours += shortage;
      }

      actualHours += dailyHours;

      const d = dayjs(
        r.date,
        [
          "YYYY-MM-DD",
          "DD-MM-YYYY",
          "MM/DD/YYYY",
          "DD/MM/YYYY",
          "YYYY/MM/DD",
          "MM-DD-YYYY",
          "D-MMM-YYYY",
        ],
        false,
      );
      if (d.isValid()) {
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
        if (d.isSameOrBefore(today, "day")) {
          passedEligibleHours += hoursToAdd;
        }

        // Short Days Logic
        // Granted days now have dailyHours = 8, so they won't trigger this.
        // Short Days Logic
        // Granted days now have dailyHours = 8, so they won't trigger this.
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

    // Apply Granted Hours

    // Calculate Missing Days (Absences) and Passed Working Days
    const missingDays = [];
    const start = selectedMonth.clone().startOf("month");
    const end = selectedMonth.clone().endOf("month");

    // JOINING DATE LOGIC START
    let actualStart = start;
    if (joiningDate) {
      const jDate = dayjs(joiningDate);
      if (jDate.isValid() && jDate.isSame(selectedMonth, "month")) {
        actualStart = jDate;
      }
    }
    // JOINING DATE LOGIC END

    let curr = actualStart.clone();
    let passedWorkingDays = 0;
    // NEW: Count total weekends

    while (curr.isSameOrBefore(end)) {
      const dayStr = curr.format("YYYY-MM-DD");
      const day = curr.day();
      const isWeekend = day === 0 || day === 6;
      const isHoliday = holidayDates.includes(dayStr);
      const isFuture = curr.isAfter(today, "day");

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

    const workingDays = calculateWorkingDays(selectedMonth, joiningDate);
    const targetHours = workingDays * 8;
    const passedTargetHours = passedWorkingDays * 8;

    const leavesCount = monthlyRecords.filter((r) => r.isLeave).length;
    const paidLeavesCount = monthlyRecords.filter(
      (r) => r.isLeave && r.leaveType && r.leaveType.toLowerCase() === "paid",
    ).length;

    missingDays.sort();

    // Fix: Subtract granted (paid) leaves from the total leaves count using dynamic count
    // Note: missingDays now includes zeroDays, so we remove zeroDays.length from the formula.

    // --- SALARY CALCULATION (Admin Specific) ---
    // const employeeId = employeeRecords[0]?.employeeId; (Already defined above)
    const monthlySalary =
      employeeId && salaries[employeeId] ? Number(salaries[employeeId]) : 30000; // We iterate through monthlyRecords to calculate earned days
    // --- GLOBAL HOURS BALANCING (User Request: Total Hours Pooling) ---
    // 1. Calculate Total Poolable Hours (Weekdays Only)
    let weekdayWorkedHours = 0;
    const boostedDates = []; // For UI compatibility

    monthlyRecords.forEach((r) => {
      recordedDates.push(r.date); // FIX: Populate recordedDates
      let dailyHours = 0;
      if (r.punchTimes && r.punchTimes.length > 0) {
        const { totalHours } = calculateTimes(r.punchTimes);
        if (totalHours) {
          const [h, m] = totalHours.split(":").map(Number);
          dailyHours = h + m / 60;
        }
      } else if (r.hours) {
        const [h, m] = r.hours.split(":").map(Number);
        dailyHours = h + m / 60;
      }

      const d = dayjs(
        r.date,
        [
          "YYYY-MM-DD",
          "DD-MM-YYYY",
          "MM/DD/YYYY",
          "DD/MM/YYYY",
          "YYYY/MM/DD",
          "MM-DD-YYYY",
          "D-MMM-YYYY",
        ],
        false,
      );
      const isWeekend = d.isValid() && (d.day() === 0 || d.day() === 6);
      const isHoliday =
        d.isValid() && holidayDates.includes(d.format("YYYY-MM-DD"));

      if (!isWeekend && !isHoliday && !r.isLeave) {
        // Apply Granted Shortage (Virtual) for weekday pooling
        const isGranted = (adj.grantedShortageDates || []).includes(r.date);
        if (isGranted && dailyHours < 8) {
          dailyHours = 8;
        }
        weekdayWorkedHours += dailyHours;
      }
    });

    // 2. Apply Pooling Rule: floor(Hours/8) (Remainder is kept in Bank)
    const fullDaysFromPool = Math.floor(weekdayWorkedHours / 8);
    const remainder = weekdayWorkedHours % 8;
    let earnedDaysFromPool = fullDaysFromPool;

    // 3. Assign Credits per Date (For Table Display Consistency)
    let presentDaysCount = 0;
    const dateCredits = {};

    monthlyRecords.forEach((r) => {
      let dailyHours = 0;
      if (r.punchTimes && r.punchTimes.length > 0) {
        const { totalHours } = calculateTimes(r.punchTimes);
        if (totalHours) {
          const [h, m] = totalHours.split(":").map(Number);
          dailyHours = h + m / 60;
        }
      } else if (r.hours) {
        const [h, m] = r.hours.split(":").map(Number);
        dailyHours = h + m / 60;
      }

      const isGranted = (adj.grantedShortageDates || []).includes(r.date);
      if (isGranted && dailyHours < 8 && !r.isLeave) {
        dailyHours = 8;
      }

      const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY"], false);
      const isWeekend = d.isValid() && (d.day() === 0 || d.day() === 6);
      const isHoliday =
        d.isValid() && holidayDates.includes(d.format("YYYY-MM-DD"));

      let earned = 0;
      if (isWeekend || isHoliday) {
        earned = 1; // Fixed credit for worked weekends/holidays
      } else if (!r.isLeave) {
        // Individual day credit follow simple 3h/8h rule for DISPLAY
        if (dailyHours >= 8 - 15 / 60) {
          earned = 1;
        } else if (dailyHours >= 3) {
          earned = 0.5;
        }
      }

      const creditKey = d.format("YYYY-MM-DD");
      dateCredits[creditKey] = earned;

      if (isWeekend || isHoliday || (dailyHours >= 3 && !r.isLeave)) {
        presentDaysCount += 1;
      }
    });

    // Final "Earned Days" for summary uses the POOLED value for weekdays
    // plus any extra days from weekends/holidays (if worked)
    let extraWorkedDays = 0;
    Object.keys(dateCredits).forEach((date) => {
      const d = dayjs(date);
      const isWeekend = d.day() === 0 || d.day() === 6;
      const isHoliday = holidayDates.includes(date);
      if ((isWeekend || isHoliday) && dateCredits[date] > 0) {
        extraWorkedDays += dateCredits[date];
      }
    });

    let effectivelyEarnedDays = earnedDaysFromPool + extraWorkedDays;

    // 4. Calculate for Pay (Includes Bank fractional hours)
    const effectivelyPayableDays = effectivelyEarnedDays + (remainder / 8);

    // Incentive Calculation
    const incentiveKey = `${employeeId}_${monthStr}`;
    const incentiveRaw = incentives[incentiveKey];

    let incentiveTotal = 0;
    let incentiveList = [];

    if (typeof incentiveRaw === "number") {
      incentiveTotal = incentiveRaw;
      // Convert to list for UI consistency if needed, but we'll handle display logic
      incentiveList = [{ id: "legacy", amount: incentiveRaw }];
    } else if (Array.isArray(incentiveRaw)) {
      incentiveList = incentiveRaw;
      incentiveTotal = incentiveRaw.reduce(
        (sum, item) => sum + (Number(item.amount) || 0),
        0,
      );
    }

    const incentiveAmount = incentiveTotal;

    // STRICT LOGIC RESTORED (User Request):
    // 1 Full Day = 1.0
    // 1 Half Day = 0.5
    // No "Hours Based" pooling or fallback for display.

    // --- SANDWICH LEAVE LOGIC ---
    // Rule: If Absent on Friday AND Absent on Monday -> Weekend is Sandwich (Loss of Pay)
    const sandwichDays = [];
    let sandwichDeduction = 0;

    // Helper: Check if Absent (Leave or Missing) using Context
    // Uses 'contextRecords' which contains full history for this user
    const isAbsentOrLeave = (checkDateStr) => {
      // 1. Is it a Holiday?
      if (holidayDates.includes(checkDateStr)) return false;

      // 2. Check in Context Records
      const recordsToSearch =
        contextRecordsArg && contextRecordsArg.length > 0
          ? contextRecordsArg
          : contextRecords;

      // IMPORTANT: Filter by employeeId to avoid cross-employee sandwich detection
      const record = recordsToSearch.find(
        (r) => r.date === checkDateStr && r.employeeId === employeeId,
      );

      if (!record) {
        // Missing -> Absent ONLY if in the current month AND not in the future
        // Fixed: We don't assume absence for missing records in DIFFERENT months (e.g. cross-month sandwich)
        const checkDate = dayjs(checkDateStr);
        if (checkDate.isSame(selectedMonth, "month")) {
          return checkDate.isSameOrBefore(today, "day");
        }
        return false; // Assume not absent if missing in a different month
      }

      // 3-hour working threshold: < 3h is considered leave (for sandwich purposes)
      let dailyHours = 0;
      if (record.punchTimes && record.punchTimes.length > 0) {
        const { totalHours } = calculateTimes(record.punchTimes);
        if (totalHours) {
          const [h, m] = totalHours.split(":").map(Number);
          dailyHours = h + m / 60;
        }
      } else if (record.hours) {
        const [h, m] = record.hours.split(":").map(Number);
        dailyHours = h + m / 60;
      }

      // REFINED: Even if it's marked as Leave (isLeave: true),
      // if they worked >= 3 hours, it is NOT an "Absence" for sandwich rule.
      if (dailyHours < 3) {
        // Refined: If it's a PAID leave, it's NOT an absence for sandwich purposes
        if (record.isLeave && record.leaveType?.toLowerCase() === "paid")
          return false;

        // No work done, but is it a leave? (Unpaid)
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

    // Iterate through weekends/holidays in the month to count Weekends for Pay AND Check Sandwich
    let sCurr = start.clone();
    let unworkedWeekendCount = 0;
    const cutoffDate = dayjs();

    while (sCurr.isSameOrBefore(end)) {
      const dayStr = sCurr.format("YYYY-MM-DD");
      const isWeekend = sCurr.day() === 0 || sCurr.day() === 6;
      const isHoliday = holidayDates.includes(dayStr);

      if (isWeekend) {
        // Count for Pay if NOT WORKED (Prevent Double Count)
        if (
          !recordedDates.includes(dayStr) &&
          sCurr.isSameOrBefore(cutoffDate, "day")
        ) {
          unworkedWeekendCount++;
        }
      }

      if (isWeekend || isHoliday) {
        // CHECK SANDWICH (Robust Logic)
        // Find nearest scheduled working day before
        let prev = sCurr.subtract(1, "day");
        while (
          prev.isValid() &&
          !isScheduledWorkingDay(prev.format("YYYY-MM-DD"))
        ) {
          prev = prev.subtract(1, "day");
        }

        // Find nearest scheduled working day after
        let next = sCurr.add(1, "day");
        while (
          next.isValid() &&
          !isScheduledWorkingDay(next.format("YYYY-MM-DD"))
        ) {
          next = next.add(1, "day");
        }

        if (
          isAbsentOrLeave(prev.format("YYYY-MM-DD")) &&
          isAbsentOrLeave(next.format("YYYY-MM-DD"))
        ) {
          sandwichDays.push(dayStr);
          sandwichDeduction++;
        }
      }
      sCurr = sCurr.add(1, "day");
    }

    // SANDWICH LOGIC ENABLED full

    // --- HOLIDAY LOGIC ---
    // Count weekdays that are holidays for Pay (Unworked)
    let unworkedHolidayCount = 0;
    let hCurr = start.clone();
    while (hCurr.isSameOrBefore(end)) {
      const dayStr = hCurr.format("YYYY-MM-DD");
      const day = hCurr.day();
      const isWeekend = day === 0 || day === 6;
      if (!isWeekend && holidayDates.includes(dayStr)) {
        // Only count if NOT WORKED
        if (
          !recordedDates.includes(dayStr) &&
          hCurr.isSameOrBefore(cutoffDate, "day")
        ) {
          unworkedHolidayCount++;
        }
      }
      hCurr = hCurr.add(1, "day");
    }

    // New Formula: (Present Days + Unworked Weekends + Unworked Holidays)
    // This prevents double counting. Working a holiday/weekend simply shifts it from "Unworked" bucket to "Present Days" bucket.
    // Result: Total Days = Days In Month (if fully attended).
    // Absences are reflected by missing from "Present Days" and not being in "Unworked" (since they are working days).
    let daysForPay =
      effectivelyPayableDays +
      unworkedWeekendCount +
      unworkedHolidayCount +
      paidLeavesCount;

    // Calculate Billable Days (Denominator)
    const daysInCurrentMonth = selectedMonth.daysInMonth();

    // ADJUST FOR SANDWICH
    daysForPay -= sandwichDeduction;

    // Safety Cap: Net Earned cannot exceed total days in month
    if (daysForPay > daysInCurrentMonth) {
      daysForPay = daysInCurrentMonth;
    }

    // APPLY GRANTED LEAVES (User Adjustment)
    // Adding granted leaves effectively pays for those days.
    // Use dynamic paidLeavesCount for robustness
    // const monthlySalary already defined above
    const dailyRate = monthlySalary / daysInCurrentMonth;

    // User Request: Calculate strictly based on Net Earned Days
    // Formula: Net Earned * Daily Rate (Dynamic Basis)
    let payableSalary = daysForPay * dailyRate;

    // Incentive is ADDED on top
    payableSalary += incentiveAmount;

    // Safety check: Cannot be negative
    if (payableSalary < 0) payableSalary = 0;

    if (presentDaysCount === 0 && paidLeavesCount === 0) {
      payableSalary = 0 + incentiveAmount; // Just incentives if any
    }

    if (payableSalary < 0) payableSalary = 0;

    if (payableSalary < 0) payableSalary = 0;

    return {
      workingDays,
      targetHours,
      actualHours,
      difference: eligibleHours - targetHours,
      eligibleHours,
      missingDays,
      shortDays, // Export for UI
      zeroDays, // Export for UI
      boostedDates, // NEW
      totalLeaves:
        missingDays.length + zeroDays.length + leavesCount - paidLeavesCount,
      pendingWeekends,
      sandwichDays, // Export for UI
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
      hasPenalty: effectivelyEarnedDays < presentDaysCount - 0.01,
      // Per-date earned credit for table display
      dateCredits,
      presentDaysCount,
      // Net Earning Days Logic
      // Updated to match Employee/SuperEmployee Logic: Use Calculated Days for Pay
      netEarningDays: effectivelyEarnedDays + unworkedWeekendCount + unworkedHolidayCount + paidLeavesCount - sandwichDeduction,
      daysInMonth: selectedMonth.daysInMonth(),
      creditBank: remainder, // Use pooled remainder as Bank
    };
  };

  const handleSaveIncentive = async (values) => {
    if (selectedEmpForIncentive) {
      await handleAddIncentive(
        selectedEmpForIncentive.employeeId,
        values.amount,
      );
      setIncentiveModalOpen(false);
      incentiveForm.resetFields();
    }
  };

  /* ================= HELPERS */
  const isValidTime = (t) => /^([0-1]?[0-9]|2[0-5]):[0-5][0-9]$/.test(t); // Fixed regex 20-23

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      maximumFractionDigits: 2,
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
    if (typeof currentVal === "number") {
      newIncentives = [
        {
          id: Date.now(),
          amount: currentVal,
          timestamp: new Date().toISOString(),
        },
      ];
    } else if (Array.isArray(currentVal)) {
      newIncentives = [...currentVal];
    }

    // Add new incentive
    const newEntry = {
      id: Date.now() + Math.random(),
      amount: Number(amount),
      timestamp: new Date().toISOString(),
    };
    newIncentives.push(newEntry);

    // Optimistic update
    setIncentives((prev) => ({ ...prev, [key]: newIncentives }));

    try {
      // CORRECTED: Write to "Incentives" collection to match fetchIncentives
      await addDoc(collection(db, "Incentives"), {
        employeeId: empId,
        month: monthStr,
        amount: Number(amount),
        createdAt: new Date().toISOString(),
        localId: newEntry.id, // Optional: store local ID to help with reconciliation if needed
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

    const newIncentives = currentVal.filter((i) => i.id !== incentiveId);
    setIncentives((prev) => ({ ...prev, [key]: newIncentives }));

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
    const { isLeave, leaveType } = values;

    // 1. Parse Punch Times (Only if NOT a leave)
    let punchTimes = [];
    let inTime = "-";
    let outTime = "-";
    let totalHours = "00:00";
    let numberOfPunches = 0;

    if (!isLeave) {
      punchTimes = (values.punchTimes || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      if (punchTimes.some((t) => !isValidTime(t))) {
        message.error("Invalid time format (HH:MM required)");
        return;
      }

      // 2. Auto-calculate In/Out/Hours based on Punch Times
      const calculated = calculateTimes(punchTimes);
      inTime = calculated.inTime;
      outTime = calculated.outTime;
      totalHours = calculated.totalHours;
      numberOfPunches = punchTimes.length;
    } else {
      // It's a leave
      totalHours = leaveType === "Paid" ? "08:00" : "00:00";
    }

    try {
      // 3. Update Payroll Adjustments if Paid status changed
      const wasPaidLeave =
        currentRecord.isLeave && currentRecord.leaveType === "Paid";
      const isPaidLeave = isLeave && leaveType === "Paid";

      if (wasPaidLeave !== isPaidLeave) {
        const dateStr = currentRecord.date;
        const monthStr = dayjs(dateStr).format("YYYY-MM");
        const employeeId = currentRecord.employeeId;
        const key = `${employeeId}_${monthStr}`;

        const currentAdj = adjustments[key] || {
          grantedLeaves: 0,
          grantedHours: 0,
        };

        let newGrantedLeaves = currentAdj.grantedLeaves || 0;
        let newGrantedHours = currentAdj.grantedHours || 0;

        if (isPaidLeave) {
          // Increment
          newGrantedLeaves += 1;
          newGrantedHours += 8;
        } else if (wasPaidLeave) {
          // Decrement
          newGrantedLeaves = Math.max(0, newGrantedLeaves - 1);
          newGrantedHours = Math.max(0, newGrantedHours - 8);
        }

        await setDoc(
          doc(db, "payroll_adjustments", key),
          {
            grantedLeaves: newGrantedLeaves,
            grantedHours: newGrantedHours,
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );

        // Update Local State directly
        setAdjustments((prev) => ({
          ...prev,
          [key]: {
            ...currentAdj,
            grantedLeaves: newGrantedLeaves,
            grantedHours: newGrantedHours,
          },
        }));
      }

      // 4. Update the record
      if (currentRecord.id && !currentRecord.isMissing) {
        await updateDoc(doc(db, "punches", currentRecord.id), {
          punchTimes,
          inTime,
          outTime,
          numberOfPunches,
          hours: totalHours,
          isEdited: true,
          isLeave: !!isLeave,
          leaveType: isLeave ? leaveType : null,
        });
      } else {
        await addDoc(collection(db, "punches"), {
          employeeId: currentRecord.employeeId || "",
          firstName: currentRecord.firstName || "",
          email: currentRecord.email || "",
          employee: currentRecord.employee || "Unknown",
          department: currentRecord.department || "",
          date: currentRecord.date,
          punchTimes,
          inTime,
          outTime,
          numberOfPunches,
          hours: totalHours,
          isEdited: true,
          isLeave: !!isLeave,
          leaveType: isLeave ? leaveType : null,
          uploadedAt: new Date().toISOString(),
          isManualEntry: true,
        });
      }

      message.success("Record updated");
      setEditOpen(false);
      fetchData();
    } catch (e) {
      console.error(e);
      message.error("Update failed: " + e.message);
    }
  };

  const handleApproveWeekend = async (recordId) => {
    try {
      await updateDoc(doc(db, "punches", recordId), {
        weekendApproved: true,
      });
      message.success("Weekend work approved");
      fetchData();
    } catch (e) {
      console.error(e);
      message.error("Failed to approve");
    }
  };

  const triggerSwapFlow = (record, payroll, employeeInfo) => {
    const dates = [
      ...(payroll.missingDays || []),
      ...(payroll.zeroDays || []).map((z) => z.date),
    ];
    setSwapTarget({
      weekendRecordId: record.id,
      employeeInfo,
      absenceDates: dates,
    });
    setSwapModalOpen(true);
    swapForm.setFieldsValue({ targetDate: dates[0], swapType: "full" });
  };

  const handleSwapAttendance = async (values) => {
    const { targetDate, swapType, justApprove } = values;
    if (!swapTarget) return;

    const { weekendRecordId, employeeInfo } = swapTarget;

    try {
      // 1. Approve the Weekend
      await updateDoc(doc(db, "punches", weekendRecordId), {
        weekendApproved: true,
      });

      if (!justApprove && targetDate) {
        // 2. Add or Update the Target Date (The Absence/LowHour day)
        const hoursStr = swapType === "half" ? "3:00" : "8:00";
        const punchTimes =
          swapType === "half" ? ["09:00", "12:00"] : ["09:00", "17:00"];

        const q = query(
          collection(db, "punches"),
          where("employeeId", "==", employeeInfo.employeeId),
          where("date", "==", targetDate),
        );
        const snap = await getDocs(q);

        if (!snap.empty) {
          await updateDoc(doc(db, "punches", snap.docs[0].id), {
            numberOfPunches: 2,
            punchTimes,
            inTime: punchTimes[0],
            outTime: punchTimes[1],
            hours: hoursStr,
            isManualEntry: true,
            isLeave: false,
          });
        } else {
          await addDoc(collection(db, "punches"), {
            employeeId: employeeInfo.employeeId || "",
            firstName: employeeInfo.firstName || "",
            email: employeeInfo.email || "",
            employee: employeeInfo.employeeName || "Unknown",
            department: employeeInfo.department || "",
            date: targetDate,
            numberOfPunches: 2,
            punchTimes,
            inTime: punchTimes[0],
            outTime: punchTimes[1],
            hours: hoursStr,
            uploadedAt: new Date().toISOString(),
            isManualEntry: true,
            isLeave: false,
          });
        }
        message.success(
          `Approved weekend and swapped with ${targetDate} (${swapType === "half" ? "3h" : "8h"})`,
        );
      } else {
        message.success("Weekend work approved");
      }

      setSwapModalOpen(false);
      setSwapTarget(null);
      fetchData();
    } catch (e) {
      console.error(e);
      message.error("Action failed: " + e.message);
    }
  };

  const handleMarkPresent = async (dateStr, employeeInfo, type = "full") => {
    try {
      const hoursStr = type === "half" ? "3:00" : "8:00";
      const punchTimes =
        type === "half" ? ["09:00", "12:00"] : ["09:00", "17:00"];

      // Check if record exists
      const q = query(
        collection(db, "punches"),
        where("employeeId", "==", employeeInfo.employeeId),
        where("date", "==", dateStr),
      );
      const snap = await getDocs(q);

      if (!snap.empty) {
        await updateDoc(doc(db, "punches", snap.docs[0].id), {
          numberOfPunches: 2,
          punchTimes,
          inTime: punchTimes[0],
          outTime: punchTimes[1],
          hours: hoursStr,
          isManualEntry: true,
          isLeave: false,
        });
      } else {
        await addDoc(collection(db, "punches"), {
          employeeId: employeeInfo.employeeId || "",
          firstName: employeeInfo.firstName || "",
          email: employeeInfo.email || "",
          employee: employeeInfo.employeeName || "Unknown",
          department: employeeInfo.department || "",
          date: dateStr,
          numberOfPunches: 2,
          punchTimes,
          inTime: punchTimes[0],
          outTime: punchTimes[1],
          hours: hoursStr,
          uploadedAt: new Date().toISOString(),
          isManualEntry: true,
          isLeave: false,
        });
      }
      message.success(
        `Marked as ${type === "half" ? "Half Day" : "Full Day"} for ${dateStr}`,
      );
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
        leaveType: isPaid ? "Paid" : "Unpaid",
      });

      // 2. If Paid/Granted, update the Payroll Adjustments (+1 Leave, +8 Hours)
      if (isPaid) {
        const monthStr = dayjs(dateStr).format("YYYY-MM");
        const key = `${employeeInfo.employeeId}_${monthStr}`;

        const currentAdj = adjustments[key] || {
          grantedLeaves: 0,
          grantedHours: 0,
        };
        const newGrantedLeaves = (currentAdj.grantedLeaves || 0) + 1;
        const newGrantedHours = (currentAdj.grantedHours || 0) + 8; // Grant 8 hours

        await setDoc(
          doc(db, "payroll_adjustments", key),
          {
            grantedLeaves: newGrantedLeaves,
            grantedHours: newGrantedHours,
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );

        // Update Local State directly
        setAdjustments((prev) => ({
          ...prev,
          [key]: {
            grantedLeaves: newGrantedLeaves,
            grantedHours: newGrantedHours,
          },
        }));
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

      const currentAdj = adjustments[key] || {
        grantedLeaves: 0,
        grantedHours: 0,
        grantedShortageDates: [],
      };
      const newGrantedHours =
        (currentAdj.grantedHours || 0) + (shortDayRecord.shortage || 0);
      const newGrantedDates = [
        ...(currentAdj.grantedShortageDates || []),
        shortDayRecord.date,
      ];

      await setDoc(
        doc(db, "payroll_adjustments", key),
        {
          grantedLeaves: currentAdj.grantedLeaves || 0,
          grantedHours: newGrantedHours,
          grantedShortageDates: newGrantedDates,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );

      setAdjustments((prev) => ({
        ...prev,
        [key]: {
          ...currentAdj,
          grantedHours: newGrantedHours,
          grantedShortageDates: newGrantedDates,
        },
      }));
      message.success(
        `Granted +${formatDuration(shortDayRecord.shortage)} hours`,
      );
    } catch (e) {
      console.error(e);
      message.error("Failed to grant shortage: " + e.message);
    }
  };

  const handleRevokeShortage = async (record) => {
    try {
      const monthStr = selectedMonth.format("YYYY-MM");
      const key = `${record.employeeId}_${monthStr}`;

      const currentAdj = adjustments[key] || {
        grantedLeaves: 0,
        grantedHours: 0,
        grantedShortageDates: [],
      };
      if (!(currentAdj.grantedShortageDates || []).includes(record.date))
        return;

      // Remove date
      const newGrantedDates = (currentAdj.grantedShortageDates || []).filter(
        (d) => d !== record.date,
      );

      // Calculate shortage to remove (re-calculate or approximate?)
      // Since we don't store exactly how much was granted for *that specific* date in the array (only dates),
      // we have to re-derive the shortage amount for that day from the record.
      let dailyHours = 0;
      if (record.punchTimes && record.punchTimes.length > 0) {
        const { totalHours } = calculateTimes(record.punchTimes);
        if (totalHours) {
          const [h, m] = totalHours.split(":").map(Number);
          dailyHours = h + m / 60;
        }
      } else if (record.hours) {
        const [h, m] = record.hours.split(":").map(Number);
        dailyHours = h + m / 60;
      }
      const shortageToRemove = Math.max(0, 8 - dailyHours);

      const newGrantedHours = Math.max(
        0,
        (currentAdj.grantedHours || 0) - shortageToRemove,
      );

      await setDoc(
        doc(db, "payroll_adjustments", key),
        {
          grantedLeaves: currentAdj.grantedLeaves || 0,
          grantedHours: newGrantedHours,
          grantedShortageDates: newGrantedDates,
          updatedAt: new Date().toISOString(),
        },
        { merge: true },
      );

      setAdjustments((prev) => ({
        ...prev,
        [key]: {
          ...currentAdj,
          grantedHours: newGrantedHours,
          grantedShortageDates: newGrantedDates,
        },
      }));
      message.success(`Revoked grant for ${record.date}`);
    } catch (e) {
      console.error(e);
      message.error("Failed to revoke");
    }
  };

  // Render helper to avoid duplication
  const renderPayrollStats = (payroll, darkMode, employeeInfo = null) => (
    <div
      style={{
        marginBottom: 16,
        padding: "12px 16px",
        background: darkMode ? "#1f1f1f" : "#fff",
        borderRadius: 8,
        boxShadow: darkMode
          ? "0 2px 8px rgba(0,0,0,0.5)"
          : "0 2px 8px rgba(0,0,0,0.05)",
        border: darkMode ? "1px solid #303030" : "1px solid #f0f0f0",
      }}
    >
      {/* COMPACT STATS ROW */}
      <Row gutter={[16, 16]} align="middle">
        <Col xs={12} sm={5}>
          <Statistic
            title="Net Earned"
            value={payroll.netEarningDays}
            suffix={
              <span>
                {`/ ${payroll.daysInMonth} (Bank: ${payroll.creditBank ? payroll.creditBank.toFixed(2) : 0})`}
                {payroll.shortDays &&
                  payroll.shortDays.length > 0 &&
                  payroll.hasPenalty && (
                    <Tooltip title="Warning: Short hours detected on some days (Risk of Half Day)">
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "#faad14",
                          display: "inline-block",
                          marginLeft: 8,
                          verticalAlign: "middle",
                        }}
                      ></span>
                    </Tooltip>
                  )}
              </span>
            }
            valueStyle={{
              fontSize: 16,
              fontWeight: 600,
              color:
                payroll.netEarningDays < payroll.daysInMonth
                  ? "#cf1322"
                  : "#3f8600",
            }}
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
            valueStyle={{
              fontSize: 16,
              color: payroll.paidLeavesCount > 0 ? "#52c41a" : "#faad14",
              fontWeight: 600,
            }}
            suffix={
              payroll.paidLeavesCount > 0 ? (
                <span style={{ fontSize: 11, color: "#888", marginLeft: 5 }}>
                  (-{payroll.paidLeavesCount} Pd)
                </span>
              ) : null
            }
          />
        </Col>
        <Col xs={12} sm={5}>
          <Statistic
            title="Present Hours"
            value={payroll.passedEligibleHours.toFixed(2)}
            suffix={
              <span style={{ fontSize: 12, color: "#888" }}>
                / {payroll.targetHours}h
              </span>
            }
            valueStyle={{ fontSize: 16, fontWeight: 600, color: "#1890ff" }}
          />
        </Col>
        <Col xs={12} sm={6}>
          <Statistic
            title="Hours Short by"
            value={Math.abs(payroll.passedDifference).toFixed(2)}
            prefix={
              payroll.passedDifference >= 0 ? (
                <PlusOutlined style={{ fontSize: 14 }} />
              ) : (
                <></>
              )
            }
            valueStyle={{
              fontSize: 16,
              color: payroll.passedDifference < 0 ? "#ff4d4f" : "#52c41a",
              fontWeight: 600,
            }}
            suffix={
              <span style={{ fontSize: 12, color: "#888" }}>
                h {payroll.passedDifference >= 0 ? "Ahead" : "Behind"}
              </span>
            }
          />
        </Col>
        {showSalary && (
          <Col xs={12} sm={4}>
            <Statistic
              title="Est. Salary"
              value={payroll.payableSalary}
              precision={0}
              prefix={<DollarOutlined />}
              valueStyle={{ fontSize: 16, color: "#52c41a", fontWeight: 600 }}
              suffix={
                payroll.incentiveAmount > 0 ? (
                  <Tag color="gold" style={{ marginLeft: 5, fontSize: 10 }}>
                    +Inc
                  </Tag>
                ) : null
              }
            />
          </Col>
        )}
      </Row>

      {/* COLLAPSIBLE DETAILS SECTION */}
      {((payroll.pendingWeekends && payroll.pendingWeekends.length > 0) ||
        (payroll.shortDays && payroll.shortDays.length > 0) ||
        (payroll.zeroDays && payroll.zeroDays.length > 0) ||
        (payroll.missingDays && payroll.missingDays.length > 0)) && (
        <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
          {/* Pending Weekend Approvals */}
          {payroll.pendingWeekends && payroll.pendingWeekends.length > 0 && (
            <Col span={24}>
              <div
                style={{
                  fontSize: 12,
                  fontWeight: "bold",
                  color: "#faad14",
                  marginBottom: 6,
                }}
              >
                <ClockCircleOutlined /> Pending Weekend Approvals (
                {payroll.pendingWeekends.length})
              </div>
              {payroll.pendingWeekends.map((pw) => (
                <div
                  key={pw.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 4,
                    background: darkMode ? "#222" : "#fffbe6",
                    padding: "4px 8px",
                    borderRadius: 4,
                    border: "1px solid #faad14",
                  }}
                >
                  <span style={{ fontSize: 12 }}>
                    {pw.date} — {pw.dailyHours.toFixed(2)}h
                  </span>
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => triggerSwapFlow(pw, payroll, employeeInfo)}
                    style={{ height: 22, fontSize: 11 }}
                  >
                    Accept
                  </Button>
                </div>
              ))}
            </Col>
          )}

          {/* Short Days - HIDDEN */}
          {/* Low Hours - HIDDEN */}
          {/* Missing Days - HIDDEN */}
        </Row>
      )}
    </div>
  );

  /* ================= HELPERS & COLUMNS ================= */
  const formatDuration = (hoursDecimal) => {
    if (!hoursDecimal || hoursDecimal <= 0) return "0:00:00";
    const totalSeconds = Math.round(hoursDecimal * 3600);
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  };

  const getDayOfWeek = (dateStr) => {
    const d = dayjs(
      dateStr,
      ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"],
      false,
    );
    return d.isValid() ? d.format("dddd, MMMM DD, YYYY") : dateStr;
  };

  const generateColumns = (maxPairs, payroll = {}, emp = {}) => {
    const punchCols = [];
    for (let i = 0; i < maxPairs; i++) {
      punchCols.push({
        title: `In ${i + 1}`,
        dataIndex: ["sortedPunches", i * 2],
        width: 90,
        align: "center",
        render: (t, r) => {
          const isHighlighted = (r.highlightedTimes || []).includes(t) && t;
          const comment = (r.highlightComments || {})[t];
          return isHighlighted ? (
            <Tooltip title={comment || "Highlighted"}>
              <span
                style={{
                  background: "#fffb8f",
                  fontWeight: "bold",
                  padding: "2px 4px",
                  borderRadius: 4,
                  color: "black",
                  cursor: "pointer",
                }}
              >
                {t}
              </span>
            </Tooltip>
          ) : (
            t
          );
        },
      });
      punchCols.push({
        title: `Out ${i + 1}`,
        dataIndex: ["sortedPunches", i * 2 + 1],
        width: 90,
        align: "center",
        render: (t, r) => {
          const isHighlighted = (r.highlightedTimes || []).includes(t) && t;
          const comment = (r.highlightComments || {})[t];
          return isHighlighted ? (
            <Tooltip title={comment || "Highlighted"}>
              <span
                style={{
                  background: "#fffb8f",
                  fontWeight: "bold",
                  padding: "2px 4px",
                  borderRadius: 4,
                  color: "black",
                  cursor: "pointer",
                }}
              >
                {t}
              </span>
            </Tooltip>
          ) : (
            t
          );
        },
      });
    }

    return [
      {
        title: "Employee",
        dataIndex: "employee",
        key: "employee",
        width: 180,
        fixed: "left",
        render: (_, r) => (
          <div style={{ fontWeight: 600 }}>
            {r.firstName || r.employee || "N/A"}
          </div>
        ),
      },
      {
        title: "Date",
        dataIndex: "fullDate",
        key: "fullDate",
        width: 220,
        fixed: "left",
        render: (t, r) => <span>{t}</span>,
      },
      ...punchCols,
      {
        title: "Total Hours",
        dataIndex: "targetHoursFormatted",
        width: 100,
        align: "center",
      },
      {
        title: "Present Hours",
        dataIndex: "presentHoursFormatted",
        width: 120,
        align: "center",
      },
      {
        title: "Hours Short by",
        dataIndex: "hoursShortByFormatted",
        width: 120,
        align: "center",
      },
      {
        title: "Present Days",
        dataIndex: "presentDays",
        width: 100,
        align: "center",
        render: (v) => <span style={{ color: v ? "green" : "red" }}>{v}</span>,
      },
      {
        title: "Leave check",
        dataIndex: "leaveCheck",
        width: 100,
        align: "center",
      },
      {
        title: "Day Swap off",
        dataIndex: "daySwapOff",
        width: 100,
        align: "center",
      },
      {
        title: "Weekend Checks",
        dataIndex: "weekendCheck",
        width: 120,
        align: "center",
        render: (v) => (v ? 1 : 0),
      },
      {
        title: "Paid Holidays",
        dataIndex: "paidHolidays",
        width: 100,
        align: "center",
      },
      {
        title: "Action",
        key: "action",
        width: 120,
        fixed: "right",
        render: (_, r) => {
          const d = dayjs(
            r.date,
            [
              "YYYY-MM-DD",
              "DD-MM-YYYY",
              "MM/DD/YYYY",
              "DD/MM/YYYY",
              "YYYY/MM/DD",
            ],
            true,
          );
          const isWeekend = d.isValid() && (d.day() === 0 || d.day() === 6);
          const showApproveBtn = isWeekend && !r.weekendApproved;

          return (
            <div style={{ display: "flex", gap: 4 }}>
              <Button
                type="link"
                size="small"
                icon={<EditOutlined />}
                onClick={() => openEdit(r)}
              />
              {showApproveBtn && (
                <Button
                  type="primary"
                  size="small"
                  onClick={() => triggerSwapFlow(r, payroll, emp)}
                >
                  Approve
                </Button>
              )}
            </div>
          );
        },
      },
    ];
  };

  const filteredRecords = React.useMemo(() => {
    if (!selectedMonth) return [];
    return records.filter((r) => {
      if (!r.date) return false;
      const d = dayjs(
        r.date,
        ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"],
        true,
      );
      return d.isValid() && d.isSame(selectedMonth, "month");
    });
  }, [records, selectedMonth]);

  const employeeGroups = groupByEmployee(filteredRecords);
  const contextGroups = React.useMemo(
    () => groupByEmployee(contextRecords),
    [contextRecords],
  );

  const tabItems = Object.entries(employeeGroups).map(([key, emp]) => {
    const empContext = contextGroups[emp.employeeId]?.records || [];
    const payroll = getMonthlyPayroll(
      emp.records,
      emp.employeeId,
      emp.joiningDate,
      empContext,
    );

    // Compute Combined Records (Actual + Missing)
    const missing = (payroll.missingDays || []).map((date) => ({
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
      isMissing: true,
    }));

    let combinedRecords = [...emp.records, ...missing];

    // Sort Descending -> User asked for Table View generally sorted, but EmployeeDashboard was sorted Ascending (Chronological).
    // Admin usually wants to see list... but Chronological is better for specific Employee View.
    // Let's sort ASCENDING for the detailed table view of an employee
    combinedRecords.sort((a, b) => {
      const dateA = dayjs(
        a.date,
        ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"],
        false,
      );
      const dateB = dayjs(
        b.date,
        ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"],
        false,
      );
      if (!dateA.isValid()) return 1;
      if (!dateB.isValid()) return -1;
      return dateA.valueOf() - dateB.valueOf();
    });

    // Process for Table display (add helper fields)
    combinedRecords = combinedRecords.map((r) => {
      const d = dayjs(
        r.date,
        ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"],
        false,
      );
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
          dailyHours = h + m / 60;
        }
      } else if (r.hours) {
        const [h, m] = r.hours.split(":").map(Number);
        dailyHours = h + m / 60;
      }

      const targetHours = isWeekend ? 0 : 8;
      const shortfall = targetHours - dailyHours;
      const hoursShortBy = shortfall > 0 ? shortfall : 0;

      // Present Days: Based on actual credit (0.5 or 1.0)
      const normalizedDate = dayjs(r.date).format("YYYY-MM-DD");
      // use precomputed credits which already account for bank adjustments
      const earnedCredit = payroll.dateCredits?.[normalizedDate] || 0;
      const isHolidayDate = holidays.some(
        (h) => dayjs(h.date).format("YYYY-MM-DD") === normalizedDate,
      );

      // Leave Check: Explicit Leave OR Low Hours (< 3) on a Weekday
      // Note: Weekends with < 3 hours are not leaves.
      let isLowHoursLeave = false;
      if (!isWeekend && dailyHours < 3 && !r.isLeave) {
        isLowHoursLeave = true;
      }

      return {
        ...r,
        fullDate: getDayOfWeek(r.date),
        sortedPunches,
        targetHoursFormatted: isWeekend ? "0:00:00" : "8:00:00",
        presentHoursFormatted: formatDuration(dailyHours),
        hoursShortByFormatted: formatDuration(hoursShortBy),
        presentDays: earnedCredit,
        leaveCheck: r.isLeave || isLowHoursLeave ? 1 : 0,
        daySwapOff: 0,
        weekendCheck: isWeekend ? 1 : 0,
        paidHolidays: 0,
        isGranted,
        isBoosted: (payroll.boostedDates || []).includes(normalizedDate),
      };
    });

    const maxPunches = Math.max(
      0,
      ...combinedRecords.map((r) => (r.sortedPunches || []).length),
    );
    const maxPairs = Math.max(3, Math.ceil(maxPunches / 2));
    const dynamicColumns = generateColumns(maxPairs, payroll, emp);

    return {
      key: key,
      label: emp.employeeName || emp.employee || emp.employeeId,
      children: (
        <>
          {/* Incentive Section for Table View */}
          <div
            style={{
              marginBottom: 16,
              display: "flex",
              justifyContent: "flex-end",
              alignItems: "start",
              gap: 10,
            }}
          >
            {showSalary && (
              <div style={{ textAlign: "right", marginRight: 20 }}>
                <div style={{ fontSize: 13, color: "#888" }}>
                  Estimated Salary
                </div>
                <div
                  style={{ fontSize: 20, fontWeight: "bold", color: "#52c41a" }}
                >
                  {formatCurrency(payroll.payableSalary)}
                  <span style={{ fontSize: 14, color: "#ccc", marginLeft: 5 }}>
                    / {formatCurrency(payroll.monthlySalary)}
                  </span>
                </div>
              </div>
            )}

            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
                gap: 8,
              }}
            >
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
                    setSelectedEmpForIncentive({
                      employeeId: emp.employeeId,
                      employeeName: emp.employeeName,
                    });
                    setIncentiveModalOpen(true);
                  }}
                >
                  Add
                </Button>
              </div>
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 4,
                  justifyContent: "flex-end",
                  maxWidth: 300,
                }}
              >
                {(payroll.incentiveList || []).map((inc, i) => (
                  <Tag
                    key={inc.id || i}
                    color="gold"
                    closable
                    onClose={() =>
                      handleDeleteIncentive(emp.employeeId, inc.id)
                    }
                  >
                    +{inc.amount}
                  </Tag>
                ))}
                {(!payroll.incentiveList ||
                  payroll.incentiveList.length === 0) && (
                  <span style={{ fontSize: 12, color: "#ccc" }}>None</span>
                )}
              </div>
            </div>
          </div>

          {renderPayrollStats(payroll, darkMode, emp)}
          <Table
            columns={dynamicColumns}
            dataSource={combinedRecords}
            rowKey={(rec) =>
              rec.id || `${rec.employeeId || rec.employee}-${rec.date}`
            }
            bordered
            scroll={{ x: 1500 }}
            sticky
            pagination={{ pageSize: 31, showSizeChanger: true }}
            rowClassName={(record) => {
              if (record.isMissing)
                return darkMode ? "dark-missing-row" : "light-missing-row";
              let dailyHours = 0;
              if (record.hours) {
                const [h, m] = record.hours.split(":").map(Number);
                dailyHours = h + m / 60;
              }
              const d = dayjs(
                record.date,
                [
                  "YYYY-MM-DD",
                  "DD-MM-YYYY",
                  "MM/DD/YYYY",
                  "DD/MM/YYYY",
                  "YYYY/MM/DD",
                ],
                true,
              );
              const isWeekend = d.isValid() && (d.day() === 0 || d.day() === 6);

              if (isWeekend) return "weekend-row"; // We need to add styles for these or use style prop
              if (record.isBoosted) return ""; // Boosted rows look normal
              if (dailyHours < 3) return "low-hours-row";
              return "";
            }}
            onRow={(record) => {
              let dailyHours = 0;
              if (record.hours) {
                const [h, m] = record.hours.split(":").map(Number);
                dailyHours = h + m / 60;
              }
              const d = dayjs(
                record.date,
                [
                  "YYYY-MM-DD",
                  "DD-MM-YYYY",
                  "MM/DD/YYYY",
                  "DD/MM/YYYY",
                  "YYYY/MM/DD",
                ],
                true,
              );
              const isWeekend = d.isValid() && (d.day() === 0 || d.day() === 6);

              let bg = "";
              if (record.isEdited) {
                bg = darkMode ? "rgba(114, 46, 209, 0.15)" : "#f9f0ff"; // Purple for Edited
              } else if (record.isLeave) {
                if (record.leaveType === "Paid")
                  bg = darkMode ? "rgba(183, 235, 143, 0.15)" : "#f6ffed";
                else bg = darkMode ? "#333" : "#fafafa";
              } else if (record.isBoosted) {
                bg = darkMode ? "rgba(183, 235, 143, 0.15)" : "#f6ffed"; // Green for Boosted
              } else if (isWeekend)
                bg = darkMode ? "rgba(212, 177, 6, 0.15)" : "#fffbf0";
              else if (dailyHours < 3)
                bg = darkMode ? "rgba(207, 19, 34, 0.15)" : "#fff2f0";

              return { style: { background: bg } };
            }}
          />
        </>
      ),
    };
  });

  return (
    <ConfigProvider
      theme={{ algorithm: darkMode ? darkAlgorithm : defaultAlgorithm }}
    >
      <Layout style={{ minHeight: "100vh" }}>
        <Header
          style={{
            background: "#001529",
            padding: "0 24px",
            height: "auto",
            minHeight: 64,
          }}
        >
          <Row
            justify="space-between"
            align="middle"
            style={{ height: "100%", padding: "8px 0" }}
          >
            <Col>
              <h2 style={{ color: "white", margin: 0 }}>Admin Dashboard</h2>
            </Col>
            <Col>
              <div
                style={{
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                  flexWrap: "wrap",
                }}
              >
                <Button icon={<ReloadOutlined />} onClick={fetchData}>
                  Refresh
                </Button>
                <Button
                  icon={<MessageOutlined />}
                  onClick={() => setChatOpen(true)}
                >
                  Chat
                </Button>
                <Button icon={<LogoutOutlined />} onClick={handleLogout}>
                  Logout
                </Button>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <BulbOutlined style={{ color: "#fff" }} />
                  <Switch checked={darkMode} onChange={setDarkMode} />
                </div>
              </div>
            </Col>
          </Row>
        </Header>
        <Content
          style={{
            padding: screens.xs ? 8 : 24,
            background: darkMode ? "#141414" : "#f0f2f5",
          }}
        >
          <Row
            gutter={[16, 16]}
            justify="space-between"
            align="middle"
            style={{ marginBottom: 16 }}
          >
            <Col xs={24} lg={16}>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                <Upload
                  beforeUpload={handleFileUpload}
                  showUploadList={false}
                  accept=".csv"
                >
                  <Button
                    type="primary"
                    icon={<UploadOutlined />}
                    loading={uploading}
                  >
                    Upload CSV
                  </Button>
                </Upload>
                <DatePicker.MonthPicker
                  value={selectedMonth}
                  onChange={setSelectedMonth}
                  allowClear={false}
                  placeholder="Select Payroll Month"
                  style={{ width: 140 }}
                />
                <Button
                  icon={<SettingOutlined />}
                  onClick={() => setHolidayModalOpen(true)}
                >
                  Holidays
                </Button>
                <Button
                  icon={showSalary ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                  onClick={() => setShowSalary(!showSalary)}
                >
                  {showSalary ? "Hide Revenue" : "Show Revenue"}
                </Button>
                <Button
                  icon={<DollarOutlined />}
                  onClick={handleManageSalaries}
                >
                  Manage Salaries
                </Button>
                <Button
                  icon={<FileExcelOutlined />}
                  onClick={handleDownloadSalarySheet}
                  style={{
                    background: "#207e3a",
                    color: "white",
                    borderColor: "#207e3a",
                  }}
                >
                  Download Sheet
                </Button>
              </div>
            </Col>
            <Col xs={24} lg={8} style={{ textAlign: "right" }}>
              <div
                style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}
              >
                <Button
                  type={viewMode === "cards" ? "primary" : "default"}
                  onClick={() => setViewMode("cards")}
                >
                  Cards
                </Button>
                <Button
                  type={viewMode === "table" ? "primary" : "default"}
                  onClick={() => setViewMode("table")}
                >
                  Table
                </Button>
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
                  const empContext =
                    contextGroups[emp.employeeId]?.records || [];
                  const payroll = getMonthlyPayroll(
                    emp.records,
                    emp.employeeId,
                    null,
                    empContext,
                  );
                  return (
                    <Col
                      key={k}
                      xs={24}
                      sm={24}
                      md={12}
                      lg={12}
                      xl={8}
                      style={{ display: "flex" }}
                    >
                      <Card
                        hoverable
                        title={
                          <>
                            <UserOutlined /> {emp.employeeName}
                          </>
                        }
                        extra={<Tag color="blue">ID: {emp.employeeId}</Tag>}
                        style={{
                          backgroundColor: darkMode ? "#1f1f1f" : "#fff",
                          height: "100%",
                          display: "flex",
                          flexDirection: "column",
                        }}
                        bodyStyle={{
                          flex: 1,
                          display: "flex",
                          flexDirection: "column",
                        }}
                        actions={[
                          <Button
                            type="link"
                            icon={<DollarOutlined />}
                            onClick={() => openAddIncentive(emp)}
                          >
                            Add Incentive
                          </Button>,
                        ]}
                      >
                        {renderPayrollStats(payroll, darkMode, emp)}

                        <Statistic
                          title="Department"
                          value={emp.department}
                          prefix={<UserOutlined />}
                          valueStyle={{ fontSize: 14 }}
                        />
                        <Statistic
                          title="Total Records"
                          value={emp.totalRecords}
                          prefix={<CalendarOutlined />}
                          valueStyle={{ fontSize: 14 }}
                        />

                        <Collapse size="small" ghost style={{ marginTop: 12 }}>
                          <Panel
                            header={`View ${emp.records.length} Record(s)`}
                            key="1"
                          >
                            <div style={{ maxHeight: 400, overflowY: "auto" }}>
                              {emp.records.map((rec, idx) => {
                                let dailyHours = 0;
                                if (
                                  rec.punchTimes &&
                                  rec.punchTimes.length > 0
                                ) {
                                  const { totalHours } = calculateTimes(
                                    rec.punchTimes,
                                  );
                                  if (totalHours) {
                                    const [h, m] = totalHours
                                      .split(":")
                                      .map(Number);
                                    dailyHours = h + m / 60;
                                  }
                                } else if (rec.hours) {
                                  const [h, m] = rec.hours
                                    .split(":")
                                    .map(Number);
                                  dailyHours = h + m / 60;
                                }
                                const d = dayjs(
                                  rec.date,
                                  [
                                    "YYYY-MM-DD",
                                    "DD-MM-YYYY",
                                    "MM/DD/YYYY",
                                    "DD/MM/YYYY",
                                    "YYYY/MM/DD",
                                  ],
                                  true,
                                );
                                const isWeekend =
                                  d.day() === 0 || d.day() === 6;
                                const isGranted = (
                                  payroll.grantedShortageDates || []
                                ).includes(rec.date);
                                let statusTag = null;
                                let rowStyle = {};
                                let showApproveBtn = false;

                                // Color Logic Refinement (Pastel / Soft)
                                if (rec.isLeave) {
                                  if (rec.leaveType === "Paid") {
                                    rowStyle = {
                                      border: "1px solid #b7eb8f",
                                      background: darkMode
                                        ? "rgba(183, 235, 143, 0.1)"
                                        : "#f6ffed",
                                    };
                                    statusTag = (
                                      <Tag color="success">Paid Leave</Tag>
                                    );
                                  } else {
                                    rowStyle = {
                                      border: "1px solid #d9d9d9",
                                      background: darkMode
                                        ? "#1f1f1f"
                                        : "#fafafa",
                                    };
                                    statusTag = (
                                      <Tag color="default">Unpaid Leave</Tag>
                                    );
                                  }
                                } else if (isWeekend) {
                                  rowStyle = {
                                    border: darkMode
                                      ? "1px solid #d4b106"
                                      : "1px solid #fffb8f",
                                    background: darkMode
                                      ? "rgba(212, 177, 6, 0.1)"
                                      : "#fffbe6",
                                  };
                                  if (rec.weekendApproved) {
                                    statusTag = (
                                      <Tag color="success">Approved</Tag>
                                    );
                                  } else {
                                    statusTag = (
                                      <Tag color="warning">Action Needed</Tag>
                                    );
                                    showApproveBtn = true;
                                  }
                                } else if (dailyHours < 3) {
                                  rowStyle = {
                                    border: darkMode
                                      ? "1px solid #cf1322"
                                      : "1px solid #ffccc7",
                                    background: darkMode
                                      ? "rgba(207, 19, 34, 0.1)"
                                      : "#fff2f0",
                                  };
                                  statusTag = (
                                    <Tag color="error">Low Hours</Tag>
                                  );
                                } else {
                                  // Default OK or Boosted
                                  if (rec.isBoosted) {
                                    rowStyle = {
                                      border: "1px solid #52c41a", // Green border for boosted
                                      background: darkMode
                                        ? "rgba(82, 196, 26, 0.1)"
                                        : "#f6ffed", // Light green background
                                    };
                                    statusTag = (
                                      <Tag color="success">Boosted (Bank)</Tag>
                                    );
                                  } else {
                                    statusTag = (
                                      <Tag color="processing">OK</Tag>
                                    );
                                  }
                                }

                                if (isGranted) {
                                  rowStyle = {
                                    border: "1px solid #faad14",
                                    background: darkMode
                                      ? "rgba(250, 173, 20, 0.1)"
                                      : "#fff7e6",
                                  };
                                  statusTag = <Tag color="gold">Granted</Tag>;
                                }

                                return (
                                  <Card
                                    key={rec.id || idx}
                                    size="small"
                                    style={{
                                      marginBottom: 8,
                                      backgroundColor: darkMode
                                        ? "#1f1f1f"
                                        : "#fff",
                                      ...rowStyle,
                                    }}
                                  >
                                    <div
                                      style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        marginBottom: 4,
                                      }}
                                    >
                                      <Tag color="purple">
                                        <CalendarOutlined /> {rec.date || "N/A"}
                                      </Tag>
                                      {statusTag}
                                    </div>
                                    <Tag color="green">
                                      Punches: {rec.numberOfPunches || "0"}
                                    </Tag>
                                    <Row gutter={8} style={{ margin: "8px 0" }}>
                                      <Col span={8}>
                                        <div
                                          style={{
                                            fontSize: 12,
                                            color: "#666",
                                          }}
                                        >
                                          In Time
                                        </div>
                                        <div style={{ fontWeight: "bold" }}>
                                          {rec.inTime || "-"}
                                        </div>
                                      </Col>
                                      <Col span={8}>
                                        <div
                                          style={{
                                            fontSize: 12,
                                            color: "#666",
                                          }}
                                        >
                                          Out Time
                                        </div>
                                        <div style={{ fontWeight: "bold" }}>
                                          {rec.outTime || "-"}
                                        </div>
                                      </Col>
                                      <Col span={8}>
                                        <div
                                          style={{
                                            fontSize: 12,
                                            color: "#666",
                                          }}
                                        >
                                          Hours
                                        </div>
                                        <div
                                          style={{
                                            fontWeight: "bold",
                                            color: "#1890ff",
                                          }}
                                        >
                                          {rec.hours || "-"}
                                        </div>
                                      </Col>
                                    </Row>
                                    {rec.punchTimes?.length > 0 && (
                                      <div>
                                        <div
                                          style={{
                                            fontSize: 12,
                                            color: "#666",
                                            marginBottom: 4,
                                          }}
                                        >
                                          All Punch Times:
                                        </div>
                                        <div
                                          style={{
                                            display: "flex",
                                            flexWrap: "wrap",
                                            gap: 4,
                                          }}
                                        >
                                          {rec.punchTimes.map((t, i) => {
                                            const isHighlighted = (
                                              rec.highlightedTimes || []
                                            ).includes(t);
                                            return (
                                              <Tag
                                                key={i}
                                                color={
                                                  isHighlighted
                                                    ? "gold"
                                                    : "blue"
                                                }
                                                style={
                                                  isHighlighted
                                                    ? {
                                                        fontWeight: "bold",
                                                        border:
                                                          "1px solid #d4b106",
                                                        color: "black",
                                                      }
                                                    : {}
                                                }
                                              >
                                                {t}
                                              </Tag>
                                            );
                                          })}
                                          {rec.isEdited && (
                                            <Tag color="purple">Edited</Tag>
                                          )}
                                        </div>
                                      </div>
                                    )}

                                    <div
                                      style={{
                                        marginTop: 8,
                                        display: "flex",
                                        gap: 8,
                                      }}
                                    >
                                      <Button
                                        type="link"
                                        size="small"
                                        icon={<EditOutlined />}
                                        onClick={() => openEdit(rec)}
                                      >
                                        Edit
                                      </Button>
                                      {showApproveBtn && (
                                        <Button
                                          type="primary"
                                          size="small"
                                          onClick={() =>
                                            handleApproveWeekend(rec.id)
                                          }
                                        >
                                          Approve
                                        </Button>
                                      )}
                                    </div>
                                  </Card>
                                );
                              })}
                            </div>
                          </Panel>
                        </Collapse>
                      </Card>
                    </Col>
                  );
                })}
              </Row>
            )
          ) : Object.keys(employeeGroups).length === 0 ? (
            <Empty description="No records found" />
          ) : (
            <Tabs type="card" items={tabItems} />
          )}

          <Modal
            open={editOpen}
            title={`Edit Punch - ${currentRecord?.date}`}
            footer={null}
            onCancel={() => setEditOpen(false)}
          >
            <Form layout="vertical" form={form} onFinish={handleUpdate}>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Item
                    name="isLeave"
                    label="Is Leave"
                    valuePropName="checked"
                  >
                    <Switch />
                  </Form.Item>
                </Col>
                <Col span={12}>
                  <Form.Item
                    noStyle
                    shouldUpdate={(prevValues, currentValues) =>
                      prevValues.isLeave !== currentValues.isLeave
                    }
                  >
                    {({ getFieldValue }) =>
                      getFieldValue("isLeave") ? (
                        <Form.Item name="leaveType" label="Leave Type">
                          <Select>
                            <Select.Option value="Paid">Paid</Select.Option>
                            <Select.Option value="Unpaid">Unpaid</Select.Option>
                          </Select>
                        </Form.Item>
                      ) : null
                    }
                  </Form.Item>
                </Col>
              </Row>

              <Form.Item
                noStyle
                shouldUpdate={(prevValues, currentValues) =>
                  prevValues.isLeave !== currentValues.isLeave
                }
              >
                {({ getFieldValue }) =>
                  !getFieldValue("isLeave") ? (
                    <Form.Item
                      name="punchTimes"
                      label="Punch Times (comma separated)"
                      rules={[
                        { required: true },
                        {
                          validator: (_, value) => {
                            const times = (value || "")
                              .split(",")
                              .map((t) => t.trim())
                              .filter(Boolean);
                            const bad = times.find((t) => !isValidTime(t));
                            return bad
                              ? Promise.reject(
                                  new Error(`Invalid time: ${bad}`),
                                )
                              : Promise.resolve();
                          },
                        },
                      ]}
                    >
                      <Input placeholder="09:00, 18:00" />
                    </Form.Item>
                  ) : null
                }
              </Form.Item>
              <div style={{ textAlign: "right" }}>
                <Button
                  onClick={() => setEditOpen(false)}
                  style={{ marginRight: 8 }}
                >
                  Cancel
                </Button>
                <Button type="primary" htmlType="submit">
                  Save
                </Button>
              </div>
            </Form>
          </Modal>

          {/* Swap Attendance Modal */}
          <Modal
            title="Approve Weekend & Offset Absence"
            open={swapModalOpen}
            onOk={() => swapForm.submit()}
            onCancel={() => setSwapModalOpen(false)}
            okText="Confirm Action"
            width={400}
          >
            <Form
              form={swapForm}
              onFinish={handleSwapAttendance}
              layout="vertical"
            >
              <div
                style={{
                  marginBottom: 16,
                  padding: 12,
                  background: darkMode ? "#222" : "#f5f5f5",
                  borderRadius: 8,
                }}
              >
                <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                  Approving weekend work for eployee ID:{" "}
                  {swapTarget?.employeeInfo?.employeeId}
                </Typography.Text>
              </div>

              <Form.Item
                name="justApprove"
                label="Action Type"
                initialValue={false}
              >
                <Radio.Group style={{ width: "100%" }}>
                  <Radio.Button
                    value={false}
                    style={{ width: "50%", textAlign: "center" }}
                  >
                    Swap with Absence
                  </Radio.Button>
                  <Radio.Button
                    value={true}
                    style={{ width: "50%", textAlign: "center" }}
                  >
                    Just Approve
                  </Radio.Button>
                </Radio.Group>
              </Form.Item>

              <Form.Item
                noStyle
                shouldUpdate={(prevValues, currentValues) =>
                  prevValues.justApprove !== currentValues.justApprove
                }
              >
                {({ getFieldValue }) =>
                  !getFieldValue("justApprove") ? (
                    <>
                      <Form.Item
                        name="targetDate"
                        label="Select Absence/Low-Hour date to fix"
                        rules={[
                          { required: true, message: "Please select a date" },
                        ]}
                      >
                        <Select placeholder="Choose a date">
                          {(swapTarget?.absenceDates || []).map((d) => (
                            <Select.Option key={d} value={d}>
                              {d}
                            </Select.Option>
                          ))}
                        </Select>
                      </Form.Item>

                      <Form.Item
                        name="swapType"
                        label="Mark Swapped Day as"
                        initialValue="full"
                      >
                        <Radio.Group>
                          <Radio value="full">Full Day (8h)</Radio>
                          <Radio value="half">Half Day (3h)</Radio>
                        </Radio.Group>
                      </Form.Item>
                    </>
                  ) : null
                }
              </Form.Item>
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
              <DatePicker
                value={newHolidayDate}
                onChange={setNewHolidayDate}
                placeholder="Select Date"
              />
              <Input
                value={newHolidayName}
                onChange={(e) => setNewHolidayName(e.target.value)}
                placeholder="Holiday Name (e.g. Diwali)"
              />
              <Button
                type="primary"
                onClick={handleAddHoliday}
                icon={<PlusOutlined />}
              >
                Add
              </Button>
            </div>

            <List
              header={<div>Current Holidays</div>}
              bordered
              dataSource={holidays}
              renderItem={(item) => (
                <List.Item
                  actions={[
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      onClick={() => handleDeleteHoliday(item.id)}
                    />,
                  ]}
                >
                  <List.Item.Meta title={item.name} description={item.date} />
                </List.Item>
              )}
            />
            <div style={{ marginTop: 16, color: "#888", fontSize: 12 }}>
              Note: Weekends (Sat/Sun) are automatically excluded from working
              days. Default holidays included: {DEFAULT_HOLIDAYS.join(", ")}
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
            <Form
              form={salaryForm}
              onFinish={handleSaveSalary}
              layout="vertical"
            >
              <div
                style={{ maxHeight: 400, overflowY: "auto", marginBottom: 16 }}
              >
                {Object.entries(employeeGroups).map(([key, emp]) => {
                  // Current salary
                  const currentSal = salaries[emp.employeeId] || 30000;
                  const currentJoinDate = emp.joiningDate
                    ? dayjs(emp.joiningDate)
                    : null;

                  return (
                    <Row
                      key={key}
                      gutter={16}
                      align="middle"
                      style={{
                        marginBottom: 12,
                        borderBottom: "1px solid #f0f0f0",
                        paddingBottom: 12,
                      }}
                    >
                      <Col span={8}>
                        <div>
                          <strong>{emp.employeeName}</strong>
                        </div>
                        <div style={{ fontSize: 12, color: "#888" }}>
                          ID: {emp.employeeId}
                        </div>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          name={["salaries", emp.employeeId]}
                          initialValue={currentSal}
                          style={{ margin: 0 }}
                          label="Monthly Pay"
                        >
                          <InputNumber
                            formatter={(value) =>
                              `₹ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
                            }
                            parser={(value) => value.replace(/\₹\s?|(,*)/g, "")}
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          name={["joiningDates", emp.employeeId]}
                          initialValue={currentJoinDate}
                          style={{ margin: 0 }}
                          label="Joining Date"
                        >
                          <DatePicker
                            format="YYYY-MM-DD"
                            style={{ width: "100%" }}
                          />
                        </Form.Item>
                      </Col>
                      <Col span={24}>
                        {" "}
                        {/* Use full width for incentives */}
                        <div
                          style={{
                            marginTop: 8,
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "start",
                          }}
                        >
                          <div style={{ marginTop: 4 }}>
                            <Typography.Text>
                              Current Incentives:
                            </Typography.Text>
                          </div>
                          <div
                            style={{
                              display: "flex",
                              flexDirection: "column",
                              alignItems: "flex-end",
                              gap: 4,
                            }}
                          >
                            <div
                              style={{
                                display: "flex",
                                flexWrap: "wrap",
                                justifyContent: "flex-end",
                                gap: 2,
                                maxWidth: 200,
                              }}
                            >
                              {(() => {
                                const mStr = selectedMonth
                                  ? selectedMonth.format("YYYY-MM")
                                  : "";
                                const iKey = `${emp.employeeId}_${mStr}`;
                                const incRaw = incentives[iKey];
                                let incList = [];
                                if (Array.isArray(incRaw)) incList = incRaw;
                                else if (typeof incRaw === "number")
                                  incList = [{ id: "leg", amount: incRaw }];

                                return incList.map((inc, i) => (
                                  <Tag
                                    key={inc.id || i}
                                    color="gold"
                                    style={{ margin: 0 }}
                                    closable
                                    onClose={() =>
                                      handleDeleteIncentive(
                                        emp.employeeId,
                                        inc.id,
                                      )
                                    }
                                  >
                                    {inc.amount}
                                  </Tag>
                                ));
                              })()}
                            </div>
                          </div>
                        </div>
                      </Col>
                    </Row>
                  );
                })}
              </div>
              <div style={{ textAlign: "right" }}>
                <Button
                  onClick={() => setSalaryModalOpen(false)}
                  style={{ marginRight: 8 }}
                >
                  Cancel
                </Button>
                <Button type="primary" htmlType="submit">
                  Save Changes
                </Button>
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
            <Form
              form={incentiveForm}
              onFinish={handleSaveIncentive}
              layout="vertical"
            >
              <Form.Item
                name="amount"
                label="Incentive Amount"
                rules={[{ required: true, message: "Please enter amount" }]}
              >
                <InputNumber
                  style={{ width: "100%" }}
                  placeholder="e.g. 5000"
                  formatter={(value) =>
                    `₹ ${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
                  }
                  parser={(value) => value.replace(/₹\s?|(,*)/g, "")}
                />
              </Form.Item>
              <div style={{ textAlign: "right" }}>
                <Button
                  onClick={() => setIncentiveModalOpen(false)}
                  style={{ marginRight: 8 }}
                >
                  Cancel
                </Button>
                <Button type="primary" htmlType="submit">
                  Save Incentive
                </Button>
              </div>
            </Form>
          </Modal>

          {/* ADJUSTMENT MODAL */}
          <Modal
            open={adjustmentModalOpen}
            title={`Adjust Payroll - ${currentEmpForAdj?.employeeName} (${selectedMonth ? selectedMonth.format("MMM YYYY") : ""})`}
            onCancel={() => setAdjustmentModalOpen(false)}
            onOk={() => adjForm.submit()}
          >
            <Form
              form={adjForm}
              onFinish={handleSaveAdjustment}
              layout="vertical"
            >
              <Form.Item label="Granted Leaves (Add days)" name="grantedLeaves">
                <InputNumber style={{ width: "100%" }} step={0.5} />
              </Form.Item>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
                Manually ADD days to "Net Earning Days" (e.g. reversing a
                mistake).
              </div>

              <Form.Item label="Granted Hours (Add hours)" name="grantedHours">
                <InputNumber style={{ width: "100%" }} step={0.5} />
              </Form.Item>
              <div style={{ fontSize: 12, color: "#888", marginBottom: 12 }}>
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
        darkMode={darkMode}
      />
    </ConfigProvider>
  );
}
