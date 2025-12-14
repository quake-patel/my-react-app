// UploadFile.jsx
import React, { useState } from "react";
import { Upload, Button, message, Layout, ConfigProvider, Switch, theme } from "antd";
import { UploadOutlined, BulbOutlined } from "@ant-design/icons";
import Papa from "papaparse";
import { db } from "../firebase";
import { collection, addDoc } from "firebase/firestore";

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

export default function UploadFile() {
  const [uploading, setUploading] = useState(false);
  const [darkMode, setDarkMode] = useState(false);

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
            console.error("Upload error:", e);
          }
        }

        setUploading(false);
        message.success(`${successCount} rows uploaded`);
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
