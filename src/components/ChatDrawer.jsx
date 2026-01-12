import React, { useState, useEffect, useRef } from 'react';
import { Drawer, List, Avatar, Input, Button, Badge, Typography, message, Tabs, Grid } from 'antd';
import { SendOutlined, UserOutlined, SearchOutlined, MessageOutlined, TeamOutlined } from '@ant-design/icons';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, setDoc, orderBy, getDocs } from 'firebase/firestore';
import dayjs from 'dayjs';

const { Text } = Typography;
const { useBreakpoint } = Grid;

const ChatDrawer = ({ open, onClose, currentUserEmail, currentUserName, selectedMonth }) => {
  const screens = useBreakpoint();
  const drawerWidth = screens.xs ? "100%" : 400;
  const [activeTab, setActiveTab] = useState('chats'); // 'chats' or 'contacts'
  
  const [users, setUsers] = useState([]);
  const [filteredUsers, setFilteredUsers] = useState([]);
  
  const [activeChats, setActiveChats] = useState([]);
  
  const [selectedUser, setSelectedUser] = useState(null);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [searchText, setSearchText] = useState('');
  
  const messagesEndRef = useRef(null);

  const myEmail = (currentUserEmail || '').toLowerCase(); // Normalize my email

  // Fetch Users (Contacts)
  useEffect(() => {
    if (!open) return;
    if (users.length > 0) return; // OPTIMIZATION: Use cached users if available
    
    const fetchUsers = async () => {
      try {
        const q = query(collection(db, "employees"));
        const snap = await getDocs(q);
        const empList = snap.docs.map(d => ({
            email: (d.data().email || '').toLowerCase(),
            name: d.data().firstName ? `${d.data().firstName} ${d.data().lastName || ''}` : d.data().employee,
            avatar: d.data().profilePic || null
        })).filter(u => u.email && u.email !== myEmail);
        
        // Deduplicate by email
        const uniqueUsers = [];
        const seenEmails = new Set();
        
        empList.forEach(u => {
            if (!seenEmails.has(u.email)) {
                seenEmails.add(u.email);
                uniqueUsers.push(u);
            }
        });
        
        // Add Admin manually if not in list
        const adminEmail = "chirag@theawakens.com"; 
        if (myEmail !== adminEmail && !seenEmails.has(adminEmail)) {
            uniqueUsers.unshift({ email: adminEmail, name: "Admin (Chirag)", avatar: null });
        }
        
        uniqueUsers.sort((a,b) => a.name.localeCompare(b.name));
        
        setUsers(uniqueUsers);
        setFilteredUsers(uniqueUsers);
      } catch (e) {
        console.error("Failed to fetch users", e);
      }
    };
    
    fetchUsers();
  }, [open, myEmail, users.length]);

  // Filter Users
  useEffect(() => {
      if (!searchText) {
          setFilteredUsers(users);
      } else {
          setFilteredUsers(users.filter(u => u.name.toLowerCase().includes(searchText.toLowerCase()) || u.email.includes(searchText.toLowerCase())));
      }
  }, [searchText, users]);

  // Fetch Active Chats (Recent Conversations)
  useEffect(() => {
      if (!open || !myEmail) return;
      
      const q = query(
          collection(db, "chats"), 
          where("participants", "array-contains", myEmail),
          orderBy("lastMessageTime", "desc")
      );

      const unsubscribe = onSnapshot(q, (snapshot) => {
          const chats = snapshot.docs.map(doc => {
              const data = doc.data();
              const otherEmail = (data.participants || []).find(p => p.toLowerCase() !== myEmail);
              const userDetails = users.find(u => u.email === otherEmail);
              
              return {
                  id: doc.id,
                  otherEmail: otherEmail || "Unknown",
                  otherName: userDetails ? userDetails.name : (otherEmail || "Unknown"),
                  otherAvatar: userDetails ? userDetails.avatar : null,
                  lastMessage: data.lastMessage,
                  timestamp: data.lastMessageTime
              };
          });
          setActiveChats(chats);
      });
      
      return () => unsubscribe();
  }, [open, myEmail, users]);

  // Listen to Messages (Specific Conversation) - FILTER BY MONTH
  useEffect(() => {
    if (!selectedUser || !myEmail) return;

    const emails = [myEmail, selectedUser.email.toLowerCase()].sort();
    const safeChatId = emails.join("_");
    
    // Date Range for Selected Month (or default to current month if null, but dashboard usually provides one)
    const currentMonth = selectedMonth ? dayjs(selectedMonth) : dayjs();
    const startOfMonth = currentMonth.startOf('month').toDate();
    const endOfMonth = currentMonth.endOf('month').toDate();

    const q = query(
      collection(db, "chats", safeChatId, "messages"),
      where("timestamp", ">=", startOfMonth),
      where("timestamp", "<=", endOfMonth),
      orderBy("timestamp", "asc")
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      setMessages(msgs);
      setTimeout(() => scrollToBottom(), 100);
    });

    return () => unsubscribe();
  }, [selectedUser, myEmail, selectedMonth]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  const handleSendMessage = async () => {
    if (!inputText.trim() || !selectedUser || !myEmail) return;

    const text = inputText;
    setInputText(''); 

    try {
        const otherEmail = selectedUser.email.toLowerCase();
        const emails = [myEmail, otherEmail].sort();
        const chatId = emails.join("_");
        
        // Update Main Chat Doc
        await setDoc(doc(db, "chats", chatId), {
            participants: emails, // Save as lowercase
            lastMessage: text,
            lastMessageTime: serverTimestamp()
        }, { merge: true });

        // Add Message
        await addDoc(collection(db, "chats", chatId, "messages"), {
            text,
            sender: myEmail,
            senderName: currentUserName || myEmail,
            timestamp: serverTimestamp(),
            read: false
        });
        
    } catch (e) {
        console.error("Failed to send", e);
        message.error("Failed to send message");
    }
  };

  const renderContent = () => {
      if (selectedUser) {
          // CHAT WINDOW
          return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                <div style={{ flex: 1, overflowY: 'auto', padding: 16, background: '#e5ddd5' }}>
                    {messages.map((msg) => {
                        const isMyMessage = (msg.sender || '').toLowerCase() === myEmail;
                        return (
                            <div 
                                key={msg.id} 
                                style={{ 
                                    display: 'flex', 
                                    justifyContent: isMyMessage ? 'flex-end' : 'flex-start',
                                    marginBottom: 12
                                }}
                            >
                                <div style={{
                                    maxWidth: '75%',
                                    padding: '8px 12px',
                                    borderRadius: 8,
                                    background: isMyMessage ? '#dcf8c6' : '#fff',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                                    wordBreak: 'break-word'
                                }}>
                                    {!isMyMessage && <div style={{fontSize:10, color:'#e59235', marginBottom:2}}>{selectedUser.name}</div>}
                                    <div style={{ fontSize: 14, color: '#000' }}>{msg.text}</div>
                                    <div style={{ fontSize: 10, color: '#999', textAlign: 'right', marginTop: 4 }}>
                                        {msg.timestamp ? dayjs(msg.timestamp.toDate()).format('HH:mm') : '...'}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    <div ref={messagesEndRef} />
                </div>

                <div style={{ padding: 12, background: '#f0f0f0', display: 'flex', gap: 8 }}>
                    <Input 
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onPressEnter={handleSendMessage}
                        placeholder="Type a message..."
                    />
                    <Button type="primary" icon={<SendOutlined />} onClick={handleSendMessage} />
                </div>
            </div>
          );
      }

      // LIST VIEW
      const items = activeTab === 'chats' ? activeChats : filteredUsers;
      
      return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
              <div style={{ padding: '0 12px' }}>
                <Tabs 
                    activeKey={activeTab} 
                    onChange={setActiveTab}
                    items={[
                        { key: 'chats', label: <span><MessageOutlined /> Chats</span> },
                        { key: 'contacts', label: <span><TeamOutlined /> Contacts</span> }
                    ]}
                />
              </div>
              
              {activeTab === 'contacts' && (
                <div style={{ padding: '0 12px 12px 12px' }}>
                    <Input 
                        prefix={<SearchOutlined />} 
                        placeholder="Search people..." 
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                    />
                </div>
              )}

              <div style={{ flex: 1, overflowY: 'auto' }}>
                  <List
                      itemLayout="horizontal"
                      dataSource={items}
                      locale={{ emptyText: activeTab === 'chats' ? "No active conversations" : "No contacts found" }}
                      renderItem={item => {
                          // If Chats tab, item is { otherEmail, otherName, lastMessage ... }
                          // If Contacts tab, item is { email, name, avatar }
                          
                          const isChat = activeTab === 'chats';
                          const name = isChat ? item.otherName : item.name;
                          const subtitle = isChat ? (item.lastMessage || "No messages") : item.email;
                          const userObj = isChat 
                            ? { email: item.otherEmail, name: item.otherName, avatar: item.otherAvatar }
                            : item;

                          return (
                            <List.Item 
                                onClick={() => setSelectedUser(userObj)}
                                style={{ cursor: 'pointer', padding: '12px 16px', transition: 'background 0.3s' }}
                                className="chat-user-item"
                                onMouseEnter={(e) => e.currentTarget.style.background = '#f5f5f5'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                            >
                                <List.Item.Meta
                                avatar={<Avatar icon={<UserOutlined />} src={isChat ? item.otherAvatar : item.avatar} style={{ backgroundColor: isChat ? '#1890ff' : '#87d068' }} />}
                                title={
                                    <div style={{display:'flex', justifyContent:'space-between'}}>
                                        <Text strong>{name}</Text>
                                        {isChat && item.timestamp && (
                                            <Text type="secondary" style={{fontSize:10}}>
                                                {dayjs(item.timestamp.toDate()).format('D MMM')}
                                            </Text>
                                        )}
                                    </div>
                                }
                                description={<Text type="secondary" style={{ fontSize: 12 }} ellipsis>{subtitle}</Text>}
                                />
                            </List.Item>
                          );
                      }}
                  />
              </div>
          </div>
      );
  };

  return (
    <Drawer
      title={selectedUser ? `Chat with ${selectedUser.name}` : "Messages"}
      placement="right"
      onClose={() => { setSelectedUser(null); onClose(); }}
      open={open}
      width={drawerWidth}
      extra={selectedUser && <Button type="link" onClick={() => setSelectedUser(null)}>Back</Button>}
      styles={{ body: { padding: 0, display: 'flex', flexDirection: 'column' } }}
    >
        {renderContent()}
    </Drawer>
  );
};

export default ChatDrawer;
