# MongoDB-Based Authentication Setup

Users are now stored in MongoDB instead of environment variables. This makes user management much easier!

## Features

✅ Users stored in MongoDB database
✅ Admin UI for managing users
✅ No need to edit environment variables
✅ No need to redeploy when adding users
✅ Automatic password hashing
✅ Last login tracking

## Quick Setup (5 Steps)

### Step 1: Set JWT Secret

In Netlify Dashboard → Site settings → Environment variables:

**Variable name:** `JWT_SECRET`

**Value:** Generate with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Example output:
```
a4f8d3e2b1c7f6e5d4c3b2a1f0e9d8c7b6a5f4e3d2c1b0a9f8e7d6c5b4a3f2e1
```

**That's the ONLY environment variable you need!**

### Step 2: Deploy Your Site

```bash
cd /Users/marcuspeterson/Dev/v-school/automations/report-builder/ltp-netlify

# Rename the new dashboard
mv public/index.html public/index-old-identity.html
mv public/index-new.html public/index.html

# Deploy
git add .
git commit -m "Switch to MongoDB-based authentication"
git push
```

Wait for Netlify to finish deploying.

### Step 3: Create First Admin User

Visit this special endpoint (only works when no users exist):

```
https://your-site.netlify.app/.netlify/functions/users-init
```

Send a POST request with your admin credentials:

**Using curl:**
```bash
curl -X POST https://your-site.netlify.app/.netlify/functions/users-init \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@vschool.com","password":"YourSecurePassword123"}'
```

**Or using Postman/Insomnia:**
- Method: POST
- URL: `https://your-site.netlify.app/.netlify/functions/users-init`
- Body (JSON):
  ```json
  {
    "email": "admin@vschool.com",
    "password": "YourSecurePassword123"
  }
  ```

You should get:
```json
{
  "success": true,
  "message": "First admin user created successfully"
}
```

**Note:** This endpoint only works ONCE (when there are no users). After that, it will return an error. This is a security feature.

### Step 4: Login

Visit your site:
```
https://your-site.netlify.app/login.html
```

Login with the credentials you just created.

### Step 5: Add More Users

Once logged in as admin:

1. Click **"👥 Manage Users"** in the dashboard
2. Click **"+ Add User"**
3. Fill in the form:
   - **Email**: User's email
   - **Password**: Their password (min 8 characters)
   - **Role**: Admin or Student
   - **Student ID**: (Required for students) Their Airtable record ID
4. Click **"Create User"**

**Done!** The new user can now log in immediately.

## User Roles

### Admin
- Can manage users (create/delete)
- Can view all reports
- Can access database inspector
- Can sync students
- Can view any student's data
- **Cannot self-register** - must be created via admin UI or users-init endpoint

### Student
- Can only view their own progress
- Linked to a specific studentId (Airtable record)
- Cannot access admin tools
- Cannot see other students' data
- **Can self-register** - students can create their own accounts using the signup form

## Finding Student IDs

To find a student's ID for linking:

1. Go to database inspector: `https://your-site.netlify.app/.netlify/functions/db-inspect?collection=students&format=pretty`
2. Find the student in the list
3. Copy their `studentId` (e.g., `recCjf5amsnxKfuP1`)
4. Use this when creating their user account

Or check your Airtable Students table - the record ID is the studentId.

## Managing Users

### Students Can Self-Register
Students can create their own accounts:

1. Go to login page: `https://your-site.netlify.app/login.html`
2. Click the **"Sign Up"** tab
3. Fill in:
   - Email address
   - Password (min 8 characters)
   - Student ID (their Airtable record ID)
4. Click "Create Account"
5. Automatically logged in and redirected to dashboard

**Requirements for signup:**
- Student ID must exist in the `students` collection
- Email cannot already be registered
- Password must be at least 8 characters

### Admin: Add a User Manually
1. Dashboard → Manage Users
2. Click "+ Add User"
3. Fill form and submit
4. Can create both admin and student accounts

### Delete a User
1. Dashboard → Manage Users
2. Find user in list
3. Click "Delete"
4. Confirm

**Note:** Deleting a user is permanent and cannot be undone.

## Security

✅ Passwords are hashed with SHA-256
✅ JWT tokens expire after 7 days
✅ HttpOnly cookies prevent XSS
✅ Admin-only endpoints protected
✅ Student data isolated by studentId

## API Endpoints

### Authentication
- `POST /.netlify/functions/auth-login` - Login (public)
- `POST /.netlify/functions/auth-signup` - Student self-registration (public)
- `POST /.netlify/functions/auth-logout` - Logout
- `GET /.netlify/functions/auth-me` - Get current user

### User Management (Admin Only)
- `GET /.netlify/functions/users-list` - List all users
- `POST /.netlify/functions/users-create` - Create a user
- `DELETE /.netlify/functions/users-delete?id=XXX` - Delete a user
- `POST /.netlify/functions/users-init` - Create first admin (one-time only)

### Reports
- `GET /.netlify/functions/my-report` - Student's own report
- `GET /.netlify/functions/report-weekly` - Weekly report (admin)
- `GET /.netlify/functions/db-inspect` - Database inspector (admin)

## Troubleshooting

### "Failed to load users"
- Check that you're logged in as admin
- Check browser console for errors
- Verify MongoDB connection is working

### Can't create first admin user
- Make sure no users exist in the database
- Check that JWT_SECRET is set in Netlify
- Try clearing the `users` collection in MongoDB

### Student can't see their report
- Verify studentId is set correctly in their user account
- Check that studentId exists in students collection
- Make sure case matches exactly (case-sensitive)

### "Invalid email or password"
- Check email is correct (case-insensitive)
- Verify password is correct
- User must have `active: true` in database

## Database Schema

### Users Collection

```javascript
{
  _id: ObjectId,
  email: String (lowercase, unique),
  passwordHash: String (SHA-256),
  role: String ("admin" or "student"),
  studentId: String (null for admins, required for students),
  active: Boolean (default: true),
  createdAt: Date,
  lastLogin: Date (null until first login)
}
```

## Migrating from Environment Variables

If you previously set up `AUTH_USERS` in environment variables:

1. Deploy the new MongoDB auth system
2. Create first admin via `/users-init`
3. Log in as admin
4. Manually re-create each user through the admin UI
5. Remove `AUTH_USERS` from environment variables (no longer needed)

## Cost

**FREE** - Everything runs on your existing MongoDB database and Netlify functions.

No additional services or monthly fees!

## Files Created

**Backend:**
- `netlify/functions/utils/db-auth.js` - MongoDB-based auth
- `netlify/functions/users-list.js` - List users
- `netlify/functions/users-create.js` - Create user
- `netlify/functions/users-delete.js` - Delete user
- `netlify/functions/users-init.js` - Initialize first admin

**Frontend:**
- `public/admin-users.html` - User management UI
- `public/login.html` - Login page
- `public/index-new.html` - Dashboard (rename to index.html)

**Updated:**
- `netlify/functions/auth-login.js` - Uses MongoDB
- `netlify/functions/auth-me.js` - Uses MongoDB
- `netlify/functions/db-inspect.js` - Uses db-auth
- `netlify/functions/my-report.js` - Uses db-auth

## Next Steps

Once setup is complete:

1. ✅ Add your admin user(s)
2. ✅ Add student users (link to their studentId)
3. ✅ Test login for each role
4. ✅ Verify students can only see their own data
5. ✅ Verify admins can see all data

**You're all set!** No more editing environment variables - just use the admin UI.
