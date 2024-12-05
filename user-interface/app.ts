import express, { Request, Response, Application } from 'express';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fileUpload from 'express-fileupload';
import { uploadS3 } from './routes/uploadS3';
import fs from 'fs';
import semver from 'semver';
import * as AWS from 'aws-sdk';



const app = express();
const PORT = 3000;

let server: any; // Define a variable to hold the server instance

// Database setup
const dbPath = path.join(__dirname, '../db/users.db');
const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error(`Error opening database at ${dbPath}: ${err.message}`);
  } else {
    console.log(`Connected to the database at ${dbPath}`);
  }
});

// Middleware setup
app.use(fileUpload());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Static files setup
const projectRoot = path.resolve(__dirname, '..');
app.use(express.static(path.join(projectRoot, 'public')));

// Routes
app.get('/sign_in', (req: Request, res: Response) => {
  res.sendFile(path.join(projectRoot, 'views', 'sign_in.html'));
});

app.get('/register', (req: Request, res: Response) => {
  res.sendFile(path.join(projectRoot, 'views', 'register.html'));
});

app.get('/search', (req: Request, res: Response) => {
  res.sendFile(path.join(projectRoot, 'views', 'search.html'));
});

app.get('/user_preferences', (req: Request, res: Response) => {
  res.sendFile(path.join(projectRoot, 'views', 'user_preferences.html'));
});

app.post('/register', (req: Request, res: Response) => {
  const { username, password, email, first_name, last_name } = req.body;
  const hashedPassword = bcrypt.hashSync(password, 10);

  db.run(
    'INSERT INTO users (username, password, email, first_name, last_name, permissions) VALUES (?, ?, ?, ?, ?, ?)',
    [username, hashedPassword, email, first_name, last_name, 'user'],
    function (err) {
      if (err) {
        return res.status(500).send('Error registering new user');
      }
      res.redirect('/sign_in');
    }
  );
});

app.post('/sign_in', (req: Request, res: Response) => {
  const { identifier, password } = req.body;

  db.get(
    'SELECT * FROM users WHERE username = ? OR email = ?',
    [identifier, identifier],
    (err, user: { password: string } | undefined) => {
      if (err || !user) {
        return res.status(400).send('User not found');
      }

      const isMatch = bcrypt.compareSync(password, user.password);
      if (!isMatch) {
        return res.status(400).send('Invalid credentials');
      }

      res.redirect('/search');
    }
  );
});

app.post('/update_user', (req: Request, res: Response) => {
  const { first_name, last_name, email } = req.body;
  const userId = 1;

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

app.post('/delete_account', (req: Request, res: Response) => {
  const userId = 1;

  db.run('DELETE FROM users WHERE id = ?', [userId], function (err) {
    if (err) {
      return res.status(500).send('Error deleting account');
    }
    res.redirect('/sign_in');
  });
});

app.put('/upload/:packageName/:version', async (req: Request, res: Response): Promise<void> => {
  const { packageName, version } = req.params;
  const file = req.files?.package as fileUpload.UploadedFile;

  if (!file) {
    res.status(400).send('No file uploaded');
    return;
  }

  const key = `${packageName}/${version}/${file.name}`;

  try {
    const tempFilePath = path.join(__dirname, file.name);
    await file.mv(tempFilePath);

    const result = await uploadS3(tempFilePath, 'team16-npm-registry', key);

    fs.unlinkSync(tempFilePath);

    res.status(200).send(`File uploaded successfully: ${result.Location}`);
  } catch (err) {
    console.error('Error during upload:', err);
    res.status(500).send('Error uploading file');
  }
});

// Helper function to validate and parse version
function isValidVersion(version: string) {
  return semver.valid(version) || semver.validRange(version);
}

interface PackageQuery {
  Name: string;
  Version: string;
}


// /packages endpoint
app.post('/packages', async (req: Request, res: Response): Promise<void> => {
  const { offset = '0' } = req.query; // Pagination offset
  const packagesQuery: PackageQuery[] = req.body; // Array of PackageQuery

  // Validate input format
  if (!packagesQuery || !Array.isArray(packagesQuery) || packagesQuery.length === 0) {
    res.status(400).send('Invalid or incomplete PackageQuery');
    return;
  }

  const offsetValue = parseInt(offset as string, 10);
  const results: any[] = [];
  const s3 = new AWS.S3({ region: 'us-east-1' }); // Use your AWS region
  const bucketName = 'team16-npm-registry'; // S3 bucket name

  for (const query of packagesQuery) {
    const { Name: nameQuery, Version: versionQuery } = query;

    if (!versionQuery || !isValidVersion(versionQuery)) {
      res.status(400).send(`Invalid version format for package: ${nameQuery}`);
      return;
    }

    const prefix = nameQuery === '*' ? '' : `${nameQuery}/`; // Handle the '*' wildcard

    try {
      // List objects in S3 under the specified prefix
      const data = await s3
        .listObjectsV2({
          Bucket: bucketName,
          Prefix: prefix,
          MaxKeys: 50, // Adjust the limit as needed
        })
        .promise();

      if (!data.Contents) {
        continue; // Skip if no contents found
      }

      // Filter versions and names based on semver and the name query
      const filteredPackages = data.Contents.filter((object) => {
        const parts = object.Key?.split('/');
        const packageName = parts[0]; // Extract package name from key
        const version = parts[1]; // Extract version from key

        const nameMatches = nameQuery === '*' || packageName.match(new RegExp(nameQuery, 'i'));
        const versionMatches = semver.satisfies(version, versionQuery);

        return nameMatches && versionMatches;
      });

      
      filteredPackages.forEach((object) => {
        const parts = object.Key?.split('/');
        const packageName = parts[0]; // Extract the package name
        const version = parts[1];    // Extract the version
        if (packageName && version) {
          results.push({
            Name: packageName,
            Version: version,
            ID: packageName, // Use the package name as the ID
          });
        }
      });
      
    } catch (err) {
      console.error(`Error querying S3 for package ${nameQuery}:`, err);
      res.status(500).send('Error querying packages from S3');
      return;
    }
  }

  if (results.length === 0) {
    res.status(404).send('No matching packages found');
    return;
  }

  // Add offset header
  res.setHeader('offset', `${offsetValue + results.length}`);
  res.status(200).json(results);
});




// Start the server
const startServer = () => {
  server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
};

// Start the server
startServer();