import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Login from "./pages/Login.jsx";
import AdminDashboard from "./pages/AdminDashboard.jsx";
import EmployeeDashboard from "./pages/EmployeeDashboard.jsx";
import UploadFile from "./pages/UploadFile.jsx";

export default function App() {
  return (
    <BrowserRouter basename="/">
      <Routes>
        <Route path="/" element={<Login />} /> 
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/employee" element={<EmployeeDashboard />} />
        <Route path="/upload" element={<UploadFile  />} />
      </Routes>
    </BrowserRouter>
  );
}
