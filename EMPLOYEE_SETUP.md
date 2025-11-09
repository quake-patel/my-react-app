# How Employees See Their Data - Setup Guide

## Overview

Employees can view their time tracking data by logging into the Employee Dashboard. The system matches employee records using their **Employee ID** stored in Firebase.

## How It Works

1. **Employee logs in** with their email and password
2. **System looks up** their Employee ID from the `users` collection in Firestore
3. **System queries** the `punches` collection to find all records matching that Employee ID
4. **Employee sees** their time tracking data in a personalized dashboard

## Setting Up Employee Accounts

### Step 1: Create Employee User in Firebase Authentication

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: **employee-time-tracker-43b16**
3. Click **Authentication** → **Users** tab
4. Click **"Add user"**
5. Enter:
   - **Email**: `employee@company.com` (or employee's email)
   - **Password**: `password123` (or a secure password)
6. Click **"Add user"**
7. **Copy the User UID** (you'll need it in the next step)

### Step 2: Link Employee ID in Firestore

1. In Firebase Console, go to **Firestore Database** → **Data** tab
2. Click on the `users` collection (create it if it doesn't exist)
3. Click **"Add document"** or edit existing user document
4. **Document ID**: Paste the **User UID** from Step 1
5. Add these fields:

   | Field | Type | Value | Description |
   |-------|------|-------|-------------|
   | `email` | string | `employee@company.com` | Employee's email |
   | `employeeId` | string | `1106` | **Employee ID from CSV** (must match CSV data) |
   | `firstName` | string | `Chirag` | Employee's first name (optional but recommended) |
   | `role` | string | `employee` | User role |
   | `createdAt` | string | `2024-01-01T00:00:00.000Z` | Creation timestamp |

6. Click **"Save"**

### Important Notes:

- **Employee ID must match**: The `employeeId` in the `users` collection must match the `employeeId` in the CSV file you upload
- **Case sensitive**: Employee IDs are case-sensitive, so make sure they match exactly
- **Multiple employees**: Repeat Steps 1-2 for each employee

## Example Setup

### CSV Data:
```csv
Employee, First Name, Department, Date, No. of Punches, Time
1106, Chirag, Department, 04-11-2025, 5, 19:18, 20:42, 20:46, 20:47, 20:50
```

### Firebase User Document:
```
Collection: users
Document ID: [User UID from Authentication]
Fields:
  email: "chirag@company.com"
  employeeId: "1106"  ← Must match CSV Employee column
  firstName: "Chirag"
  role: "employee"
  createdAt: "2024-01-01T00:00:00.000Z"
```

### Result:
- Employee logs in with `chirag@company.com`
- System finds Employee ID `1106` in their user document
- System queries `punches` collection for `employeeId == "1106"`
- Employee sees all their time tracking records

## How Employees Access Their Data

1. **Login**: Employee goes to the app and logs in with their email/password
2. **Dashboard**: They are automatically redirected to `/employee` route
3. **View Data**: They see:
   - Their Employee ID, Name, and Department
   - Total records and total hours worked
   - A table with all their punch records showing:
     - Date
     - Department
     - Number of punches
     - In Time (first punch)
     - Out Time (last punch)
     - Hours worked
     - All punch times (as tags)

## Fallback Methods

The system tries multiple methods to find employee records:

1. **Primary**: Query by `employeeId` (from user document)
2. **Secondary**: Query by `email` (if employeeId not found)
3. **Tertiary**: Query by `firstName` (if email not found)

**Best Practice**: Always set the `employeeId` in the user document for reliable matching.

## Troubleshooting

### Problem: Employee sees "No records found"

**Solutions**:
1. Check that `employeeId` in `users` collection matches `employeeId` in `punches` collection
2. Verify that CSV was uploaded with the correct Employee ID
3. Check browser console for error messages
4. Ensure Firestore security rules allow reading from `punches` collection

### Problem: Employee sees wrong data

**Solutions**:
1. Verify Employee ID is correct in user document
2. Check that Employee ID in CSV matches the one in user document
3. Make sure Employee IDs are unique (no duplicates)

### Problem: Employee can't login

**Solutions**:
1. Verify user exists in Firebase Authentication
2. Check that Email/Password authentication is enabled
3. Verify email and password are correct

## Security Rules

Make sure your Firestore security rules allow employees to read their own data:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Users collection
    match /users/{userId} {
      allow read: if request.auth != null && request.auth.uid == userId;
      allow write: if request.auth != null && request.auth.uid == userId;
    }
    
    // Punches collection - employees can read their own records
    match /punches/{punchId} {
      allow read: if request.auth != null && 
        (resource.data.employeeId == get(/databases/$(database)/documents/users/$(request.auth.uid)).data.employeeId ||
         resource.data.email == request.auth.token.email);
      allow create, update, delete: if false; // Only admins can modify
    }
  }
}
```

## Quick Reference

| What | Where | Example |
|------|-------|---------|
| Employee Email | Firebase Authentication | `chirag@company.com` |
| Employee ID | Firestore `users` collection | `1106` |
| Employee ID in CSV | CSV file | `1106` (must match) |
| User Document | Firestore `users/{uid}` | Contains `employeeId` |
| Punch Records | Firestore `punches` collection | Contains `employeeId` |

## Next Steps

1. Create employee user accounts in Firebase Authentication
2. Link Employee IDs in Firestore `users` collection
3. Upload CSV file with time tracking data
4. Employees can now login and view their data!

