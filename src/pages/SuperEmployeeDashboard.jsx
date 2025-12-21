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
  Statistic
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
  PlusOutlined
} from "@ant-design/icons";
import { db, auth } from "../firebase";
import {
  collection,
  getDocs,
  query,
  where,
  updateDoc,
  doc,
  deleteDoc
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

  /* ================= FETCH ================= */
  const fetchMyData = React.useCallback(async () => {
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
              <Col xs={12} sm={6}><Statistic title="Actual Hours" value={payroll.actualHours.toFixed(2)} valueStyle={{ fontSize: 16, color: "#888" }} /></Col>
              <Col xs={12} sm={6}><Statistic title="Eligible Hrs" value={payroll.eligibleHours.toFixed(2)} valueStyle={{ fontSize: 16, color: payroll.difference < 0 ? "#ff4d4f" : "#52c41a", fontWeight: 'bold' }} /></Col>
              <Col xs={24}><div style={{height: 1, background: darkMode ? '#303030' : '#f0f0f0', margin: '8px 0'}} /></Col>
              <Col xs={12}>
                  <Statistic 
                    title="Difference (Eligible - Target)" 
                    value={payroll.difference.toFixed(2)} 
                    valueStyle={{ fontSize: 20, color: payroll.difference < 0 ? "#ff4d4f" : "#52c41a", fontWeight: "bold" }} 
                    prefix={payroll.difference > 0 ? <PlusOutlined /> : <></>} 
                  />
              </Col>
              <Col xs={12}>
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

  /* ================= LOGOUT ================= */
  const handleLogout = async () => {
    await signOut(auth);
    navigate("/");
  };

  /* ================= HELPERS ================= */
  const calculateTimes = (times) => {
    if (!times || times.length === 0) return { inTime: "", outTime: "", totalHours: "" };
    // Sort times
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
            <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(r)}>
            Edit
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
           <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
               <h2 style={{ color: darkMode ? "#fff" : "#000", margin: 0 }}>Super Employee Dashboard</h2>
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
                rowClassName={(record) => {
                    if (record.isMissing) return darkMode ? "dark-missing-row" : "light-missing-row";
                    if (record.isLeave) {
                       if (record.leaveType === 'Paid') return darkMode ? "dark-paid-leave-row" : "light-paid-leave-row"; // We will inject styles or use style prop
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
    </ConfigProvider>
  );
}
