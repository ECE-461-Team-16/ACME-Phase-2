import express, { Request, Response, Application } from 'express';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fileUpload from 'express-fileupload';
import { uploadS3 } from './routes/uploadS3';
import { listS3Objects, matchPackagesWithS3Objects } from './routes/packageService';
import { calculateSizeCost } from './routes/sizeCost';
import fs from 'fs';
import semver from 'semver';
import * as AWS from 'aws-sdk';
import AdmZip from 'adm-zip';
import base64 from 'base64-js';

// for package endpoint
import axios from 'axios';
import archiver from 'archiver';
import { exec } from 'child_process';
import tar from 'tar';
import fsp from 'fs/promises'; // For file system promises

// for metrics
import {handleURL} from './src/handleURL'
import {calculateRampUpScore} from './src/RampUp_Metric'
import {getCorrectness} from './src/correctness'
import {getBusFactor} from './src/busFactor'
import {getResponsiveMaintainer} from './src/responsiveMaintainer'
import {getLicense} from './src/license'
import {getDependenciesFraction} from './src/goodPinningPractice'
import {getFractionCodeReview, getNpmPackageGithubRepo} from './src/pullRequest'

import * as dotenv from 'dotenv';
dotenv.config();
const GITHUB_TOKEN: string = process.env.GITHUB_TOKEN || '';

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
    const textContent = fileBuffer.toString('utf-8'); // Use if it's a text file like .js or .cpp

    // Prepare the response
    const metadata = { Name: name, Version: version, ID: name };
    const dataResponse = {
      Content: base64Content, // Base64 representation
      JSProgram: textContent, // Plain text representation
      debloat: false // Example static value; adjust logic if required
    };

    res.status(200).json({ metadata, data: dataResponse });
  } catch (err) {
    console.error('Error retrieving package:', err);
    res.status(500).send('Internal server error');
  }
});



// Middleware setup
app.use(fileUpload());
app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({ limit: '10mb', extended: true }));

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

// Calculate the size cost of a package
app.get('/package/size/:name/:version', async (req: Request, res: Response) => {
  const { name, version } = req.params;
  const bucketName = 'team16-npm-registry';
  const s3 = new AWS.S3({ region: 'us-east-1' });

  try {
    const totalSize = await calculateSizeCost(bucketName, name, version, s3);
    res.status(200).json({ packageName: name, version, size: totalSize });
  } catch (err) {
    res.status(500).send('Error calculating size cost');
  }
});

// Packages endpoint
app.post('/packages', async (req: Request, res: Response) => {
  try {
    const requestedPackages = req.body;

    if (!Array.isArray(requestedPackages)) {
      res.status(400).send('Invalid request format. Expected an array of packages.');
      return;
    }

    const bucketName = 'team16-npm-registry';
    const s3Objects = await listS3Objects(bucketName);

    console.log('S3 Objects:', s3Objects.map((obj) => obj.Key)); // Debug log

    const packageMetadata = matchPackagesWithS3Objects(requestedPackages, s3Objects);

    if (packageMetadata.length > 100) {
      res.status(413).send('Too many packages returned');
      return;
    }

    res.status(200).json(packageMetadata);
  } catch (err) {
    console.error('Error retrieving packages:', err);
    res.status(500).send('Internal server error.');
  }
});


// Package Endpoint
async function fetchNpmPackage(packageName: string, version: string): Promise<string> {
  const npmUrl = `https://registry.npmjs.org/${packageName}`;
  const response = await axios.get(npmUrl);
  const tarballUrl = response.data.versions[version].dist.tarball;

  // Download the tarball
  const tarballPath = path.join(__dirname, `${packageName}-${version}.tgz`);
  const writer = fs.createWriteStream(tarballPath);
  const tarballResponse = await axios.get(tarballUrl, { responseType: 'stream' });
  tarballResponse.data.pipe(writer);

  await new Promise((resolve, reject) => {
    writer.on('finish', resolve);
    writer.on('error', reject);
  });

  // Extract the tarball
  const extractDir = path.join(__dirname, `${packageName}-${version}`);
  await tar.x({ file: tarballPath, cwd: extractDir });

  return extractDir;
}


async function cloneGitHubRepo(repoUrl: string): Promise<string> {
  const repoName = repoUrl.split('/').pop()?.replace('.git', '') || 'repo';
  const cloneDir = path.join(__dirname, repoName);

  await new Promise((resolve, reject) => {
    exec(`git clone ${repoUrl} ${cloneDir}`, (error) => {
      if (error) reject(error);
      else resolve(cloneDir);
    });
  });

  return cloneDir;
}

async function cleanupFiles() {
  try {
    // Example usage
    await fsp.rm('/path/to/directory', { recursive: true, force: true });
  } catch (err) {
    console.error('Error during cleanup:', err);
  }
}

// Fetch version from npm registry
const getNpmPackageVersion = async (packageName: string): Promise<string> => {
  const npmRegistryUrl = `https://registry.npmjs.org/${packageName}`;

  try {
    const response = await axios.get(npmRegistryUrl);
    const latestVersion = response.data['dist-tags']?.latest;

    if (!latestVersion) {
      throw new Error(`Unable to find latest version for package: ${packageName}`);
    }

    return latestVersion;
  } catch (error) {
    console.error(`Error fetching NPM package metadata: ${error.message}`);
    throw new Error('Failed to fetch package version from NPM registry.');
  }
};

const getGitHubLatestRelease = async (owner: string, repo: string): Promise<string> => {
  const githubApiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

  try {
    const response = await axios.get(githubApiUrl, {
      headers: { 'Accept': 'application/vnd.github.v3+json' },
    });
    return response.data.tag_name; // Return the release tag (e.g., "v1.0.0")
  } catch (error) {
    if (error.response?.status === 404) {
      console.warn(`No releases found for ${owner}/${repo}. Defaulting to '1.0.0'.`);
      return '1.0.0'; // Default version if no releases are found
    } else {
      console.error(`Error fetching GitHub release: ${error.message}`);
      throw new Error('Failed to fetch release version from GitHub.');
    }
  }
};

// POST Package endpoint
import unzipper from 'unzipper'; // Install with `npm install unzipper`

// Function to parse URL from ZIP content
async function extractURLFromZIP(buffer: Buffer): Promise<string> {
  try {
    const directory = await unzipper.Open.buffer(buffer);
    const file = directory.files.find((file) => file.path === 'package.json'); // Look for package.json

    if (file) {
      const content = await file.buffer(); // Read file content
      const parsed = JSON.parse(content.toString()); // Parse JSON
      return parsed.repository?.url || ''; // Return repository URL if available
    }
  } catch (err) {
    console.error('Error extracting URL from ZIP:', err);
  }
  return ''; // Return empty string if URL is not found
}

app.post('/package', async (req: Request, res: Response) => {
  try {
    const { Name, URL, JSProgram, Content } = req.body;

    let packageName = Name;
    let version = '1.0.0'; // Default version
    let metrics: Record<string, number | null> = {
      RampUpScore: null,
      Correctness: null,
      BusFactor: null,
      ResponsiveMaintainer: null,
      LicenseScore: null,
      GoodPinningPractice: null,
      PullRequest: null,
    };

    const calculateAllMetrics = async (url: string) => {
    // Extract owner and repo from the URL
    let GitHubUrl;
    if(url.includes('www.npmjs')) {
      GitHubUrl = await getNpmPackageGithubRepo(url);
    }
    else {
      GitHubUrl = url;
    }
    const urlParts = GitHubUrl.replace('https://', '').split('/');
    const owner = urlParts[1];
    const repo = urlParts[2]?.replace('.git', '');

    if (!owner || !repo) {
      throw new Error('Invalid GitHub URL: Cannot extract owner and repository name.');
    }

    console.log(`Calculating metrics for owner: ${owner}, repo: ${repo}`);

    const metrics = {
      RampUpScore: await calculateRampUpScore(owner, repo, GITHUB_TOKEN),
      Correctness: await getCorrectness(owner, repo, GITHUB_TOKEN),
      BusFactor: await getBusFactor(owner, repo, GITHUB_TOKEN),
      ResponsiveMaintainer: await getResponsiveMaintainer(owner, repo, GITHUB_TOKEN),
      LicenseScore: await getLicense(owner, repo),
      GoodPinningPractice: await getDependenciesFraction(owner, repo, GITHUB_TOKEN),
      PullRequest: await getFractionCodeReview(GitHubUrl),
    };

    // Check if any metric is null
    for (const [key, value] of Object.entries(metrics)) {
      if (value === null) {
        throw new Error(`Metric calculation failed: ${key} is null.`);
      }
    }

    return metrics;
  };


    // Extract Name and Version from URL if not provided
    if (!packageName && URL) {
      if (URL.includes('github.com')) {
        const repoPath = URL.replace('https://github.com/', '').split('/');
        if (repoPath.length >= 2) {
          const owner = repoPath[0];
          const repo = repoPath[1].replace('.git', '');
          packageName = repo;
      
          // Fetch the latest release from GitHub
          try {
            version = await getGitHubLatestRelease(owner, repo);
          } catch (err) {
            res.status(500).send(`Failed to fetch release version for GitHub repository: ${owner}/${repo}`);
            return;
          }
        } else {
          res.status(400).send('Invalid GitHub URL format.');
          return;
        }
      } else if (URL.includes('npmjs.com')) {
        const packagePath = URL.replace('https://www.npmjs.com/package/', '');
        const [npmPackageName] = packagePath.split('/');

        packageName = npmPackageName;

        // Fetch the latest version from NPM registry
        try {
          version = await getNpmPackageVersion(packageName);
        } catch (err) {
          res.status(500).send(`Failed to fetch version for NPM package: ${packageName}`);
          return;
        }
      } else {
        res.status(400).send('Invalid URL. Only GitHub or npm URLs are supported.');
        return;
      }
    }

    // Validate Name
    if (!packageName || typeof packageName !== 'string' || /[^a-zA-Z0-9\-]/.test(packageName)) {
      res.status(400).send('Invalid or missing Name. Only alphanumeric characters or hyphens are allowed.');
      return;
    }

    if (packageName === '*') {
      res.status(400).send('The name "*" is reserved.');
      return;
    }

    // Handle URL-based processing
    if (URL) {
      try {
        if (URL.includes('github.com')) {
          const packageDir = await cloneGitHubRepo(URL); // Assuming this function exists
          const zipFilePath = path.join(__dirname, `${packageName}.zip`);

          // Zip the repository contents
          const output = fs.createWriteStream(zipFilePath);
          const archive = archiver('zip', { zlib: { level: 9 } });
          archive.pipe(output);
          archive.directory(packageDir, false);
          await archive.finalize();

          // Upload ZIP file to S3
          await uploadS3(zipFilePath, 'team16-npm-registry', `${packageName}/${version}/package.zip`);

          // Cleanup
          await fsp.rm(zipFilePath, { force: true });
          await fsp.rm(packageDir, { recursive: true, force: true });

          // Calculate Metrics
          metrics = await calculateAllMetrics(URL);

          res.status(201).json({
            metadata: {
              Name: packageName,
              Version: version,
              ID: packageName.toLowerCase(),
              RampUpScore: metrics.RampUpScore,
              Correctness: metrics.Correctness,
              BusFactor: metrics.BusFactor,
              ResponsiveMaintainer: metrics.ResponsiveMaintainer,
              LicenseScore: metrics.LicenseScore,
              GoodPinningPractice: metrics.GoodPinningPractice,
              PullRequest: metrics.PullRequest
            },
            data: {
              Content: null,
              URL: URL, // Use the provided URL
              JSProgram: JSProgram || null,
            },
          });
          console.log('Successfully processed GitHub URL:', URL);
          return;
        } else if (URL.includes('npmjs.com')) {
          // Calculate Metrics
          // metrics = await calculateAllMetrics(URL);

          res.status(201).json({
            metadata: {
              Name: packageName,
              Version: version,
              ID: packageName.toLowerCase(),
              // RampUpScore: metrics.RampUpScore,
              // Correctness: metrics.Correctness,
              // BusFactor: metrics.BusFactor,
              // ResponsiveMaintainer: metrics.ResponsiveMaintainer,
              // LicenseScore: metrics.LicenseScore,
              // GoodPinningPractice: metrics.GoodPinningPractice,
              // PullRequest: metrics.PullRequest
            },
            data: {
              Content: null,
              URL: URL,
              JSProgram: JSProgram || null,
            },
          });
          console.log('Successfully processed npmjs URL:', URL);
          return;
        }
      } catch (err) {
        console.error('Error handling URL:', err);
        res.status(500).send('Error processing URL.');
        return;
      }
    }

    // Handle Content-based processing
    if (Content) {
      let extractedURL = '';
      try {
        const buffer = Buffer.from(Content, 'base64');

        // Verify buffer is not empty
        if (buffer.length === 0) {
          res.status(400).send('Invalid Content. Empty Base64 string.');
          return;
        }

        const zipFilePath = path.join(__dirname, `${packageName}.zip`);

        // Write the decoded buffer as a ZIP file
        await fsp.writeFile(zipFilePath, buffer, { encoding: 'binary' });

        // Test the file locally to ensure it is a valid ZIP
        const testBuffer = await fsp.readFile(zipFilePath);
        if (testBuffer[0] !== 0x50 || testBuffer[1] !== 0x4B) {
          throw new Error('Decoded file is not a valid ZIP.');
        }

        // Extract URL from ZIP content
        extractedURL = await extractURLFromZIP(buffer);

        // Upload to S3
        await uploadS3(zipFilePath, 'team16-npm-registry', `${packageName}/${version}/package.zip`);

        // Cleanup
        await fsp.rm(zipFilePath, { force: true });

        // Calculate Metrics
        metrics = await calculateAllMetrics(extractedURL);

        res.status(201).json({
          metadata: {
            Name: packageName,
            Version: version,
            ID: packageName.toLowerCase(),
            RampUpScore: metrics.RampUpScore,
            Correctness: metrics.Correctness,
            BusFactor: metrics.BusFactor,
            ResponsiveMaintainer: metrics.ResponsiveMaintainer,
            LicenseScore: metrics.LicenseScore,
            GoodPinningPractice: metrics.GoodPinningPractice,
            PullRequest: metrics.PullRequest
          },
          data: {
            Content: Content,
            URL: extractedURL,
            JSProgram: JSProgram || null,
          },
        });
        console.log('Successfully processed Content upload:', packageName);
      } catch (err) {
        console.error('Error handling Content:', err);
        res.status(500).send('Error processing Content upload.');
      }
      return;
    }

    res.status(400).send('Either Content or URL is required.');
  } catch (err) {
    console.error('Internal server error:', err);
    res.status(500).send('Internal server error.');
  }
});


// app.post('/package', async (req: Request, res: Response): Promise<void> => {
//   try {
//     const { Content, JSProgram, URL, debloat = false, Name } = req.body;

//     if (!Name) {
//       res.status(400).send('Missing required field: Name');
//       return;
//     }

//     let fileContent = '';
//     let fetchedFromURL = false;

//     if (Content) {
//       fileContent = Content;
//     } else if (URL) {
//       try {
//         const response = await axios.get(URL);
//         fileContent = response.data;
//         fetchedFromURL = true;
//       } catch (err) {
//         console.error('Error fetching URL:', err);
//         res.status(400).send('Invalid or inaccessible URL');
//         return;
//       }
//     } else if (JSProgram) {
//       fileContent = debloat
//         ? JSProgram.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '').trim()
//         : JSProgram;
//     } else {
//       res.status(400).send('Missing required field: Content, JSProgram, or URL');
//       return;
//     }

//     const zippedContent = await zipContent(fileContent, Name);
//     const tempFilePath = path.join(__dirname, `${Name}.zip`);
//     fs.writeFileSync(tempFilePath, zippedContent);

//     const bucketName = 'team16-npm-registry';
//     const key = `${Name}/1.0.0/package.zip`;

//     try {
//       const result = await uploadS3(tempFilePath, bucketName, key);
//       fs.unlinkSync(tempFilePath);

//       res.status(201).json({
//         metadata: { Name, Version: '1.0.0', ID: Name },
//         data: {
//           Content: fetchedFromURL ? null : 'Uploaded',
//           URL: URL || null,
//           JSProgram: JSProgram ? 'Processed' : null,
//           Location: result.Location,
//         },
//       });
//     } catch (err) {
//       console.error('Upload error:', err);
//       fs.unlinkSync(tempFilePath);
//       res.status(500).send('Error uploading to S3');
//     }
//   } catch (err) {
//     console.error('Error:', err);
//     res.status(500).send('Internal server error');
//   }
// });


app.delete('/reset', async (req: Request, res: Response): Promise<void> => {
  const authHeader = req.headers['x-authorization'];

  // Validate Authorization Token
  // if (!authHeader) {
  //   res.status(403).send('Authentication failed: missing AuthenticationToken.');
  //   return;
  // }


  

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


// GET /tracks endpoint
app.get('/tracks', (req: Request, res: Response) => {
  try {
    const plannedTracks = [
    ];

    res.status(200).json({ plannedTracks });
  } catch (error) {
    console.error("The system encountered an error while retrieving the student's track information", error);
    res.status(500).send('Internal server error');
  }
});


app.post('/package/byRegEx', async (req: Request, res: Response): Promise<void> => {
  const { RegEx } = req.body; // Regular expression from the request body

  // Validate the RegEx field
  if (!RegEx || typeof RegEx !== 'string') {
    res.status(400).send('Invalid or missing RegEx');
    return;
  }

  const results: any[] = [];
  const s3 = new AWS.S3({ region: 'us-east-1' }); // AWS S3 client
  const bucketName = 'team16-npm-registry'; // S3 bucket name

  try {
    // List objects in S3 (you can adjust MaxKeys as needed)
    const data = await s3
      .listObjectsV2({
        Bucket: bucketName,
      })
      .promise();

    if (!data.Contents) {
      res.status(404).send('No packages found');
      return;
    }

    // Use Promise.all to handle async filtering properly
    const filteredPackages = await Promise.all(
      data.Contents.map(async (object) => {
        const parts = object.Key?.split('/');
        const packageName = parts[0]; // Extract package name from key
        const version = parts[1]; // Extract version from key

        // Check if the package name matches the provided RegEx
        const nameMatches = new RegExp(RegEx, 'i').test(packageName);
        console.log('Name Matches:', packageName);

        // Check README content (if applicable)
        const readmeMatches = await checkReadmeForRegex(object.Key, RegEx);
        console.log('Readme Matches:', packageName);

        // Return the package if it matches either name or readme
        return nameMatches || readmeMatches ? {
          Version: version,
          Name: packageName,
          ID: packageName, // Use the package name as the ID
        } : null;
      })
    );

    // Filter out any null results
    const finalResults = filteredPackages.filter((result) => result !== null);

    // Handle case where no matching packages are found
    if (finalResults.length === 0) {
      res.status(404).send('No matching packages found');
      return;
    }

    // Return the results
    res.status(200).json(finalResults);

  } catch (err) {
    console.error('Error querying S3:', err);
    res.status(500).send('Error querying packages from S3');
  }
});


// Helper function to check if README.md matches the provided regex
async function checkReadmeForRegex(fileKey: string, regex: string): Promise<boolean> {
  const s3 = new AWS.S3({ region: 'us-east-1' });

  // Check if the fileKey points to a package zip file and contains README.md
  if (fileKey.endsWith('.zip')) {
    try {
      // Fetch the zip file from S3
      const fileData = await s3.getObject({
        Bucket: 'team16-npm-registry',
        Key: fileKey,
      }).promise();

      const zip = new AdmZip(fileData.Body as Buffer);

      // Look for a README.md file inside the zip
      const readmeFile = zip.getEntries().find((entry) =>
        entry.entryName.toLowerCase().includes('readme.md')
      );

      if (readmeFile) {
        const readmeContent = readmeFile.getData().toString('utf8');
        return new RegExp(regex, 'i').test(readmeContent);
      }

      return false;
    } catch (err) {
      console.error('Error processing zip file:', err);
      return false;
    }
  }

  return false;
}

// Start the server
const startServer = () => {
  server = app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
};

// Start the server
startServer();