import express, { Request, Response } from 'express';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';

const app = express();

// Correct database path using path.join and __dirname
const dbPath = path.join(__dirname, '../db/users.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error(`Error opening database at ${dbPath}: ${err.message}`);
  } else {
    console.log(`Connected to the database at ${dbPath}`);
  }
});

// Get the root directory of the project, which is one level up from `dist`
const projectRoot = path.resolve(__dirname, '..');

// Middleware to parse incoming requests with JSON and URL-encoded bodies
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files (if any) from the 'public' directory
app.use(express.static(path.join(projectRoot, 'public')));

// Route to serve the sign-in page
app.get('/sign_in', (req: Request, res: Response) => {
  res.sendFile(path.join(projectRoot, 'views', 'sign_in.html'));
});

// Route to serve the register page
app.get('/register', (req: Request, res: Response) => {
  res.sendFile(path.join(projectRoot, 'views', 'register.html'));
});

// Route to serve the search page
app.get('/search', (req: Request, res: Response) => {
  res.sendFile(path.join(projectRoot, 'views', 'search.html'));
});

// Route to serve the user preferences
app.get('/user_preferences', (req: Request, res: Response) => {
  res.sendFile(path.join(projectRoot, 'views', 'user_preferences.html'));
});

// Handle form submission from the register page
app.post('/register', (req: Request, res: Response) => {
  const { username, password, email, first_name, last_name } = req.body;

  // Hash the password before storing
  const hashedPassword = bcrypt.hashSync(password, 10);

  // Insert the new user into the database
  db.run(
    'INSERT INTO users (username, password, email, first_name, last_name, permissions) VALUES (?, ?, ?, ?, ?, ?)',
    [username, hashedPassword, email, first_name, last_name, 'user'],
    function (err) {
      if (err) {
        return res.status(500).send('Error registering new user');
      }
      res.redirect('/sign_in'); // Redirect to the sign-in page after successful registration
    }
  );
});

// Handle sign in
app.post('/sign_in', (req: Request, res: Response) => {
  const { identifier, password } = req.body;

  // Try to find the user by username or email
  db.get(
    'SELECT * FROM users WHERE username = ? OR email = ?',
    [identifier, identifier],
    (err, user: { password: string } | undefined) => {
      if (err || !user) {
        return res.status(400).send('User not found');
      }

      // Compare the submitted password with the stored hash
      const isMatch = bcrypt.compareSync(password, user.password);
      if (!isMatch) {
        return res.status(400).send('Invalid credentials');
      }

      // Redirect to search page on successful login
      res.redirect('/search');
    }
  );
});

// Handle updating the user
app.post('/update_user', (req: Request, res: Response) => {
  const { first_name, last_name, email } = req.body;
  const userId = 1; // Use session or token to identify user; assuming userId = 1 here

  db.run(
    'UPDATE users SET first_name = ?, last_name = ?, email = ? WHERE id = ?',
    [first_name, last_name, email, userId],
    function (err) {
      if (err) {
        return res.status(500).send('Error updating user information');
      }
      res.redirect('/user_preferences');
    }
  );
});

// Handle deleting the account
app.post('/delete_account', (req: Request, res: Response) => {
  const userId = 1; // Use session or token to identify user; assuming userId = 1 here

  db.run('DELETE FROM users WHERE id = ?', [userId], function (err) {
    if (err) {
      return res.status(500).send('Error deleting account');
    }
    res.redirect('/sign_in');
  });
});

// Start the server
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
