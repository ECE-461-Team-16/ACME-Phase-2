import express, { Request, Response, Application } from 'express';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fileUpload from 'express-fileupload';
import { uploadS3 } from './routes/uploadS3';
import fs from 'fs';
import semver from 'semver';
import * as AWS from 'aws-sdk';
import base64 from 'base64-js';


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


app.get('/package/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const bucketName = 'team16-npm-registry';
  const s3 = new AWS.S3({ region: 'us-east-1' });

  try {
    const [name, version] = id.split('/');
    const prefix = `${name}/${version}/`;

    // List objects under the prefix
    const data = await s3
      .listObjectsV2({
        Bucket: bucketName,
        Prefix: prefix,
      })
      .promise();

    if (!data.Contents || data.Contents.length === 0) {
      res.status(404).send('Package does not exist');
      return;
    }

    // Get the first file in the directory
    const fileKey = data.Contents[0].Key;
    console.log(`Found File Key: ${fileKey}`);

    // Retrieve the file from S3
    const s3Object = await s3
      .getObject({
        Bucket: bucketName,
        Key: fileKey!,
      })
      .promise();

    if (!s3Object.Body) {
      res.status(404).send('Package does not exist');
      return;
    }

    // Convert the file content
    const fileBuffer = s3Object.Body as Buffer;
    const base64Content = fileBuffer.toString('base64');

    // Check if it's a text file or JavaScript
    const textContent = fileBuffer.toString('utf8'); // Decode as plain text

    // Prepare the response
    const metadata = { Name: name, Version: version, ID: name };
    const dataResponse = {
      Content: base64Content, // Base64 representation
      JSProgram: textContent.includes('function') || textContent.includes('console') ? textContent : 'Not applicable', // Plain text representation if applicable
    };

    res.status(200).json({ metadata, data: dataResponse });
  } catch (err) {
    console.error('Error retrieving package:', err);
    res.status(500).send('Internal server error');
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

app.delete('/reset', async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers['x-authorization'];

  // Validate Authorization Token
  if (!authHeader) {
    res.status(403).send('Authentication failed: missing AuthenticationToken.');
    return;
  }
  // Validate Authorization Token
  if (!authHeader) {
    res.status(403).send('Authentication failed: missing AuthenticationToken.');
    return;
  }

  

  // Reset SQLite Database
  // const resetDatabase = () => {
  //   return new Promise<void>((resolve, reject) => {
  //     const schemaPath = path.join(__dirname, '../db/schema.sql');
  //     const schemaSQL = fs.readFileSync(schemaPath, 'utf-8');
      
  //     db.exec(schemaSQL, (err) => {
  //       if (err) reject(`Error resetting database: ${err.message}`);
  //       else resolve();
  //     });
  //   });
  // };

  // Reset S3 Bucket
  const resetS3Bucket = async () => {
    const s3 = new AWS.S3({ region: 'us-east-1' });
    const bucketName = 'team16-npm-registry';
  
    try {
      // Step 1: List all objects in the bucket
      let objects;
      let isTruncated = true;
      let continuationToken;
      const allObjects: AWS.S3.Object[] = [];
  
      // Keep fetching objects as long as the response is truncated
      while (isTruncated) {
        objects = await s3
          .listObjectsV2({
            Bucket: bucketName,
            ContinuationToken: continuationToken,
          })
          .promise();
        allObjects.push(...(objects.Contents || []));
        isTruncated = objects.IsTruncated;
        continuationToken = objects.NextContinuationToken;
      }
  
      // Step 2: Delete all objects (including those with folder-like prefixes)
      if (allObjects.length > 0) {
        const deleteParams = {
          Bucket: bucketName,
          Delete: {
            Objects: allObjects.map((obj) => ({ Key: obj.Key! })),
          },
        };
  
        await s3.deleteObjects(deleteParams).promise();
        console.log(`Successfully deleted ${allObjects.length} objects from the bucket.`);
      } else {
        console.log("No objects found in the bucket.");
      }
    } catch (err) {
      throw new Error(`Error resetting S3 bucket: ${err.message}`);
    }
  };
  
  // Perform Reset
  try {
    //await resetDatabase();
    await resetS3Bucket();
    res.status(200).send('Registry is reset.');
  } catch (err) {
    console.error(err);
    res.status(500).send('Error resetting the registry.');
  }
});




// Start the server
const startServer = () => {
  server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
};

// Start the server
startServer();
