import React, { useEffect, useState } from "react";
import {
  Table,
  Button,
  Modal,
  Form,
  Input,
  Tag,
  message
} from "antd";
import { db } from "../firebase";
import {
  collection,
  getDocs,
  updateDoc,
  doc
} from "firebase/firestore";

export default function TeamLeaderDashboard() {
  const [requests, setRequests] = useState([]);
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(null);
  const [form] = Form.useForm();

  const loadRequests = async () => {
    const snap = await getDocs(collection(db, "punchRequests"));
    setRequests(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  };

  useEffect(() => {
    loadRequests();
  }, []);

  const openApprove = (r) => {
    setCurrent(r);
    form.setFieldsValue({
      requestedPunchTimes: r.requestedPunchTimes.join(", "),
      teamLeaderComment: ""
    });
    setOpen(true);
  };

  const approve = async (values) => {
    const punchTimes = values.requestedPunchTimes.split(",").map(t => t.trim());

    await updateDoc(doc(db, "punches", current.punchId), {
      punchTimes,
      numberOfPunches: punchTimes.length
    });

    await updateDoc(doc(db, "punchRequests", current.id), {
      status: "approved",
      teamLeaderComment: values.teamLeaderComment,
      updatedAt: new Date().toISOString()
    });

    message.success("Punch updated");
    setOpen(false);
    loadRequests();
  };

  const reject = async () => {
    await updateDoc(doc(db, "punchRequests", current.id), {
      status: "rejected",
      updatedAt: new Date().toISOString()
    });
    message.warning("Request rejected");
    setOpen(false);
    loadRequests();
  };

  const columns = [
    { title: "Employee", dataIndex: "employeeId" },
    { title: "Date", dataIndex: "date" },
    {
      title: "Status",
      dataIndex: "status",
      render: s => <Tag color={s === "pending" ? "orange" : s === "approved" ? "green" : "red"}>{s}</Tag>
    },
    {
      title: "Action",
      render: (_, r) =>
        r.status === "pending" && (
          <Button onClick={() => openApprove(r)}>Review</Button>
        )
    }
  ];

  return (
    <>
      <h2>Team Leader Dashboard</h2>
      <Table columns={columns} dataSource={requests} rowKey="id" bordered />

      <Modal open={open} title="Review Request" footer={null} onCancel={() => setOpen(false)}>
        <Form layout="vertical" form={form} onFinish={approve}>
          <Form.Item label="Requested Punch Times" name="requestedPunchTimes">
            <Input />
          </Form.Item>
          <Form.Item label="Comment" name="teamLeaderComment">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit">Approve</Button>
          <Button danger onClick={reject} style={{ marginLeft: 8 }}>Reject</Button>
        </Form>
      </Modal>
    </>
  );
}
