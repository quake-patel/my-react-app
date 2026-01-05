import React, { useState, useEffect } from "react";
import { Upload, Button, message, Layout, ConfigProvider, Switch, theme } from "antd";
import { UploadOutlined, BulbOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import Papa from "papaparse";
import { db, auth } from "../firebase";
import { collection, addDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";

const { Content } = Layout;
const { darkAlgorithm, defaultAlgorithm } = theme;
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
    // Relaxed Regex: Matches H:MM, HH:MM, H:MM:SS, HH:MM:SS
    // Also splits by comma, space, or semicolon
    const rawTimes = timeValue.split(/[,;\s]+/).map(t => t.trim());
    
    times = rawTimes.filter(t => {
        // Basic check: starts with digit, has colon
        return t && /^\d{1,2}:\d{2}/.test(t);
    }).map(t => {
        // Strip seconds if present for consistency (HH:MM is standard in app)
        // or keep them. App seems to use HH:MM. Let's truncate to HH:MM.
        const parts = t.split(":");
        if (parts.length >= 2) {
            return `${parts[0]}:${parts[1]}`;
        }
        return t;
    });
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

// ... inside component ...
export default function UploadFile() {
  const [uploading, setUploading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);
  const [userEmail, setUserEmail] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
        if (user) setUserEmail(user.email.toLowerCase());
        else setUserEmail(null);
    });
    return () => unsub();
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
        let failCount = 0;

        for (let i = 0; i < results.data.length; i++) {
          const row = results.data[i];
          const employeeId = getField(row, ["Employee", "Employee ID", "Emp Code", "Card No", "ID"]);
          const firstName = getField(row, ["First Name", "FirstName", "Name", "Employee Name"]);
          const department = getField(row, ["Department", "Dept", "Dpt"]);
          
          // Date Normalization
          let dateStr = getField(row, ["Date", "Punch Date"]);
          // Try to convert DD/MM/YYYY or DD-MM-YYYY to YYYY-MM-DD
          // Simple heuristic: if includes slash, try to parse
          if (dateStr && (dateStr.includes("/") || dateStr.includes("-"))) {
             // Assuming DD-MM-YYYY or DD/MM/YYYY commonly used in India/UK
             // If strictly YYYY-MM-DD, it works fine
             const parts = dateStr.split(/[\/\-]/);
             if (parts.length === 3) {
                 // Check if first part looks like year
                 if (parts[0].length === 4) {
                     // YYYY-MM-DD - Keep as is
                     dateStr = `${parts[0]}-${parts[1]}-${parts[2]}`;
                 } else {
                     // Assume DD-MM-YYYY -> YYYY-MM-DD
                     // part[2] is year, part[1] is month, part[0] is day
                     dateStr = `${parts[2]}-${parts[1]}-${parts[0]}`;
                 }
             }
          }

          const numberOfPunchesStr = getField(row, ["No. of Punches", "Punches"]);
          const numberOfPunches = numberOfPunchesStr ? parseInt(numberOfPunchesStr, 10) : 0;
          const timeValue = getField(row, ["Time", "Times", "Punch Records", "Punches"]);
          const punchTimes = parseTimes(timeValue, numberOfPunches);
          const { inTime, outTime, totalHours } = calculateTimes(punchTimes);

          // Validation: If no Employee ID or Date, skip
          if (!employeeId || !dateStr) {
              failCount++;
              continue;
          }

          const docData = {
            employeeId: employeeId || "",
            firstName: firstName || "",
            employee: firstName ? `${firstName} (${employeeId || "N/A"})` : employeeId || "Unknown",
            department: department || "",
            date: dateStr || "", // Standardized Date
            numberOfPunches: punchTimes.length,
            punchTimes,
            inTime,
            outTime,
            hours: totalHours,
            uploadedAt: new Date().toISOString(),
          };

          // Filter Removed: User Requested ability to upload ALL data (like Admin)
          // Since Rules now allow authenticated writes to 'punches', we don't need to filter.
          // BUT we must ensure the 'email.email' field is populated correctly.
          const rowEmail = firstName ? `${firstName.toLowerCase()}@theawakens.com` : "";
          docData.email = rowEmail;

          try {
            await addDoc(punchesRef, docData);
            successCount++;
          } catch (e) {
            console.error("Upload error:", e);
            failCount++;
          }
        }

        setUploading(false);
        if (failCount > 0) {
            message.warning(`${successCount} rows uploaded, ${failCount} skipped/failed.`);
            console.warn("Some rows failed to upload due to missing ID/Date or parsing errors.");
        } else {
            message.success(`${successCount} rows uploaded successfully!`);
        }
      },
      error: (err) => {
        console.error(err);
        message.error("CSV parse error");
        setUploading(false);
      },
    });

    return false; // Prevent default upload
  };

  return (
    <ConfigProvider theme={{ algorithm: darkMode ? darkAlgorithm : defaultAlgorithm }}>
      <Layout style={{ minHeight: "100vh" }}>
        <Content style={{ display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: 24, gap: 16 }}>
          
          <div style={{ position: 'absolute', top: 20, left: 20 }}>
             <Button type="link" icon={<ArrowLeftOutlined />} onClick={() => navigate(-1)}>Back</Button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <BulbOutlined style={{ color: darkMode ? "#fff" : "#000" }} />
            <Switch checked={darkMode} onChange={setDarkMode} checkedChildren="Dark" unCheckedChildren="Light" />
          </div>
          <Upload beforeUpload={handleFileUpload} showUploadList={false} accept=".csv">
            <Button type="primary" icon={<UploadOutlined />} loading={uploading}>
              Upload CSV
            </Button>
          </Upload>
        </Content>
      </Layout>
    </ConfigProvider>
  );
}
