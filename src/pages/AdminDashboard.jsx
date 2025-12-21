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
  Tabs,
  Switch,
  ConfigProvider,
  theme,
  DatePicker,
  List
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
  PlusOutlined
} from "@ant-design/icons";
import Papa from "papaparse";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import isSameOrBefore from "dayjs/plugin/isSameOrBefore";
import { db, auth } from "../firebase";
import { collection, addDoc, getDocs, updateDoc, doc, deleteDoc } from "firebase/firestore";
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
  if (!times || times.length === 0) return { inTime: "", outTime: "", totalHours: "" };
  const inTime = times[0];
  const outTime = times[times.length - 1];
  let totalHours = "";
  try {
    const [inH, inM] = inTime.split(":").map(Number);
    const [outH, outM] = outTime.split(":").map(Number);
    const minutes = outH * 60 + outM - (inH * 60 + inM);
    totalHours = minutes > 0 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}` : "0:00";
  } catch (e) {}
  return { inTime, outTime, totalHours };
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
    if (record.hours) {
      try {
        const [h, m] = record.hours.split(":").map(Number);
        grouped[key].totalHours += h + m / 60;
      } catch (e) {}
    }
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
  const [viewMode, setViewMode] = useState("cards");
  const [editOpen, setEditOpen] = useState(false);
  const [currentRecord, setCurrentRecord] = useState(null);
  const [form] = Form.useForm();
  const [darkMode, setDarkMode] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(dayjs());
  const [holidays, setHolidays] = useState([]);
  const [holidayModalOpen, setHolidayModalOpen] = useState(false);
  const [newHolidayDate, setNewHolidayDate] = useState(null);
  const [newHolidayName, setNewHolidayName] = useState("");
  
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

  useEffect(() => {
    fetchData();
    fetchHolidays();
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
          const date = getField(row, ["Date"]);
          const numberOfPunchesStr = getField(row, ["No. of Punches"]);
          const numberOfPunches = numberOfPunchesStr ? parseInt(numberOfPunchesStr, 10) : 0;
          const timeValue = getField(row, ["Time", "Times"]);
          const punchTimes = parseTimes(timeValue, numberOfPunches);
          const { inTime, outTime, totalHours } = calculateTimes(punchTimes);
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
            await addDoc(punchesRef, docData);
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

  const getMonthlyPayroll = (employeeRecords) => {
    if (!selectedMonth) return { targetHours: 0, actualHours: 0, workingDays: 0, difference: 0 };
    
    const holidayDates = holidays.map(h => h.date);
    DEFAULT_HOLIDAYS.forEach(d => { if(!holidayDates.includes(d)) holidayDates.push(d) });

    // Filter records for selected month using Dayjs to handle various formats
    const monthlyRecords = employeeRecords.filter(r => {
        if (!r.date) return false;
        // Try parsing with common formats
        const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], true);
        if (!d.isValid()) return false;
        return d.isSame(selectedMonth, 'month');
    });
    
    // Calculate Hours
    let actualHours = 0;
    let eligibleHours = 0;
    const pendingWeekends = [];
    const recordedDates = [];

    monthlyRecords.forEach(r => {
      let dailyHours = 0;
      if (r.hours) {
        const [h, m] = r.hours.split(":").map(Number);
        dailyHours = h + (m/60);
      }
      actualHours += dailyHours;
      
      const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], true);
      if(d.isValid()) recordedDates.push(d.format("YYYY-MM-DD"));

      // Rules Check
      // 1. Minimum 3 hours to be eligible
      if (dailyHours < 3) {
          // Not eligible
          return; 
      }

      // 2. Weekend Rule
      const isWeekend = d.day() === 0 || d.day() === 6;

      if (isWeekend) {
          // Weekend: Requires Admin Approval (any hours)
          if (r.weekendApproved) {
              eligibleHours += dailyHours;
          } else {
             pendingWeekends.push({ ...r, dailyHours });
          }
      } else {
          // Weekday: if >= 3 hours, it counts
          eligibleHours += dailyHours;
      }
    });

    // Calculate Missing Days (Absences)
    const missingDays = [];
    const start = selectedMonth.clone().startOf("month");
    const end = selectedMonth.clone().endOf("month");
    const today = dayjs();
    
    let curr = start.clone();
    while (curr.isSameOrBefore(end)) {
        if (curr.isAfter(today, 'day')) break; // Don't count future days

        const dayStr = curr.format("YYYY-MM-DD");
        const day = curr.day();
        const isWeekend = day === 0 || day === 6;
        const isHoliday = holidayDates.includes(dayStr);
        
        if (!isWeekend && !isHoliday && !recordedDates.includes(dayStr)) {
            missingDays.push(dayStr);
        }
        curr = curr.add(1, "day");
    }

    // Calculate Target
    const workingDays = calculateWorkingDays(selectedMonth);
    const targetHours = workingDays * 8;
    
    // Calculate Leaves Count from records
    const leavesCount = monthlyRecords.filter(r => r.isLeave).length;

    return {
      workingDays,
      targetHours,
      actualHours: actualHours,
      difference: eligibleHours - targetHours, // Difference is based on ELIGIBLE hours now
      pendingWeekends,
      eligibleHours, // Added for UI display
      missingDays,
      totalLeaves: missingDays.length + leavesCount
    };
  };

  /* ================= HELPERS ================= */
  const isValidTime = (t) => /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/.test(t);

  const calculateTimes = (times) => {
    if (!times || times.length === 0) return { inTime: "", outTime: "", totalHours: "" };
    // Sort times to ensure correct In/Out
    const sortedTimes = [...times].sort();
    const inTime = sortedTimes[0];
    const outTime = sortedTimes[sortedTimes.length - 1];
    
    let totalHours = "";
    try {
      const [inH, inM] = inTime.split(":").map(Number);
      const [outH, outM] = outTime.split(":").map(Number);
      const minutes = outH * 60 + outM - (inH * 60 + inM);
      totalHours = minutes > 0 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}` : "0:00";
    } catch {}
    return { inTime, outTime, totalHours };
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

  const handleGrantLeave = async (dateStr, employeeInfo, isPaid) => {
      try {
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
              hours: isPaid ? "08:00" : "00:00",
              uploadedAt: new Date().toISOString(),
              isManualEntry: true,
              isLeave: true,
              leaveType: isPaid ? 'Paid' : 'Unpaid'
          });
          message.success(`Marked as ${isPaid ? 'Paid' : 'Unpaid'} Leave for ${dateStr}`);
          fetchData();
      } catch (e) {
          console.error(e);
          message.error("Failed to mark leave");
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
          <Row gutter={[16, 16]}>
              <Col xs={12} sm={6}><Statistic title="Working Days" value={payroll.workingDays} valueStyle={{ fontSize: 16, fontWeight: 500 }} /></Col>
              <Col xs={12} sm={6}><Statistic title="Target Hours" value={payroll.targetHours} valueStyle={{ fontSize: 16, fontWeight: 500 }} prefix={<ClockCircleOutlined />} /></Col>
              <Col xs={12} sm={6}>
                  <Statistic 
                    title="Difference (Eligible - Target)" 
                    value={payroll.difference.toFixed(2)} 
                    valueStyle={{ fontSize: 20, color: payroll.difference < 0 ? "#ff4d4f" : "#52c41a", fontWeight: "bold" }} 
                    prefix={payroll.difference > 0 ? <PlusOutlined /> : <></>} 
                  />
              </Col>
              <Col xs={12} sm={6}>
                  <Statistic 
                    title="Leaves" 
                    value={payroll.totalLeaves || 0} 
                    valueStyle={{ fontSize: 20, color: "#faad14", fontWeight: "bold" }} 
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

              {/* Missing Days / Leaves List */}
              {payroll.missingDays && payroll.missingDays.length > 0 && (
                <Col span={24} style={{ marginTop: 12 }}>
                    <Collapse size="small" ghost>
                        <Panel 
                            header={<span style={{ color: "#ff4d4f", fontWeight: "bold" }}><ClockCircleOutlined /> Absences / Missing Workdays ({payroll.missingDays.length})</span>} 
                            key="1"
                        >
                            <div style={{ maxHeight: 200, overflowY: "auto", paddingRight: 4 }}>
                                {payroll.missingDays.map(dateStr => (
                                    <div key={dateStr} style={{ 
                                        marginBottom: 4, 
                                        background: darkMode ? "#000" : "#fff", 
                                        padding: "4px 8px", 
                                        borderRadius: 4, 
                                        border: "1px solid #ff4d4f",
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        fontSize: 12
                                    }}>
                                        <span style={{ fontWeight: 600 }}>{dateStr}</span>
                                        {employeeInfo && (
                                           <div style={{ display: 'flex', gap: 4 }}>
                                               <Button type="default" size="small" style={{ fontSize: 11, padding: "0 6px", height: 22 }} onClick={() => handleGrantLeave(dateStr, employeeInfo, false)}>Unpaid</Button>
                                               <Button type="primary" ghost size="small" style={{ borderColor: '#52c41a', color: '#52c41a', fontSize: 11, padding: "0 6px", height: 22 }} onClick={() => handleGrantLeave(dateStr, employeeInfo, true)}>Paid</Button>
                                               <Button type="primary" ghost size="small" danger style={{ fontSize: 11, padding: "0 6px", height: 22 }} onClick={() => handleMarkPresent(dateStr, employeeInfo)}>Present</Button>
                                           </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </Panel>
                    </Collapse>
                </Col>
              )}
          </Row>
      </div>
  );

  const columns = [
    { title: "Employee", dataIndex: "employee", key: "employee", render: (_, r) => r.firstName || r.employee || r.employeeId || "N/A" },
    { title: "Employee ID", dataIndex: "employeeId", key: "employeeId" },
    { title: "Department", dataIndex: "department", key: "department" },
    { title: "Date", dataIndex: "date", key: "date" },
    { title: "No. of Punches", dataIndex: "numberOfPunches", key: "numberOfPunches" },
    { title: "In Time", dataIndex: "inTime", key: "inTime" },
    { title: "Out Time", dataIndex: "outTime", key: "outTime" },
    { title: "Hours", dataIndex: "hours", key: "hours" },
    { title: "Status", key: "status", render: (_, r) => {
        if (r.isMissing) return <Tag color="error">Absent</Tag>;
        let dailyHours = 0;
        if (r.hours) {
            const [h, m] = r.hours.split(":").map(Number);
            dailyHours = h + (m/60);
        }
        const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], true);
        const isWeekend = d.isValid() && (d.day() === 0 || d.day() === 6);

        if (r.isLeave) return r.leaveType === 'Paid' ? <Tag color="green">Paid Leave</Tag> : <Tag color="default">Unpaid Leave</Tag>;
        if (isWeekend) {
            return r.weekendApproved ? <Tag color="green">Approved</Tag> : <Tag color="orange">Approval Needed</Tag>;
        }
        if (dailyHours < 3) return <Tag color="red">Low Hours</Tag>;
        return <Tag color="blue">OK</Tag>;
    }},
    { title: "All Punch Times", dataIndex: "punchTimes", key: "punchTimes", render: (t, r) => {
        if (r.isMissing) return "-";
        return (t || []).join(", ");
    }},
    { title: "Action", key: "action", render: (_, r) => {
        if (r.isMissing) return null; // Or add Mark Present here later
        const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], true);
        const isWeekend = d.isValid() && (d.day() === 0 || d.day() === 6);
        const showApproveBtn = isWeekend && !r.weekendApproved;

        return (
            <div style={{ display: 'flex', gap: 8 }}>
                <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(r)}>Edit</Button>
                {showApproveBtn && <Button type="primary" size="small" onClick={() => handleApproveWeekend(r.id)}>Approve</Button>}
            </div>
        );
    }},
  ];

  const filteredRecords = React.useMemo(() => {
    if (!selectedMonth) return [];
    return records.filter(r => {
        if (!r.date) return false;
        const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], true);
        return d.isValid() && d.isSame(selectedMonth, 'month');
    });
  }, [records, selectedMonth]);

  const employeeGroups = groupByEmployee(filteredRecords);

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
                    <Button icon={<LogoutOutlined />} onClick={handleLogout}>Logout</Button>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <BulbOutlined style={{ color: "#fff" }} />
                      <Switch checked={darkMode} onChange={setDarkMode} />
                    </div>
                  </div>
              </Col>
           </Row>
        </Header>
        <Content style={{ padding: 24, background: darkMode ? "#141414" : "#f0f2f5" }}>
          
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
                  const payroll = getMonthlyPayroll(emp.records);
                  return (
                  <Col key={k} xs={24} sm={24} md={12} lg={12} xl={8}>
                    <Card hoverable title={<><UserOutlined /> {emp.employeeName}</>} extra={<Tag color="blue">ID: {emp.employeeId}</Tag>} style={{ backgroundColor: darkMode ? "#1f1f1f" : "#fff" }}>
                      
                      {renderPayrollStats(payroll, darkMode, emp)}

                      <Statistic title="Department" value={emp.department} prefix={<UserOutlined />} valueStyle={{ fontSize: 14 }} />
                      <Statistic title="Total Records" value={emp.totalRecords} prefix={<CalendarOutlined />} valueStyle={{ fontSize: 14 }} />
                      
                      <Collapse size="small" ghost style={{ marginTop: 12 }}>
                        <Panel header={`View ${emp.records.length} Record(s)`} key="1">
                          <div style={{ maxHeight: 400, overflowY: "auto" }}>
                            {emp.records.map((rec, idx) => {
                                // Record Logic Calculation for UI
                                let dailyHours = 0;
                                if (rec.hours) {
                                    const [h, m] = rec.hours.split(":").map(Number);
                                    dailyHours = h + (m/60);
                                }
                                const d = dayjs(rec.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], true);
                                const isWeekend = d.day() === 0 || d.day() === 6;
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
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{rec.punchTimes.map((t, i) => <Tag key={i} color="blue">{t}</Tag>)}</div>
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
              <Tabs type="card">
                {Object.entries(employeeGroups).map(([key, emp]) => {
                  const payroll = getMonthlyPayroll(emp.records);
                  
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
                  
                  const combinedRecords = [...emp.records, ...missing];
                  // Sort Descending
                  combinedRecords.sort((a, b) => {
                    const dateA = dayjs(a.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
                    const dateB = dayjs(b.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
                    if (!dateA.isValid()) return 1; 
                    if (!dateB.isValid()) return -1;
                    return dateB.valueOf() - dateA.valueOf();
                  });

                  return (
                  <TabPane tab={emp.employeeName || emp.employee || emp.employeeId} key={key}>
                    {renderPayrollStats(payroll, darkMode, emp)}
                    <Table
                      columns={columns}
                      dataSource={combinedRecords}
                      rowKey={(rec) => rec.id || `${rec.employeeId || rec.employee}-${rec.date}-${Math.random().toString(36).slice(2, 7)}`}
                      bordered
                      scroll={{ x: "max-content" }}
                      pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `Total ${total} records` }}
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
                  </TabPane>
                )})}
              </Tabs>
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
        </Content>
      </Layout>
    </ConfigProvider>
  );
}
