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
  Tag
} from "antd";
import {
  ReloadOutlined,
  LogoutOutlined,
  EditOutlined,
  BulbOutlined,
  UploadOutlined,
  ClockCircleOutlined,
  PlusOutlined
} from "@ant-design/icons";
import { db, auth } from "../firebase";
import {
  collection,
  getDocs,
  query,
  where,
  addDoc
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

export default function EmployeeDashboard() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [currentRecord, setCurrentRecord] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
  const [selectedMonth, setSelectedMonth] = useState(dayjs());
  const [holidays, setHolidays] = useState([]);
  const [form] = Form.useForm();
  const navigate = useNavigate();

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
  }, [userEmail]); // eslint-disable-next-line react-hooks/exhaustive-deps

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
  const getMonthlyPayroll = (employeeRecords) => {
    if (!selectedMonth) return { targetHours: 0, actualHours: 0, workingDays: 0, difference: 0, eligibleHours: 0, missingDays: [], totalLeaves: 0 };
    
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
    const recordedDates = [];

    monthlyRecords.forEach(r => {
      let dailyHours = 0;
      if (r.hours) {
        const [h, m] = r.hours.split(":").map(Number);
        dailyHours = h + (m/60);
      }
      actualHours += dailyHours;
      
      const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
      if(d.isValid()) recordedDates.push(d.format("YYYY-MM-DD"));

      // Rules Check
      if (dailyHours < 3) return; // Not eligible

      // Weekend Rule
      const isWeekend = d.day() === 0 || d.day() === 6;

      if (isWeekend) {
          if (r.weekendApproved) {
              eligibleHours += dailyHours;
          }
      } else {
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
    
    const leavesCount = monthlyRecords.filter(r => r.isLeave).length;

    return {
      workingDays,
      targetHours,
      actualHours,
      difference: eligibleHours - targetHours,
      eligibleHours,
      missingDays,
      totalLeaves: missingDays.length + leavesCount
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
    } catch {
      message.error("Failed to fetch data");
    }
    setLoading(false);
  };

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
  
  const dataSource = React.useMemo(() => {
      const filtered = records.filter(r => {
        if(!selectedMonth) return true;
        const d = dayjs(r.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        return d.isValid() && d.isSame(selectedMonth, 'month');
      });

      const missing = (payroll.missingDays || []).map(date => ({
          id: `missing-${date}`,
          date: date,
          firstName: "You",
          email: userEmail,
          numberOfPunches: 0,
          punchTimes: [],
          inTime: "-",
          outTime: "-",
          hours: "0:00",
          isMissing: true
      }));

      const combined = [...filtered, ...missing];
      
      // Sort Descending
      combined.sort((a, b) => {
        const dateA = dayjs(a.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        const dateB = dayjs(b.date, ["YYYY-MM-DD", "DD-MM-YYYY", "MM/DD/YYYY", "DD/MM/YYYY", "YYYY/MM/DD"], false);
        if (!dateA.isValid()) return 1; 
        if (!dateB.isValid()) return -1;
        return dateB.valueOf() - dateA.valueOf();
      });
      
      return combined;
  }, [records, payroll, selectedMonth, userEmail]);

  /* ================= TABLE ================= */
  const columns = [
    { title: "Date", dataIndex: "date" },
    { title: "Punches", dataIndex: "numberOfPunches" },
    { title: "In Time", dataIndex: "inTime" },
    { title: "Out Time", dataIndex: "outTime" },
    { title: "Hours", dataIndex: "hours" },
    { 
        title: "Status", 
        key: "status",
        render: (_, r) => {
             if (r.isMissing) return <Tag color="error">Absent</Tag>;
             if (r.isLeave) return r.leaveType === 'Paid' ? <Tag color="green">Paid Leave</Tag> : <Tag color="default">Unpaid Leave</Tag>;
             return <Tag color="blue">Present</Tag>;
        }
    },
    {
      title: "Punch Times",
      dataIndex: "punchTimes",
      render: (t, r) => {
          if (r.isMissing) return "-";
          if (r.isLeave) return "-";
          return (t || []).join(", ");
      },
    },
    {
      title: "Action",
      render: (_, r) => {
        if (r.isMissing || r.isLeave) return null;
        return (
            <Button type="link" icon={<EditOutlined />} onClick={() => openRequest(r)}>
            Request Correction
            </Button>
        );
      },
    },
  ];

  return (
    <ConfigProvider
      theme={{ algorithm: darkMode ? darkAlgorithm : defaultAlgorithm }}
    >
      <div
        style={{
          minHeight: "100vh",
          background: darkMode ? DARK_BG : "#f0f2f5",
          padding: 24,
        }}
      >
        {/* HEADER */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16, flexWrap: "wrap", gap: 16 }}>
           <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
               <h2 style={{ color: darkMode ? "#fff" : "#000", margin: 0 }}>My Punch Records</h2>
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
            <Button danger icon={<LogoutOutlined />} onClick={handleLogout}>
              Logout
            </Button>
          </div>
        </div>

        {/* PAYROLL STATS */}
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
            rowClassName={(record) => {
                if (record.isMissing) return darkMode ? "dark-missing-row" : "light-missing-row";
                if (record.isLeave) {
                   if (record.leaveType === 'Paid') return darkMode ? "dark-paid-leave-row" : "light-paid-leave-row"; 
                   return darkMode ? "dark-unpaid-leave-row" : "light-unpaid-leave-row";
                }
                return "";
            }}
            onRow={(record) => {
                let bg = "";
                if (record.isMissing) {
                    bg = darkMode ? "rgba(255, 77, 79, 0.1)" : "#fff1f0";
                    return { style: { background: bg } };
                }
                if (record.isLeave) {
                   if (record.leaveType === 'Paid') bg = darkMode ? "rgba(183, 235, 143, 0.15)" : "#f6ffed";
                   else bg = darkMode ? "#333" : "#fafafa";
                   return { style: { background: bg } };
                }
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
    </ConfigProvider>
  );
}
