import React, { useEffect, useState } from "react";
import { Table, Layout, Button, message, Card, Tag, Statistic, Row, Col } from "antd";
import { LogoutOutlined, ClockCircleOutlined } from "@ant-design/icons";
import { auth, db } from "../firebase";
import { collection, getDocs, query, where, doc, getDoc } from "firebase/firestore";
import { signOut, onAuthStateChanged } from "firebase/auth";
import { useNavigate } from "react-router-dom";

const { Header, Content } = Layout;

export default function EmployeeDashboard() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [employeeInfo, setEmployeeInfo] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setRecords([]);
        setEmployeeInfo(null);
        setLoading(false);
        return;
      }
      
      setLoading(true);
      try {
        // First, get user's employeeId from Firestore users collection
        let employeeId = null;
        let firstName = null;
        
        try {
          const userDoc = await getDoc(doc(db, "users", user.uid));
          if (userDoc.exists()) {
            const userData = userDoc.data();
            employeeId = userData.employeeId || null;
            firstName = userData.firstName || userData.displayName || null;
          }
        } catch (err) {
          console.warn("Could not fetch user document:", err);
        }
        
        // Try multiple ways to find employee records
        let allRecords = [];
        
        // Method 1: Query by employeeId if available
        if (employeeId) {
          try {
            const q1 = query(collection(db, "punches"), where("employeeId", "==", employeeId));
            const snap1 = await getDocs(q1);
            allRecords = snap1.docs.map((d) => ({ id: d.id, ...d.data() }));
          } catch (err) {
            console.warn("Query by employeeId failed:", err);
          }
        }
        
        // Method 2: Query by email if employeeId not found
        if (allRecords.length === 0 && user.email) {
          try {
            const q2 = query(collection(db, "punches"), where("email", "==", user.email));
            const snap2 = await getDocs(q2);
            allRecords = snap2.docs.map((d) => ({ id: d.id, ...d.data() }));
          } catch (err) {
            console.warn("Query by email failed:", err);
          }
        }
        
        // Method 3: Query by firstName if available (less reliable but as fallback)
        if (allRecords.length === 0 && firstName) {
          try {
            const q3 = query(collection(db, "punches"), where("firstName", "==", firstName));
            const snap3 = await getDocs(q3);
            allRecords = snap3.docs.map((d) => ({ id: d.id, ...d.data() }));
          } catch (err) {
            console.warn("Query by firstName failed:", err);
          }
        }
        
        // If still no records, try to get all and filter client-side (not recommended for large datasets)
        if (allRecords.length === 0) {
          console.warn("No records found with employeeId, email, or firstName. Showing empty list.");
          message.warning("No records found. Please ensure your employee ID is linked to your account.");
        }
        
        // Sort by date descending (newest first)
        allRecords.sort((a, b) => {
          if (a.date && b.date) return b.date.localeCompare(a.date);
          return 0;
        });
        
        setRecords(allRecords);
        
        // Set employee info from first record if available
        if (allRecords.length > 0) {
          setEmployeeInfo({
            employeeId: allRecords[0].employeeId || employeeId,
            firstName: allRecords[0].firstName || firstName,
            department: allRecords[0].department || "N/A"
          });
        } else if (employeeId || firstName) {
          setEmployeeInfo({
            employeeId: employeeId,
            firstName: firstName,
            department: "N/A"
          });
        }
        
      } catch (err) {
        console.error("Error fetching employee punches:", err);
        message.error("Failed to load your punches.");
      } finally {
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/");
  };

  // Calculate totals
  const totalRecords = records.length;
  const totalHours = records.reduce((sum, rec) => {
    if (rec.hours) {
      const [hours, minutes] = rec.hours.split(":").map(Number);
      return sum + hours + minutes / 60;
    }
    return sum;
  }, 0);

  const columns = [
    { 
      title: "Date", 
      dataIndex: "date", 
      key: "date",
      sorter: (a, b) => {
        if (!a.date || !b.date) return 0;
        return a.date.localeCompare(b.date);
      },
      defaultSortOrder: "descend"
    },
    { 
      title: "Department", 
      dataIndex: "department", 
      key: "department",
      render: (text) => text || "N/A"
    },
    { 
      title: "No. of Punches", 
      dataIndex: "numberOfPunches", 
      key: "numberOfPunches",
      render: (text) => text || "0"
    },
    { 
      title: "In Time", 
      dataIndex: "inTime", 
      key: "inTime",
      render: (text) => text || "-"
    },
    { 
      title: "Out Time", 
      dataIndex: "outTime", 
      key: "outTime",
      render: (text) => text || "-"
    },
    { 
      title: "Hours", 
      dataIndex: "hours", 
      key: "hours",
      render: (text) => text || "-"
    },
    {
      title: "All Punch Times",
      dataIndex: "punchTimes",
      key: "punchTimes",
      render: (times) => {
        if (!times || times.length === 0) return "-";
        return (
          <div style={{ maxWidth: 300 }}>
            {times.map((time, idx) => (
              <Tag key={idx} color="blue" style={{ marginBottom: 4 }}>
                {time}
              </Tag>
            ))}
          </div>
        );
      },
      width: 300
    },
  ];

  return (
    <Layout style={{ minHeight: "100vh", width: "100%" }}>
      <Header style={{ 
        background: "#001529", 
        display: "flex", 
        justifyContent: "space-between", 
        alignItems: "center",
        padding: "0 24px",
        height: "64px",
        lineHeight: "64px",
        position: "sticky",
        top: 0,
        zIndex: 1000
      }}>
        <h2 style={{ color: "white", margin: 0, fontSize: "20px", fontWeight: 500 }}>My Punch Records</h2>
        <Button icon={<LogoutOutlined />} onClick={handleLogout}>Logout</Button>
      </Header>

      <Content style={{ padding: "24px", minHeight: "calc(100vh - 64px)", background: "#f0f2f5" }}>
        {employeeInfo && (
          <Card style={{ marginBottom: 24 }}>
            <Row gutter={16}>
              <Col span={8}>
                <Statistic title="Employee ID" value={employeeInfo.employeeId || "N/A"} />
              </Col>
              <Col span={8}>
                <Statistic title="Name" value={employeeInfo.firstName || "N/A"} />
              </Col>
              <Col span={8}>
                <Statistic title="Department" value={employeeInfo.department || "N/A"} />
              </Col>
            </Row>
          </Card>
        )}

        <Card>
          <Row gutter={16} style={{ marginBottom: 16 }}>
            <Col span={12}>
              <Statistic 
                title="Total Records" 
                value={totalRecords} 
                prefix={<ClockCircleOutlined />}
              />
            </Col>
            <Col span={12}>
              <Statistic 
                title="Total Hours" 
                value={totalHours.toFixed(2)} 
                suffix="hours"
              />
            </Col>
          </Row>

          <Table
            columns={columns}
            dataSource={records}
            rowKey={(rec) => rec.id || `${rec.employeeId}-${rec.date}-${Math.random().toString(36).slice(2,7)}`}
            bordered
            loading={loading}
            pagination={{ 
              pageSize: 10, 
              showSizeChanger: true, 
              showTotal: (total) => `Total ${total} records` 
            }}
            scroll={{ x: "max-content" }}
          />
        </Card>

        {records.length === 0 && !loading && (
          <Card>
            <div style={{ textAlign: "center", padding: 40 }}>
              <p style={{ fontSize: 16, color: "#999" }}>
                No records found. 
              </p>
              <p style={{ fontSize: 14, color: "#999", marginTop: 8 }}>
                Please contact your administrator to link your employee ID to your account.
              </p>
            </div>
          </Card>
        )}
      </Content>
    </Layout>
  );
}
