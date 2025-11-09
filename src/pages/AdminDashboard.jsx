import React, { useState, useEffect } from "react";
import { Table, Upload, Button, message, Layout, Card, Row, Col, Tag, Statistic, Collapse, Empty } from "antd";
import { UploadOutlined, LogoutOutlined, ReloadOutlined, UserOutlined, CalendarOutlined, ClockCircleOutlined } from "@ant-design/icons";
import Papa from "papaparse";
import { db, auth } from "../firebase";
import { collection, addDoc, getDocs } from "firebase/firestore";
import { signOut } from "firebase/auth";
import { useNavigate } from "react-router-dom";

const { Header, Content } = Layout;

const normalize = (v) => (typeof v === "string" ? v.trim() : "");

// Case-insensitive field getter
const getField = (row, variants = []) => {
  // First try exact matches
  for (const v of variants) {
    if (row[v] !== undefined && row[v] !== null && row[v] !== "") {
      return normalize(row[v]);
    }
  }
  
  // Then try case-insensitive matches
  const rowKeys = Object.keys(row);
  for (const variant of variants) {
    const lowerVariant = variant.toLowerCase().trim();
    for (const key of rowKeys) {
      if (key.toLowerCase().trim() === lowerVariant) {
        const value = row[key];
        if (value !== undefined && value !== null && value !== "") {
          return normalize(value);
        }
      }
    }
  }
  
  // Also try partial matches (e.g., "First Name" matches "First Name" or "FirstName")
  for (const variant of variants) {
    const variantWords = variant.toLowerCase().replace(/[^a-z0-9]/g, " ");
    for (const key of rowKeys) {
      const keyWords = key.toLowerCase().replace(/[^a-z0-9]/g, " ");
      // Check if key contains all words from variant or vice versa
      if (variantWords.split(" ").every(word => word && keyWords.includes(word)) ||
          keyWords.split(" ").every(word => word && variantWords.includes(word))) {
        const value = row[key];
        if (value !== undefined && value !== null && value !== "") {
          return normalize(value);
        }
      }
    }
  }
  
  return "";
};

// Parse comma-separated times from a string or array of values
const parseTimes = (timeValue, numberOfPunches) => {
  if (!timeValue) return [];
  
  let times = [];
  
  // If it's already an array, join it
  if (Array.isArray(timeValue)) {
    timeValue = timeValue.filter(v => v && v.trim()).join(", ");
  }
  
  // Split by comma and clean up
  if (typeof timeValue === "string") {
    times = timeValue
      .split(",")
      .map(t => t.trim())
      .filter(t => t && t.match(/^\d{1,2}:\d{2}$/)); // Match HH:MM format
  }
  
  // Limit to number of punches if specified
  if (numberOfPunches && numberOfPunches > 0) {
    times = times.slice(0, numberOfPunches);
  }
  
  return times;
};

// Calculate In Time (first punch) and Out Time (last punch)
const calculateTimes = (times) => {
  if (!times || times.length === 0) {
    return { inTime: "", outTime: "", totalHours: "" };
  }
  
  const inTime = times[0];
  const outTime = times[times.length - 1];
  
  // Calculate hours between first and last punch
  let totalHours = "";
  if (inTime && outTime) {
    try {
      const [inHour, inMin] = inTime.split(":").map(Number);
      const [outHour, outMin] = outTime.split(":").map(Number);
      const inMinutes = inHour * 60 + inMin;
      const outMinutes = outHour * 60 + outMin;
      const diffMinutes = outMinutes - inMinutes;
      const hours = Math.floor(diffMinutes / 60);
      const minutes = diffMinutes % 60;
      totalHours = `${hours}:${minutes.toString().padStart(2, "0")}`;
    } catch (e) {
      // If calculation fails, just leave it empty
    }
  }
  
  return { inTime, outTime, totalHours };
};

export default function AdminDashboard() {
  const [records, setRecords] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [viewMode, setViewMode] = useState("cards"); // "cards" or "table"
  const navigate = useNavigate();

  const fetchData = async () => {
    try {
      const snap = await getDocs(collection(db, "punches"));
      const data = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      // ensure consistent ordering: latest first by date if available (string compare)
      data.sort((a, b) => {
        if (a.date && b.date) return b.date.localeCompare(a.date);
        return 0;
      });
      setRecords(data);
    } catch (err) {
      console.error("Fetch error:", err);
      message.error("Failed to load records.");
    }
  };

  // Group records by employee
  const groupByEmployee = (records) => {
    const grouped = {};
    
    records.forEach(record => {
      const key = record.employeeId || record.firstName || record.employee || "Unknown";
      if (!grouped[key]) {
        grouped[key] = {
          employeeId: record.employeeId || "",
          employeeName: record.firstName || record.employee || "Unknown",
          department: record.department || "N/A",
          records: [],
          totalRecords: 0,
          totalHours: 0
        };
      }
      
      grouped[key].records.push(record);
      grouped[key].totalRecords++;
      
      // Calculate total hours
      if (record.hours) {
        try {
          const [hours, minutes] = record.hours.split(":").map(Number);
          grouped[key].totalHours += hours + minutes / 60;
        } catch (e) {
          // Skip if parsing fails
        }
      }
    });
    
    // Sort records within each employee by date (newest first)
    Object.keys(grouped).forEach(key => {
      grouped[key].records.sort((a, b) => {
        if (a.date && b.date) return b.date.localeCompare(a.date);
        return 0;
      });
    });
    
    return grouped;
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleFileUpload = (file) => {
    setUploading(true);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => {
        // Normalize headers - remove extra spaces and handle variations
        return header.trim();
      },
      complete: async (results) => {
        console.log("CSV Parsed. Total rows:", results.data.length);
        if (results.data.length > 0) {
          console.log("First row sample:", results.data[0]);
          console.log("Available columns:", Object.keys(results.data[0] || {}));
          console.log("All column values from first row:", results.data[0]);
        }
        
        // Also log any parsing errors
        if (results.errors && results.errors.length > 0) {
          console.warn("CSV parsing errors:", results.errors);
        }
        
        const punchesRef = collection(db, "punches");
        const badRows = [];
        let successCount = 0;

        for (let i = 0; i < results.data.length; i++) {
          const row = results.data[i];

          // Try to get fields with multiple possible column name variations
          // Employee ID or Employee
          const employeeId = getField(row, [
            "Employee", "Employee ID", "EMPLOYEE", "employee", "employee id", 
            "EMPLOYEE ID", "Emp ID", "emp id"
          ]);
          
          // First Name
          const firstName = getField(row, [
            "First Name", "FirstName", "first name", "FIRST NAME",
            "First", "first", "Name", "name"
          ]);
          
          // Department
          const department = getField(row, [
            "Department", "Departmer", "department", "DEPARTMENT",
            "Dept", "dept"
          ]);
          
          // Date
          const date = getField(row, [
            "Date", "date", "DATE", "Punch Date", "punch date"
          ]);
          
          // Number of Punches
          const numberOfPunchesStr = getField(row, [
            "No. of Pun", "No. of Punches", "No of Punches", "no. of pun",
            "No of Pun", "Number of Punches", "number of punches"
          ]);
          const numberOfPunches = numberOfPunchesStr ? parseInt(numberOfPunchesStr, 10) : 0;
          
          // Time - could be in "Time" column or spread across multiple columns
          // First, try to get from explicit "Time" column
          let timeValue = getField(row, [
            "Time", "time", "TIME", "Punch Time", "punch time", "Times"
          ]);
          
          // If no explicit Time column, collect all time-like values from the row
          // This handles cases where times are in separate columns (F, G, H, I, etc.)
          if (!timeValue || timeValue === "") {
            const allTimes = [];
            
            // Get all column values that might contain times
            Object.keys(row).forEach(key => {
              // Skip known non-time columns
              if (["Employee", "Employee ID", "First Name", "Department", "Date", 
                   "No. of Pun", "No. of Punches", "Email", "email"].includes(key)) {
                return;
              }
              
              const value = normalize(row[key]);
              if (!value) return;
              
              // Check if value contains times (comma-separated or single time)
              // Pattern: HH:MM or HH:MM, HH:MM, ...
              const timePattern = /(\d{1,2}:\d{2})/g;
              const matches = value.match(timePattern);
              
              if (matches && matches.length > 0) {
                // If it's comma-separated, split it
                if (value.includes(",")) {
                  const splitTimes = value.split(",")
                    .map(t => t.trim())
                    .filter(t => t.match(/^\d{1,2}:\d{2}$/));
                  allTimes.push(...splitTimes);
                } else {
                  // Single time value
                  allTimes.push(value);
                }
              }
            });
            
            if (allTimes.length > 0) {
              timeValue = allTimes.join(", ");
            }
          } else {
            // If we have a timeValue from Time column, it might be comma-separated
            // Parse it to ensure we get all times
            const timePattern = /(\d{1,2}:\d{2})/g;
            const matches = timeValue.match(timePattern);
            if (matches && matches.length > 0) {
              timeValue = matches.join(", ");
            }
          }
          
          // Debug logging for first few rows
          if (i < 3) {
            console.log(`Row ${i + 1}:`, {
              employeeId,
              firstName,
              date,
              numberOfPunches,
              timeValue,
              allRowKeys: Object.keys(row),
              rowSample: row
            });
          }

          // Skip if no essential data
          if (!employeeId && !firstName) {
            badRows.push({ 
              rowIndex: i + 1, 
              reason: "missing employee ID/first name", 
              raw: row 
            });
            continue;
          }
          
          if (!date) {
            badRows.push({ 
              rowIndex: i + 1, 
              reason: "missing date", 
              raw: row 
            });
            continue;
          }

          // Parse times
          const punchTimes = parseTimes(timeValue, numberOfPunches);
          const { inTime, outTime, totalHours } = calculateTimes(punchTimes);
          
          // Create employee name (combine ID and first name if available)
          const employeeName = firstName 
            ? `${firstName} (${employeeId || "N/A"})` 
            : employeeId || "Unknown";
          
          // Create email from employee data (or leave empty if not in CSV)
          const email = getField(row, [
            "Email", "Email ID", "email", "EMAIL", "E-mail"
          ]) || "";

          const doc = {
            employeeId: employeeId || "",
            employee: employeeName,
            firstName: firstName || "",
            department: department || "",
            email: email,
            date: date || "",
            numberOfPunches: numberOfPunches || punchTimes.length,
            punchTimes: punchTimes,
            inTime: inTime,
            outTime: outTime,
            hours: totalHours,
            uploadedAt: new Date().toISOString()
          };

          // Safety: ensure no undefined values (Firebase rejects undefined)
          Object.keys(doc).forEach(key => {
            if (doc[key] === undefined) {
              doc[key] = "";
            }
          });

          try {
            await addDoc(punchesRef, doc);
            successCount++;
          } catch (err) {
            console.error("Write failed for row", i + 1, err);
            badRows.push({ 
              rowIndex: i + 1, 
              reason: "firestore write failed", 
              error: err.message, 
              raw: row 
            });
          }
        }

        setUploading(false);
        await fetchData();

        if (badRows.length > 0) {
          console.warn("Skipped rows:", badRows);
          message.warning(
            `${successCount} rows added successfully. ${badRows.length} rows skipped. Check console for details.`
          );
        } else {
          message.success(`${successCount} rows added successfully.`);
        }
      },
      error: (err) => {
        console.error("CSV parse error:", err);
        message.error("Failed to parse CSV: " + err.message);
        setUploading(false);
      },
    });

    // prevent default Upload behavior
    return false;
  };

  const handleLogout = async () => {
    await signOut(auth);
    navigate("/");
  };

  const columns = [
    { 
      title: "Employee", 
      dataIndex: "employee", 
      key: "employee",
      render: (text, record) => record.firstName || record.employee || record.employeeId || "N/A"
    },
    { 
      title: "Employee ID", 
      dataIndex: "employeeId", 
      key: "employeeId",
      render: (text) => text || "N/A"
    },
    { 
      title: "Department", 
      dataIndex: "department", 
      key: "department",
      render: (text) => text || "N/A"
    },
    { title: "Date", dataIndex: "date", key: "date" },
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
        return times.join(", ");
      },
      width: 300,
      ellipsis: true
    },
  ];

  const { Panel } = Collapse;
  const employeeGroups = groupByEmployee(records);

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
        <h2 style={{ color: "white", margin: 0, fontSize: "20px", fontWeight: 500 }}>Admin Dashboard</h2>
        <div style={{ display: "flex", gap: 12 }}>
          <Button icon={<ReloadOutlined />} onClick={fetchData}>Refresh</Button>
          <Button icon={<LogoutOutlined />} onClick={handleLogout}>Logout</Button>
        </div>
      </Header>

      <Content style={{ padding: "24px", minHeight: "calc(100vh - 64px)", background: "#f0f2f5" }}>
        <div style={{ marginBottom: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <Upload beforeUpload={handleFileUpload} showUploadList={false}>
            <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
              Upload Punch Report CSV
            </Button>
          </Upload>
          <div style={{ display: "flex", gap: 8 }}>
            <Button 
              type={viewMode === "cards" ? "primary" : "default"}
              onClick={() => setViewMode("cards")}
            >
              Cards View
            </Button>
            <Button 
              type={viewMode === "table" ? "primary" : "default"}
              onClick={() => setViewMode("table")}
            >
              Table View
            </Button>
          </div>
        </div>

        {viewMode === "cards" ? (
          // Cards View
          <div>
            {Object.keys(employeeGroups).length === 0 ? (
              <Empty description="No records found. Upload a CSV file to get started." />
            ) : (
              <Row gutter={[16, 16]}>
                {Object.entries(employeeGroups).map(([key, employee]) => (
                  <Col key={key} xs={24} sm={12} lg={8} xl={6}>
                    <Card
                      hoverable
                      style={{ height: "100%" }}
                      title={
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <UserOutlined />
                          <span>{employee.employeeName}</span>
                        </div>
                      }
                      extra={
                        employee.employeeId && (
                          <Tag color="blue">ID: {employee.employeeId}</Tag>
                        )
                      }
                    >
                      <div style={{ marginBottom: 16 }}>
                        <Row gutter={16}>
                          <Col span={12}>
                            <Statistic
                              title="Department"
                              value={employee.department}
                              prefix={<UserOutlined />}
                              valueStyle={{ fontSize: 14 }}
                            />
                          </Col>
                          <Col span={12}>
                            <Statistic
                              title="Records"
                              value={employee.totalRecords}
                              prefix={<CalendarOutlined />}
                              valueStyle={{ fontSize: 14 }}
                            />
                          </Col>
                        </Row>
                        <Row gutter={16} style={{ marginTop: 12 }}>
                          <Col span={24}>
                            <Statistic
                              title="Total Hours"
                              value={employee.totalHours.toFixed(2)}
                              suffix="hours"
                              prefix={<ClockCircleOutlined />}
                              valueStyle={{ fontSize: 16, color: "#1890ff" }}
                            />
                          </Col>
                        </Row>
                      </div>

                      <Collapse size="small" ghost>
                        <Panel 
                          header={`View ${employee.records.length} Record(s)`} 
                          key="1"
                        >
                          <div style={{ maxHeight: "400px", overflowY: "auto" }}>
                            {employee.records.map((record, index) => (
                              <Card
                                key={record.id || index}
                                size="small"
                                style={{ marginBottom: 8, backgroundColor: "#fafafa" }}
                              >
                                <div style={{ marginBottom: 8 }}>
                                  <Tag color="purple">
                                    <CalendarOutlined /> {record.date || "N/A"}
                                  </Tag>
                                  <Tag color="green">
                                    Punches: {record.numberOfPunches || "0"}
                                  </Tag>
                                </div>
                                
                                <Row gutter={8} style={{ marginBottom: 8 }}>
                                  <Col span={8}>
                                    <div style={{ fontSize: 12, color: "#666" }}>In Time</div>
                                    <div style={{ fontWeight: "bold" }}>{record.inTime || "-"}</div>
                                  </Col>
                                  <Col span={8}>
                                    <div style={{ fontSize: 12, color: "#666" }}>Out Time</div>
                                    <div style={{ fontWeight: "bold" }}>{record.outTime || "-"}</div>
                                  </Col>
                                  <Col span={8}>
                                    <div style={{ fontSize: 12, color: "#666" }}>Hours</div>
                                    <div style={{ fontWeight: "bold", color: "#1890ff" }}>
                                      {record.hours || "-"}
                                    </div>
                                  </Col>
                                </Row>

                                {record.punchTimes && record.punchTimes.length > 0 && (
                                  <div>
                                    <div style={{ fontSize: 12, color: "#666", marginBottom: 4 }}>
                                      All Punch Times:
                                    </div>
                                    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                                      {record.punchTimes.map((time, idx) => (
                                        <Tag key={idx} color="blue" style={{ margin: 0 }}>
                                          {time}
                                        </Tag>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </Card>
                            ))}
                          </div>
                        </Panel>
                      </Collapse>
                    </Card>
                  </Col>
                ))}
              </Row>
            )}
          </div>
        ) : (
          // Table View
          <Table
            columns={columns}
            dataSource={records}
            rowKey={(rec) => rec.id || `${rec.employeeId || rec.employee}-${rec.date}-${Math.random().toString(36).slice(2,7)}`}
            bordered
            scroll={{ x: "max-content" }}
            pagination={{ pageSize: 10, showSizeChanger: true, showTotal: (total) => `Total ${total} records` }}
          />
        )}
      </Content>
    </Layout>
  );
}
