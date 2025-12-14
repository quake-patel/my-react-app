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
} from "antd";
import {
  ReloadOutlined,
  LogoutOutlined,
  EditOutlined,
  BulbOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { db, auth } from "../firebase";
import {
  collection,
  getDocs,
  query,
  where,
  updateDoc,
  doc,
} from "firebase/firestore";
import { signOut, onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";

const { darkAlgorithm, defaultAlgorithm } = theme;

// 🎯 DARK MODE COLORS (PURE BLACK)
const DARK_BG = "#000000";
const DARK_CARD = "#141414";

export default function EmployeeDashboard() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [currentRecord, setCurrentRecord] = useState(null);
  const [userEmail, setUserEmail] = useState(null);
  const [darkMode, setDarkMode] = useState(false);
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
    if (userEmail) fetchMyData();
  }, [userEmail]);

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
      data.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
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

  /* ================= EDIT ================= */
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
    const [inH, inM] = values.inTime.split(":").map(Number);
    const [outH, outM] = values.outTime.split(":").map(Number);

    const minutes = outH * 60 + outM - (inH * 60 + inM);
    if (minutes < 0) {
      message.error("Out Time must be after In Time");
      return;
    }

    const hours = `${Math.floor(minutes / 60)}:${String(
      minutes % 60
    ).padStart(2, "0")}`;

    await updateDoc(doc(db, "punches", currentRecord.id), {
      inTime: values.inTime,
      outTime: values.outTime,
      punchTimes: values.punchTimes.split(",").map((t) => t.trim()),
      numberOfPunches: values.punchTimes.split(",").length,
      hours,
    });

    message.success("Punch updated");
    setEditOpen(false);
    fetchMyData();
  };

  /* ================= TABLE ================= */
  const columns = [
    { title: "Date", dataIndex: "date" },
    { title: "Punches", dataIndex: "numberOfPunches" },
    { title: "In Time", dataIndex: "inTime" },
    { title: "Out Time", dataIndex: "outTime" },
    { title: "Hours", dataIndex: "hours" },
    {
      title: "Punch Times",
      dataIndex: "punchTimes",
      render: (t = []) => t.join(", "),
    },
    {
      title: "Action",
      render: (_, r) => (
        <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(r)}>
          Edit
        </Button>
      ),
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
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <h2 style={{ color: darkMode ? "#fff" : "#000" }}>
            My Punch Records
          </h2>

          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <BulbOutlined style={{ color: darkMode ? "#fff" : "#000" }} />
            <Switch
              checked={darkMode}
              onChange={setDarkMode}
              checkedChildren="Dark"
              unCheckedChildren="Light"
            />
            <Button icon={<ReloadOutlined />} onClick={fetchMyData}>
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

        {/* TABLE */}
        {records.length === 0 ? (
          <Empty />
        ) : (
          <Table
            bordered
            loading={loading}
            columns={columns}
            dataSource={records}
            rowKey="id"
            style={{
              background: darkMode ? DARK_CARD : "#fff",
            }}
          />
        )}

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
