import React, { useState, useEffect } from "react";
import { Upload, Button, message, Layout, ConfigProvider, Switch, theme } from "antd";
import { UploadOutlined, BulbOutlined, ArrowLeftOutlined } from "@ant-design/icons";
import Papa from "papaparse";
import { db, auth } from "../firebase";
import { collection, addDoc, setDoc, doc, getDocs, query, where, deleteDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { onAuthStateChanged } from "firebase/auth";
import dayjs from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
dayjs.extend(customParseFormat);

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

          // Track processed data for Cleanup
          const processedIds = new Set();
          const impactedEmployees = new Set();
          let minDate = null;
          let maxDate = null;

          // Pass 1: Upload / Update
          for (let i = 0; i < results.data.length; i++) {
            const row = results.data[i];
            const employeeId = getField(row, ["Employee", "Employee ID", "Emp Code", "Card No", "ID"]);
            const firstName = getField(row, ["First Name", "FirstName", "Name", "Employee Name"]);
            const department = getField(row, ["Department", "Dept", "Dpt"]);
            
            // Date Normalization
            let dateStr = getField(row, ["Date", "Punch Date"]);
            
             // Fix: Prioritize DD-MM-YYYY for India/UK formats (Project Standard)
             const formats = [
                 "DD-MM-YYYY", 
                 "DD/MM/YYYY",
                 "MM-DD-YYYY", 
                 "MM/DD/YYYY", 
                 "M/D/YYYY", 
                 "M-D-YYYY", 
                 "YYYY-MM-DD"
             ];
             
             let d = dayjs(dateStr, formats, true); 
             if (!d.isValid()) {
                d = dayjs(dateStr, formats, false);
             }
             
             if (d.isValid()) {
                dateStr = d.format("YYYY-MM-DD");
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
             
             // Track Range
             if (!minDate || dayjs(dateStr).isBefore(dayjs(minDate))) minDate = dateStr;
             if (!maxDate || dayjs(dateStr).isAfter(dayjs(maxDate))) maxDate = dateStr;

             // Unique ID Generation (Consistent with Dashboards)
             const safeEmpId = (employeeId || "").replace(/[^a-zA-Z0-9]/g, "_");
             const safeDate = (dateStr || "").replace(/[^a-zA-Z0-9-]/g, "_");
             const uniqueId = `${safeEmpId}_${safeDate}`;

             processedIds.add(uniqueId);
             impactedEmployees.add(employeeId);
  
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
  
             // Ensure 'email' field is populated
             const rowEmail = firstName ? `${firstName.toLowerCase()}@theawakens.com` : "";
             docData.email = rowEmail;
  
             try {
               // USE setDoc to prevent duplicates
               await setDoc(doc(db, "punches", uniqueId), docData);
               successCount++;
             } catch (e) {
               console.error("Upload error:", e);
               failCount++;
             }
          }

          // Pass 2: Cleanup Missing Records in Range
          if (minDate && maxDate && impactedEmployees.size > 0) {
              console.log(`Cleaning up records between ${minDate} and ${maxDate} for ${impactedEmployees.size} employees...`);
              
              for (const empId of impactedEmployees) {
                  try {
                      const q = query(
                          collection(db, "punches"),
                          where("employeeId", "==", empId),
                          where("date", ">=", minDate),
                          where("date", "<=", maxDate)
                      );
                      const snapshot = await getDocs(q);
                      const deletePromises = [];
                      
                      snapshot.docs.forEach(docSnap => {
                          if (!processedIds.has(docSnap.id)) {
                              console.log(`Deleting obsolete record: ${docSnap.id}`);
                              deletePromises.push(deleteDoc(docSnap.ref));
                          }
                      });
                      
                      if (deletePromises.length > 0) {
                          await Promise.all(deletePromises);
                          console.log(`Deleted ${deletePromises.length} obsolete records for ${empId}`);
                      }
                  } catch (err) {
                      console.error(`Cleanup failed for ${empId}`, err);
                  }
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
