import React, { useState, useEffect, useRef } from 'react';
import { Drawer, List, Avatar, Input, Button, Badge, Typography, message, Tabs, Grid } from 'antd';
import { SendOutlined, UserOutlined, SearchOutlined, MessageOutlined, TeamOutlined } from '@ant-design/icons';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, doc, setDoc, orderBy, getDocs, limit } from 'firebase/firestore';
import dayjs from 'dayjs';

const { Text } = Typography;
const { useBreakpoint } = Grid;

const ChatDrawer = ({ open, onClose, currentUserEmail, currentUserName, darkMode }) => {
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

  // Theme Constants
  const BG_COLOR = darkMode ? "#141414" : "#ffffff";
  const TEXT_COLOR = darkMode ? "#ffffff" : "#000000";
  const SUBTEXT_COLOR = darkMode ? "#a6a6a6" : "#999999";
  const HOVER_BG = darkMode ? "#1f1f1f" : "#f5f5f5";
  
  const CHAT_BG = darkMode ? "#000000" : "#e5ddd5";
  const INPUT_BG = darkMode ? "#1f1f1f" : "#f0f0f0";
  
  const MY_MSG_BG = darkMode ? "#056162" : "#dcf8c6"; // Darker green for dark mode
  const MY_MSG_TEXT = darkMode ? "#fff" : "#000";
  
  const THEIR_MSG_BG = darkMode ? "#262d31" : "#fff";
  const THEIR_MSG_TEXT = darkMode ? "#fff" : "#000";


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

  // Listen to Messages (Specific Conversation) - LAST 50 MESSAGES
  useEffect(() => {
    if (!selectedUser || !myEmail) return;

    const emails = [myEmail, selectedUser.email.toLowerCase()].sort();
    const safeChatId = emails.join("_");
    
    // Removed Date Filtering to ensure latest messages are always visible
    const q = query(
      collection(db, "chats", safeChatId, "messages"),
      orderBy("timestamp", "desc"), // Get newest first
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const msgs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      }));
      // Reverse to show oldest first (Standard Chat UI)
      setMessages(msgs.reverse());
      setTimeout(() => scrollToBottom(), 100);
    });

    return () => unsubscribe();
  }, [selectedUser, myEmail]);

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
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: CHAT_BG }}>
                <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
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
                                    background: isMyMessage ? MY_MSG_BG : THEIR_MSG_BG,
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.1)',
                                    wordBreak: 'break-word',
                                    color: isMyMessage ? MY_MSG_TEXT : THEIR_MSG_TEXT
                                }}>
                                    {!isMyMessage && <div style={{fontSize:10, color:'#e59235', marginBottom:2}}>{selectedUser.name}</div>}
                                    <div style={{ fontSize: 14 }}>{msg.text}</div>
                                    <div style={{ fontSize: 10, color: darkMode ? 'rgba(255,255,255,0.6)' : '#999', textAlign: 'right', marginTop: 4 }}>
                                        {msg.timestamp ? dayjs(msg.timestamp.toDate()).format('HH:mm') : '...'}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                    <div ref={messagesEndRef} />
                </div>

                <div style={{ padding: 12, background: INPUT_BG, display: 'flex', gap: 8 }}>
                    <Input 
                        value={inputText}
                        onChange={(e) => setInputText(e.target.value)}
                        onPressEnter={handleSendMessage}
                        placeholder="Type a message..."
                        style={darkMode ? { background: "#333", color: "#fff", borderColor: "#444" } : {}}
                    />
                    <Button type="primary" icon={<SendOutlined />} onClick={handleSendMessage} />
                </div>
            </div>
          );
      }

      // LIST VIEW
      const items = activeTab === 'chats' ? activeChats : filteredUsers;
      
      return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: BG_COLOR }}>
              <div style={{ padding: '0 12px' }}>
                <Tabs 
                    activeKey={activeTab} 
                    onChange={setActiveTab}
                    items={[
                        { key: 'chats', label: <span style={{color: TEXT_COLOR}}><MessageOutlined /> Chats</span> },
                        { key: 'contacts', label: <span style={{color: TEXT_COLOR}}><TeamOutlined /> Contacts</span> }
                    ]}
                />
              </div>
              
              {activeTab === 'contacts' && (
                <div style={{ padding: '0 12px 12px 12px' }}>
                    <Input 
                        prefix={<SearchOutlined style={{color: SUBTEXT_COLOR}} />} 
                        placeholder="Search people..." 
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        style={darkMode ? { background: "#333", color: "#fff", borderColor: "#444" } : {}}
                    />
                </div>
              )}

              <div style={{ flex: 1, overflowY: 'auto' }}>
                  <List
                      itemLayout="horizontal"
                      dataSource={items}
                      locale={{ emptyText: <span style={{color: SUBTEXT_COLOR}}>{activeTab === 'chats' ? "No active conversations" : "No contacts found"}</span> }}
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
                                style={{ cursor: 'pointer', padding: '12px 16px', transition: 'background 0.3s', borderBottom: darkMode ? '1px solid #303030' : '1px solid #f0f0f0' }}
                                className="chat-user-item"
                                onMouseEnter={(e) => e.currentTarget.style.background = HOVER_BG}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                            >
                                <List.Item.Meta
                                avatar={<Avatar icon={<UserOutlined />} src={isChat ? item.otherAvatar : item.avatar} style={{ backgroundColor: isChat ? '#1890ff' : '#87d068' }} />}
                                title={
                                    <div style={{display:'flex', justifyContent:'space-between'}}>
                                        <Text strong style={{color: TEXT_COLOR}}>{name}</Text>
                                        {isChat && item.timestamp && (
                                            <Text type="secondary" style={{fontSize:10, color: SUBTEXT_COLOR}}>
                                                {dayjs(item.timestamp.toDate()).format('D MMM')}
                                            </Text>
                                        )}
                                    </div>
                                }
                                description={<Text type="secondary" style={{ fontSize: 12, color: SUBTEXT_COLOR }} ellipsis>{subtitle}</Text>}
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
      styles={{ 
          body: { padding: 0, display: 'flex', flexDirection: 'column', background: BG_COLOR },
          header: { background: BG_COLOR, color: TEXT_COLOR, borderBottom: `1px solid ${darkMode ? '#303030' : '#f0f0f0'}` },
          content: { background: BG_COLOR }
      }}
      drawerStyle={{ background: BG_COLOR }}
      bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', background: BG_COLOR }}
      headerStyle={{ background: BG_COLOR, color: TEXT_COLOR, borderBottom: `1px solid ${darkMode ? '#303030' : '#f0f0f0'}` }}
      contentWrapperStyle={{ background: BG_COLOR }}
    >
        {renderContent()}
    </Drawer>
  );
};

export default ChatDrawer;
