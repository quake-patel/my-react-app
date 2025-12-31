import React, { useEffect, useState } from "react";
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
  Card,
  Tag,
  Space,
  DatePicker,
  Row,
  Col,
  Statistic,
  Grid
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
  MessageOutlined
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
  getDoc
} from "firebase/firestore";
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
  const [adjustments, setAdjustments] = useState({});
  const [employeeId, setEmployeeId] = useState(null);
  const [form] = Form.useForm();
  const navigate = useNavigate();
  const [currentUserName, setCurrentUserName] = useState("");
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
  
      useEffect(() => {
        const fetchEmpId = async () => {
            if (!userEmail) return;
            const q = query(collection(db, "employees"), where("email", "==", userEmail));
            const snap = await getDocs(q);
            if (!snap.empty) {
                const empData = snap.docs[0].data();
                setEmployeeId(empData.employeeId);
                setCurrentUserName(empData.firstName ? `${empData.firstName} ${empData.lastName || ''}` : empData.employee);
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
  const getMonthlyPayroll = (employeeRecords) => {
    if (!selectedMonth) return { targetHours: 0, actualHours: 0, workingDays: 0, difference: 0, eligibleHours: 0, missingDays: [], totalLeaves: 0, passedWorkingDays: 0, passedTargetHours: 0, passedEligibleHours: 0 };
    
    // Prepare Holidays
    const holidayDates = holidays.map(h => h.date);
    DEFAULT_HOLIDAYS.forEach(d => { if(!holidayDates.includes(d)) holidayDates.push(d) });
    
    // Filter records for selected month
    const monthlyRecords = employeeRecords.filter(r => {
        if (!r.date) return false;
        const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        return d.isValid() && d.isSame(selectedMonth, 'month');
    });
    
    // Calculate Hours
    let actualHours = 0;
    let eligibleHours = 0;
    let passedEligibleHours = 0;
    const recordedDates = [];
    const shortDays = []; // NEW
    let earnedDays = 0;
    let presentDaysCount = 0;
    const today = dayjs();
    

    const currentMonthAdj = adjustments[selectedMonth.format("YYYY-MM")] || { grantedLeaves: 0, grantedHours: 0, grantedShortageDates: [] };
    
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
      actualHours += dailyHours;
      
      const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);

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
          
          const isWeekend = d.day() === 0 || d.day() === 6;

          // Rules Check
          if (dailyHours >= 3) {
             // Weekend Rule
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
         }

          // Short Days Logic
          // isGranted is calculated above. dailyHours is updated to 8 if granted.
          // So dailyHours < 8 will be false for granted days.
          if (!isWeekend && !r.isLeave && dailyHours > 0 && dailyHours < 8) {
              shortDays.push({ date: r.date, dailyHours, shortage: 8 - dailyHours });
          }

          // Salary Calculation Logic Integration (Calculated per record loop)
          // We need to calculate earned days HERE inside the loop or re-loop.
          // Since we are already looping, let's do it here.

          let hoursForPay = dailyHours;
          // Weekend logic for PAY: Only counted if approved (same as elapsed time logic above usually)
          // In AdminDashboard: if (isWeekend && !r.weekendApproved) hoursForPay = 0;
          if (isWeekend && !r.weekendApproved) hoursForPay = 0;

          if (hoursForPay >= 8) earnedDays += 1;
          else if (hoursForPay >= 3) earnedDays += 0.5;

          if (hoursForPay >= 3) presentDaysCount += 1;
      }
    });
    // Calculate Missing Days (Absences)
    const missingDays = [];
    const start = selectedMonth.clone().startOf("month");
    const end = selectedMonth.clone().endOf("month");
    
    let curr = start.clone();
    let passedWorkingDays = 0;
    let weekendCount = 0; // NEW

    while (curr.isSameOrBefore(end)) {
        const dayStr = curr.format("YYYY-MM-DD");
        const day = curr.day();
        const isWeekend = day === 0 || day === 6;
        const isHoliday = holidayDates.includes(dayStr);
        const isFuture = curr.isAfter(today, 'day');
        
        if (isWeekend) weekendCount++;
        
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

    // Calculate Target
    const workingDays = calculateWorkingDays(selectedMonth);
    const targetHours = workingDays * 8;
    const passedTargetHours = passedWorkingDays * 8;
    
    const leavesCount = monthlyRecords.filter(r => r.isLeave).length;
    const totalLeaves = missingDays.length + leavesCount;

    // Assuming monthlySalary is available in this scope, e.g., passed as an argument or from state/context
    // if (daysForPay < 0) daysForPay = 0;
    
    // let payableSalary = daysForPay * dailyRate;

    // Apply Granted Hours - REMOVED (Handled in loop)
    // actualHours += (currentMonthAdj.grantedHours || 0);
    // eligibleHours += (currentMonthAdj.grantedHours || 0); 
    // passedEligibleHours += (currentMonthAdj.grantedHours || 0);

    // Calculate Net Earning Days
    // Formula: Total Days in Month - Total Leaves
    const daysInMonth = selectedMonth.daysInMonth();
    const netEarningDays = daysInMonth - totalLeaves;

    return {
      workingDays,
      targetHours,
      actualHours,
      difference: eligibleHours - targetHours,
      eligibleHours,
      missingDays,
      shortDays, 
      totalLeaves,
      passedWorkingDays,
      passedTargetHours,
      passedEligibleHours,
      passedDifference: passedEligibleHours - passedTargetHours,
      passedDifference: passedEligibleHours - passedTargetHours,
      // Net Earning Days Logic
      netEarningDays: (dayjs().isSame(selectedMonth, 'month') ? dayjs().date() : selectedMonth.daysInMonth()) - totalLeaves,
      daysInMonth: dayjs().isSame(selectedMonth, 'month') ? dayjs().date() : selectedMonth.daysInMonth()
    };
  };

  const fetchMyData = React.useCallback(async () => {
    setLoading(true);
    try {
      const q = query(
        collection(db, "punches"),
        where("email", "==", userEmail)
      );
      const snap = await getDocs(q);
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      
      // Sort Descending (Latest Date First) -> Actually we sort in dataSource now, but original data sort is okay too
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
  }, [userEmail]);

  const fetchRequests = React.useCallback(async () => {
    try {
      const snap = await getDocs(collection(db, "requests"));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      
      // Sort Requests Descending (Latest Date First)
      data.sort((a, b) => {
        const dateA = dayjs(a.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        const dateB = dayjs(b.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        if (!dateA.isValid()) return 1; 
        if (!dateB.isValid()) return -1;
        return dateB.valueOf() - dateA.valueOf();
      });

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
  }, [userEmail, fetchMyData, fetchRequests]);

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
          </Row>
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
      // Update the original punch
      await updateDoc(doc(db, "punches", req.punchId), {
        inTime: req.inTime,
        outTime: req.outTime,
        punchTimes: req.punchTimes,
        numberOfPunches: req.numberOfPunches,
        hours: req.hours,
        isEdited: true
      });

      // Delete the request
      await deleteDoc(doc(db, "requests", req.id));

      message.success("Request approved and updated");
      fetchRequests();
      // If we updated our own record, refresh self data
      if (req.email === userEmail) fetchMyData();
    } catch {
      message.error("Failed to approve request");
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

  /* ================= COMPUTED DATA ================= */
  const payroll = React.useMemo(() => getMonthlyPayroll(records), [records, selectedMonth, holidays]);
  
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

        const targetHours = isWeekend ? 0 : 8;
        const shortfall = targetHours - dailyHours;
        const hoursShortBy = shortfall > 0 ? shortfall : 0;
        
        const presentDayCount = dailyHours > 0 ? 1 : 0; 
        const weekendCheck = isWeekend ? 1 : 0;

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
           weekendCheck,
           paidHolidays: 0,
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
            leaveCheck: 0,
            daySwapOff: 0,
            weekendCheck: isWeekend ? 1 : 0,
            paidHolidays: 0,
            isMissing: true,
            isWeekend
          };
      });

      const combined = [...filtered, ...missing];
      
      // 4. Sort Ascending
      combined.sort((a, b) => {
        const dateA = dayjs(a.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        const dateB = dayjs(b.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        return dateA.valueOf() - dateB.valueOf();
      });
      
      return combined;
  }, [records, payroll, selectedMonth, userEmail]);

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
            {/* Upload Page Button */}
            <Button
              type="primary"
              icon={<UploadOutlined />}
              onClick={() => navigate("/upload")}
            >
              Upload CSV
            </Button>
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
    </ConfigProvider>
  );
}
