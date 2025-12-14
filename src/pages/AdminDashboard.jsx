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
} from "@ant-design/icons";
import Papa from "papaparse";
import { db, auth } from "../firebase";
import { collection, addDoc, getDocs, updateDoc, doc } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";

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
    grouped[k].records.sort((a, b) => (b.date || "").localeCompare(a.date || ""))
  );
  return grouped;
};

export default function AdminDashboard() {
  const [records, setRecords] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [viewMode, setViewMode] = useState("cards");
  const [editOpen, setEditOpen] = useState(false);
  const [currentRecord, setCurrentRecord] = useState(null);
  const [form] = Form.useForm();
  const [darkMode, setDarkMode] = useState(false);
  const navigate = useNavigate();

  const fetchData = async () => {
    try {
      const snap = await getDocs(collection(db, "punches"));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      setRecords(data);
    } catch (e) {
      console.error(e);
      message.error("Failed to load records");
    }
  };

  useEffect(() => {
    fetchData();
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
  const handleUpdate = async (values) => {
    const punchTimes = values.punchTimes.split(",").map((t) => t.trim()).filter(Boolean);
    if (punchTimes.some((t) => !isValidTime(t))) {
      message.error("Invalid time format");
      return;
    }
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

  const columns = [
    { title: "Employee", dataIndex: "employee", key: "employee", render: (_, r) => r.firstName || r.employee || r.employeeId || "N/A" },
    { title: "Employee ID", dataIndex: "employeeId", key: "employeeId" },
    { title: "Department", dataIndex: "department", key: "department" },
    { title: "Date", dataIndex: "date", key: "date" },
    { title: "No. of Punches", dataIndex: "numberOfPunches", key: "numberOfPunches" },
    { title: "In Time", dataIndex: "inTime", key: "inTime" },
    { title: "Out Time", dataIndex: "outTime", key: "outTime" },
    { title: "Hours", dataIndex: "hours", key: "hours" },
    { title: "All Punch Times", dataIndex: "punchTimes", key: "punchTimes", render: (t) => (t || []).join(", ") },
    { title: "Action", key: "action", render: (_, r) => <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(r)}>Edit</Button> },
  ];

  const employeeGroups = groupByEmployee(records);

  return (
    <ConfigProvider theme={{ algorithm: darkMode ? darkAlgorithm : defaultAlgorithm }}>
      <Layout style={{ minHeight: "100vh" }}>
        <Header style={{ background: "#001529", display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 24px" }}>
          <h2 style={{ color: "white" }}>Admin Dashboard</h2>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <Button icon={<ReloadOutlined />} onClick={fetchData}>Refresh</Button>
            <Button icon={<LogoutOutlined />} onClick={handleLogout}>Logout</Button>
            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <BulbOutlined style={{ color: "#fff" }} />
              <Switch checked={darkMode} onChange={setDarkMode} />
            </div>
          </div>
        </Header>
        <Content style={{ padding: 24, background: darkMode ? "#141414" : "#f0f2f5" }}>
          <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Upload beforeUpload={handleFileUpload} showUploadList={false}>
              <Button type="primary" icon={<UploadOutlined />} loading={uploading}>Upload CSV</Button>
            </Upload>
            <div style={{ display: "flex", gap: 8 }}>
              <Button type={viewMode === "cards" ? "primary" : "default"} onClick={() => setViewMode("cards")}>Cards View</Button>
              <Button type={viewMode === "table" ? "primary" : "default"} onClick={() => setViewMode("table")}>Table View</Button>
            </div>
          </div>

          {/* Cards / Table rendering */}
          {viewMode === "cards" ? (
            Object.keys(employeeGroups).length === 0 ? (
              <Empty description="No records found" />
            ) : (
              <Row gutter={[16, 16]}>
                {Object.entries(employeeGroups).map(([k, emp]) => (
                  <Col key={k} xs={24} sm={12} lg={8} xl={6}>
                    <Card hoverable title={<><UserOutlined /> {emp.employeeName}</>} extra={<Tag color="blue">ID: {emp.employeeId}</Tag>} style={{ backgroundColor: darkMode ? "#1f1f1f" : "#fff" }}>
                      <Statistic title="Department" value={emp.department} prefix={<UserOutlined />} valueStyle={{ fontSize: 14 }} />
                      <Statistic title="Records" value={emp.totalRecords} prefix={<CalendarOutlined />} valueStyle={{ fontSize: 14 }} />
                      <Statistic title="Total Hours" value={emp.totalHours.toFixed(2)} suffix="hours" prefix={<ClockCircleOutlined />} valueStyle={{ fontSize: 16, color: "#1890ff" }} />
                      <Collapse size="small" ghost>
                        <Panel header={`View ${emp.records.length} Record(s)`} key="1">
                          <div style={{ maxHeight: 400, overflowY: "auto" }}>
                            {emp.records.map((rec, idx) => (
                              <Card key={rec.id || idx} size="small" style={{ marginBottom: 8, backgroundColor: darkMode ? "#141414" : "#fafafa" }}>
                                <Tag color="purple"><CalendarOutlined /> {rec.date || "N/A"}</Tag>
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
                                <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(rec)}>Edit</Button>
                              </Card>
                            ))}
                          </div>
                        </Panel>
                      </Collapse>
                    </Card>
                  </Col>
                ))}
              </Row>
            )
          ) : (
            Object.keys(employeeGroups).length === 0 ? (
              <Empty description="No records found" />
            ) : (
              <Tabs type="card">
                {Object.entries(employeeGroups).map(([key, emp]) => (
                  <TabPane tab={emp.employeeName || emp.employee || emp.employeeId} key={key}>
                    <Table
                      columns={columns}
                      dataSource={emp.records}
                      rowKey={(rec) => rec.id || `${rec.employeeId || rec.employee}-${rec.date}-${Math.random().toString(36).slice(2, 7)}`}
                      bordered
                      scroll={{ x: "max-content" }}
                      pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `Total ${total} records` }}
                    />
                  </TabPane>
                ))}
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
        </Content>
      </Layout>
    </ConfigProvider>
  );
}
