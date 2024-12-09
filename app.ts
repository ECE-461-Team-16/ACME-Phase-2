import express, { Request, Response, Application } from 'express';
import sqlite3 from 'sqlite3';
import bcrypt from 'bcryptjs';
import path from 'path';
import fileUpload from 'express-fileupload';
import fs from 'fs';
import semver from 'semver';
import * as AWS from 'aws-sdk';
import AdmZip from 'adm-zip';
import base64 from 'base64-js';
import { S3Client, ListObjectsV2Command, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

import { Readable } from 'stream';
// for package endpoint
import axios from 'axios';
import archiver from 'archiver';
import { exec } from 'child_process';
import tar from 'tar';
import fsp from 'fs/promises'; // For file system promises

// for metrics
import {getAllMetrics} from './src/netScore'
import {registerUser, authenticateUser, updateUser, deleteUser,} from './routes/userService';

import { uploadS3 } from './routes/uploadS3';
import { listS3Objects, matchPackagesWithS3Objects } from './routes/packageService';
import { calculateSizeCost } from './routes/sizeCost';


import * as dotenv from 'dotenv';
dotenv.config();
const GITHUB_TOKEN: string = process.env.GITHUB_TOKEN || '';

const app = express();
const PORT = 3000;

let server: any; // Define a variable to hold the server instance

const streamToString = (stream: any): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: any[] = [];
    stream.on('data', (chunk: any) => chunks.push(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
app.get('/package/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const bucketName = 'team16-npm-registry';

  try {
    const lastDashIndex = id.lastIndexOf('-');
    if (lastDashIndex === -1) {
      throw new Error('Invalid ID format'); // Handle case where `-` is not found
    }
    const name = id.substring(0, lastDashIndex);
    const version = id.substring(lastDashIndex + 1);
    const prefix = `${name}/${version}/`;

    // List objects under the prefix
    const listCommand = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
    });
    const data = await s3Client.send(listCommand);

    if (data.Contents && data.Contents.length > 0) {
      const metadataKey = `${name}/${version}/metadata.json`;
      const metadata = await getMetadata(bucketName, metadataKey);
      if(metadata.URL){
        res.status(200).json({
          metadata: {
            Name: name,
            Version: version,
            ID: id,
          },
          data: {
            Content: metadata.Content,
            URL: metadata.URL,
            JSProgram: metadata.JSProgram,
          },
        });
      }
      else{
        res.status(200).json({
          metadata: {
            Name: name,
            Version: version,
            ID: id,
          },
          data: {
            Content: metadata.Content,
            JSProgram: metadata.JSProgram,
          },
          
        });
      }
    } else {
      res.status(404).send('Package does not exist.');
    }
  } catch (err) {
    console.error('Error fetching package:', err);
    res.status(500).send('Internal server error');
  }
});

// Middleware setup
app.use(fileUpload());
app.use(express.json({limit: '10mb'}));
app.use(express.urlencoded({ limit: '10mb', extended: true }));


const s3Client = new S3Client({ region: 'us-east-1' });

const getMetadata = async (bucketName: string, key: string) => {
  try {
    const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
    const response = await s3Client.send(command);
    const bodyContents = await streamToString(response.Body);
    return JSON.parse(bodyContents);
  } catch (err) {
    if (err.name === 'NoSuchKey') {
      return null;
    }
    throw err;
  }
};

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
      BusFactor: null,
      BusFactorLatency: null,
      Correctness: null,
      CorrectnessLatency: null,
      RampUp: null,
      RampUpLatency: null,
      ResponsiveMaintainer: null,
      ResponsiveMaintainerLatency: null,
      LicenseScore: null,
      LicenseLatency: null,
      GoodPinningPractice: null,
      GoodPinningPracticeLatency: null,
      PullRequest: null,
      PullRequestLatency: null,
      NetScore: null,
      NetScoreLatency: null,
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
        const [npmPackageName, npmVersion] = packagePath.split('/');
        packageName = npmPackageName;
        version = npmVersion || (await getNpmPackageVersion(packageName));
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

    let id = `${packageName}-${version}`;

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

          // Read the zip file and encode in Base64
          const zipFileBuffer = await fsp.readFile(zipFilePath);
          const base64Content = zipFileBuffer.toString('base64');

          // Upload ZIP file to S3
          await uploadS3(zipFilePath, 'team16-npm-registry', `${packageName}/${version}/package.zip`);
          metrics = await getAllMetrics(URL, GITHUB_TOKEN);

          const metadataJSON = {
            Name: packageName,
            Version: version,
            ID: id, // Consistent ID format
            URL, // Include URL if present
            Metrics: metrics,
            JSProgram: JSProgram || null,
            Content: base64Content,
            
          };
    
          // Store metadata in S3
          const metadataKey = `${packageName}/${version}/metadata.json`;
          await s3Client.send(
            new PutObjectCommand({
              Bucket: 'team16-npm-registry',
              Key: metadataKey,
              Body: JSON.stringify(metadataJSON),
              ContentType: 'application/json',
            })
          );

          // Cleanup
          await fsp.rm(zipFilePath, { force: true });
          await fsp.rm(packageDir, { recursive: true, force: true });

          // Calculate Metrics

          res.status(201).json({
            metadata: {
              Name: packageName,
              Version: version,
              ID: id,
              
            },
            data: {
              Content: base64Content,
              URL: URL, // Use the provided URL
              JSProgram: JSProgram || null,
            },
          });
          console.log('Successfully processed GitHub URL:', URL);
          return;
        } else if (URL.includes('npmjs.com')) {
          // Calculate Metrics
          // metrics = await calculateAllMetrics(URL);
          //call NPMtoGithub function
          const repoUrl = await getNpmPackageGithubRepo(packageName);
          const packageDir = await cloneGitHubRepo(repoUrl); // Assuming this function exists
          const zipFilePath = path.join(__dirname, `${packageName}.zip`);
    
          // Zip the repository contents
          const output = fs.createWriteStream(zipFilePath);
          const archive = archiver('zip', { zlib: { level: 9 } });
          archive.pipe(output);
          archive.directory(packageDir, false);
          await archive.finalize();
    
          // Read the zip file and encode in Base64
          const zipFileBuffer = await fsp.readFile(zipFilePath);
          const base64Content = zipFileBuffer.toString('base64');
    
          // Upload ZIP file to S3
          const result = await uploadS3(zipFilePath, 'team16-npm-registry', `${packageName}/${version}/package.zip`);
          metrics = await getAllMetrics(repoUrl, GITHUB_TOKEN);
          const metadataJSON = {
            Name: packageName,
            Version: version,
            ID: id, // Consistent ID format
            URL, // Include URL if present
            Metrics: metrics,
            JSProgram: JSProgram || null,
            Content: base64Content,
          };
    
          // Store metadata in S3
          const metadataKey = `${packageName}/${version}/metadata.json`;
          await s3Client.send(
            new PutObjectCommand({
              Bucket: 'team16-npm-registry',
              Key: metadataKey,
              Body: JSON.stringify(metadataJSON),
              ContentType: 'application/json',
            })
          );
          await fsp.rm(zipFilePath, { force: true });
          await fsp.rm(packageDir, { recursive: true, force: true });

          
      
          res.status(201).json({
            metadata: {
              Name: packageName,
              Version: version,
              ID: id,
              // RampUpScore: metrics.RampUpScore,
              // Correctness: metrics.Correctness,
              // BusFactor: metrics.BusFactor,
              // ResponsiveMaintainer: metrics.ResponsiveMaintainer,
              // LicenseScore: metrics.LicenseScore,
              // GoodPinningPractice: metrics.GoodPinningPractice,
              // PullRequest: metrics.PullRequest
            },
            data: {
              Content: base64Content,
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
    else if (Content) {
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

        

        // Upload to S3
        await uploadS3(zipFilePath, 'team16-npm-registry', `${packageName}/${version}/package.zip`);
        // metrics = await getAllMetrics(extractedURL);
        const metadataJSON = {
          Name: packageName,
          Version: version,
          ID: id, // Consistent ID format
          Content, // Include URL if present
          JSProgram: JSProgram || null,
        };
  
        // Store metadata in S3
        const metadataKey = `${packageName}/${version}/metadata.json`;
        await s3Client.send(
          new PutObjectCommand({
            Bucket: 'team16-npm-registry',
            Key: metadataKey,
            Body: JSON.stringify(metadataJSON),
            ContentType: 'application/json',
          })
        );

        // Cleanup
        await fsp.rm(zipFilePath, { force: true });

        // Extract URL from ZIP content
        try {
          extractedURL = await extractURLFromZIP(buffer);

        // Calculate Metrics
          // metrics = await calculateAllMetrics(extractedURL);
        }
        catch (err) {
          console.error('Error extracting URL:', err);
        }

        res.status(201).json({
          metadata: {
            Name: packageName,
            Version: version,
            ID: id,
            // RampUpScore: metrics.RampUpScore,
            // Correctness: metrics.Correctness,
            // BusFactor: metrics.BusFactor,
            // ResponsiveMaintainer: metrics.ResponsiveMaintainer,
            // LicenseScore: metrics.LicenseScore,
            // GoodPinningPractice: metrics.GoodPinningPractice,
            // PullRequest: metrics.PullRequest
          },
          data: {
            Content: Content,
            //URL: extractedURL,
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


export async function getNpmPackageGithubRepo(packageName: string): Promise<string | null> {
  try {
      const response = await axios.get(`https://registry.npmjs.org/${packageName}`);
      const packageData = response.data;

      if (packageData.repository && packageData.repository.url) {
          let repoUrl = packageData.repository.url;

          if (repoUrl.startsWith('git+ssh://git@')) {
              repoUrl = repoUrl.replace('git+ssh://git@', 'https://').replace('.git', '');
          } else if (repoUrl.startsWith('git+')) {
              repoUrl = repoUrl.replace('git+', '').replace('.git', '');
          } else if (repoUrl.startsWith('git://')) {
              repoUrl = repoUrl.replace('git://', 'https://').replace('.git', '');
          } else {
              repoUrl = repoUrl.replace('.git', ''); // Always remove `.git` suffix
          }

          if (repoUrl.includes('github.com')) {
              return repoUrl;
          }
      }

      return null;
  } catch (error) {
      return null;
  }
}

app.post('/package/:id', async (req: Request, res: Response): Promise<void> => {
  try {
  const { id } = req.params;
  const { metadata, data } = req.body;
  const lastDashIndex = id.lastIndexOf('-');
    if (lastDashIndex === -1) {
      throw new Error('Invalid ID format'); // Handle case where `-` is not found
    }
        const currentVersion = id.substring(lastDashIndex + 1);

  if (!metadata || !data) {
    res.status(400).send('Missing required fields in the request body.');
    return;
  }

  const { Name, Version } = metadata;
  const { Content, URL, JSProgram } = data;

  if (!Name || !Version || (!Content && !URL)) {
    res.status(400).send('Missing required fields in the request body.');
    return;
  }

  const bucketName = 'team16-npm-registry';
  const key = `${Name}/${Version}/metadata.json`;

 

      if (!isVersionNewer(currentVersion, Version)) {
        res.status(400).send('The provided version is not newer than the current version.');
        return;
      }


    let packageDir = '';
    if (URL) {
      try {
      if (URL.includes('github.com')) {
        packageDir = await cloneGitHubRepo(URL);
        const zipFilePath = path.join(__dirname, `${Name}.zip`);
    
          // Zip the repository contents
          const output = fs.createWriteStream(zipFilePath);
          const archive = archiver('zip', { zlib: { level: 9 } });
          archive.pipe(output);
          archive.directory(packageDir, false);
          await archive.finalize();
    
          // Read the zip file and encode in Base64
          const zipFileBuffer = await fsp.readFile(zipFilePath);
          const base64Content = zipFileBuffer.toString('base64');
          
          
          // Upload ZIP file to S3
          const result = await uploadS3(zipFilePath, 'team16-npm-registry', `${Name}/${Version}/package.zip`);
          
          const metadataJSON = {
            Name: Name,
            Version: Version,
            ID: id, // Consistent ID format
            URL, // Include URL if present
            JSProgram: JSProgram || null,
            Content: base64Content,
          };
    
          // Store metadata in S3
          const metadataKey = `${Name}/${Version}/metadata.json`;
          await s3Client.send(
            new PutObjectCommand({
              Bucket: 'team16-npm-registry',
              Key: metadataKey,
              Body: JSON.stringify(metadataJSON),
              ContentType: 'application/json',
            })
          );

          // Cleanup
          await fsp.rm(zipFilePath, { force: true });
          await fsp.rm(packageDir, { recursive: true, force: true });
    
          // Respond with metadata and Base64 content
          res.status(200).send('Package updated successfully.');
          return;
        } else if (URL.includes('npmjs.com')) {
          try {
            //call NPMtoGithub function
            const repoUrl = await getNpmPackageGithubRepo(Name);
            const packageDir = await cloneGitHubRepo(repoUrl); // Assuming this function exists
            const zipFilePath = path.join(__dirname, `${Name}.zip`);
      
            // Zip the repository contents
            const output = fs.createWriteStream(zipFilePath);
            const archive = archiver('zip', { zlib: { level: 9 } });
            archive.pipe(output);
            archive.directory(packageDir, false);
            await archive.finalize();
      
            // Read the zip file and encode in Base64
            const zipFileBuffer = await fsp.readFile(zipFilePath);
            const base64Content = zipFileBuffer.toString('base64');
      
            // Upload ZIP file to S3
            const result = await uploadS3(zipFilePath, 'team16-npm-registry', `${Name}/${Version}/package.zip`);
            const metadataJSON = {
              Name: Name,
              Version: Version,
              ID: id, // Consistent ID format
              URL, // Include URL if present
              JSProgram: JSProgram || null,
              Content: base64Content,
            };
      
            // Store metadata in S3
            const metadataKey = `${Name}/${Version}/metadata.json`;
            await s3Client.send(
              new PutObjectCommand({
                Bucket: 'team16-npm-registry',
                Key: metadataKey,
                Body: JSON.stringify(metadataJSON),
                ContentType: 'application/json',
              })
            );
            // Cleanup
            await fsp.rm(zipFilePath, { force: true });
            await fsp.rm(packageDir, { recursive: true, force: true });
      
            // Respond with metadata and Base64 content
            res.status(200).send('Package updated successfully.');
            return;
          }
            
          catch (err) {
            console.error('Error handling npm package:', err);
            res.status(500).send('Error processing npm package.');
            return;
          }
        }
        else {
          res.status(400).send('Invalid URL. Only GitHub and npm URLs are supported.');
          return;
        }
      }
       catch (err) {
        console.error('Error handling URL:', err);
        res.status(500).send('Error processing URL.');
        return;
      }
      }
     else {
      let extractedURL = '';
      try {
        const buffer = Buffer.from(Content, 'base64');

        // Verify buffer is not empty
        if (buffer.length === 0) {
          res.status(400).send('Invalid Content. Empty Base64 string.');
          return;
        }

        const zipFilePath = path.join(__dirname, `${Name}.zip`);

        // Write the decoded buffer as a ZIP file
        await fsp.writeFile(zipFilePath, buffer, { encoding: 'binary' });

        // Test the file locally to ensure it is a valid ZIP
        const testBuffer = await fsp.readFile(zipFilePath);
        if (testBuffer[0] !== 0x50 || testBuffer[1] !== 0x4B) {
          throw new Error('Decoded file is not a valid ZIP.');
        }

        // Extract URL from ZIP content
        //extractedURL = await extractURLFromZIP(buffer);

        // Upload to S3
        const result = await uploadS3(zipFilePath, 'team16-npm-registry', `${Name}/${Version}/package.zip`);

        const metadataJSON = {
          Name: Name,
          Version: Version,
          ID: id, // Consistent ID format
          Content, // Include URL if present
          JSProgram: JSProgram || null,
        };
  
        // Store metadata in S3
        const metadataKey = `${Name}/${Version}/metadata.json`;
        await s3Client.send(
          new PutObjectCommand({
            Bucket: 'team16-npm-registry',
            Key: metadataKey,
            Body: JSON.stringify(metadataJSON),
            ContentType: 'application/json',
          })
        );
        // Cleanup
        await fsp.rm(zipFilePath, { force: true });

        res.status(200).send('Package updated successfully.');
      } catch (err) {
        console.error('Error handling Content:', err);
        res.status(500).send('Error processing Content upload.');
      }
      return;
    }
  } catch (err) {
    console.error('Internal server error:', err);
    res.status(500).send('Internal server error.');
  }
});

app.get('/package/:id/rate', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // Extract package name and version from the ID
    const lastDashIndex = id.lastIndexOf('-');
    if (lastDashIndex === -1) {
      throw new Error('Invalid ID format'); // Handle case where `-` is not found
    }

    const packageName = id.substring(0, lastDashIndex);
    const version = id.substring(lastDashIndex + 1);

    // S3 Key for the metadata JSON
    const metadataKey = `${packageName}/${version}/metadata.json`;

    // Fetch metadata from S3 using GetObjectCommand
    const command = new GetObjectCommand({
      Bucket: 'team16-npm-registry',
      Key: metadataKey,
    });
    const response = await s3Client.send(command);

    if (!response.Body) {
      res.status(404).send('Package metadata not found.');
      return;
    }

    // Parse metadata from the stream
    const bodyContents = await streamToString(response.Body);
    const metadataJSON = JSON.parse(bodyContents);

    // Extract Metrics and Latencies
    const metrics = metadataJSON.Metrics;
    if (!metrics) {
      res.status(404).send('Metrics data not found in package metadata.');
      return;
    }

    // Return metrics and latencies
    res.status(200).json({
      BusFactor: metrics.BusFactor,
      BusFactorLatency: metrics.BusFactorLatency,
      Correctness: metrics.Correctness,
      CorrectnessLatency: metrics.CorrectnessLatency,
      RampUp: metrics.RampUpScore,
      RampUpLatency: metrics.RampUpLatency,
      ResponsiveMaintainer: metrics.ResponsiveMaintainer,
      ResponsiveMaintainerLatency: metrics.ResponsiveMaintainerLatency,
      LicenseScore: metrics.LicenseScore,
      LicenseLatency: metrics.LicenseLatency,
      GoodPinningPractice: metrics.GoodPinningPractice,
      GoodPinningPracticeLatency: metrics.GoodPinningPracticeLatency,
      PullRequest: metrics.PullRequest,
      PullRequestLatency: metrics.PullRequestLatency,
      NetScore: metrics.NetScore,
      NetScoreLatency: metrics.NetScoreLatency,
    });
  } catch (err) {
    console.error('Error fetching package rates:', err);
    res.status(500).send('Error fetching package rates.');
  }
});


// Utility function to check if the new version is newer
const isVersionNewer = (currentVersion: string, newVersion: string): boolean => {
  const parseVersion = (v: string) => v.split('.').map(Number);
  const [cur, newV] = [parseVersion(currentVersion), parseVersion(newVersion)];

  for (let i = 0; i < cur.length; i++) {
    if (newV[i] > cur[i]) return true;
    if (newV[i] < cur[i]) return false;
  }
  return false;
};


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


app.post('/packages/byRegEx', async (req: Request, res: Response): Promise<void> => {
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
          ID: `${packageName}-${version}`, // Use the package name as the ID
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

// *************** UI ROUTES ***************

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

// import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';

export async function listUniqueS3Objects(bucketName: string): Promise<{ Key: string }[]> {
  const s3Client = new S3Client({ region: 'us-east-1' });
  let objects: { Key: string }[] = [];
  let continuationToken: string | undefined;

  do {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      ContinuationToken: continuationToken,
    });

    const data = await s3Client.send(command);
    if (data.Contents) {
      objects.push(...data.Contents.map(obj => ({ Key: obj.Key! })));
    }
    continuationToken = data.NextContinuationToken;
  } while (continuationToken);

  // Ensure unique keys
  return Array.from(new Set(objects.map(obj => obj.Key))).map(Key => ({ Key }));
}


app.get('/packages', async (req: Request, res: Response) => {
  try {
    const bucketName = 'team16-npm-registry';
    const s3Objects = await listUniqueS3Objects(bucketName);

    const packages = s3Objects
      .map(obj => {
        const [Name, Version] = obj.Key.split('/');
        if (Name && Version && !Version.endsWith('.json')) { // Exclude metadata files
          return { Name, Version };
        }
        return null;
      })
      .filter(pkg => pkg !== null); // Remove null entries

    const uniquePackages = Array.from(
      new Map(packages.map(pkg => [`${pkg.Name}-${pkg.Version}`, pkg])).values()
    );

    res.status(200).json(uniquePackages);
  } catch (err) {
    console.error('Error retrieving packages:', err);
    res.status(500).send('Internal server error.');
  }
});

app.get('/packages/:name-:version.zip', async (req: Request, res: Response) => {
  const { name, version } = req.params;
  const bucketName = 'team16-npm-registry';
  const key = `${name}/${version}/package.zip`;

  try {
    // Fetch file from S3
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: key,
    });
    const response = await s3Client.send(command);

    if (!response.Body) {
      res.status(404).send('Package not found.');
      return;
    }

    // Convert the Body to a Node.js readable stream
    const readableStream = Readable.from(response.Body as any);

    // Set the response headers for file download
    res.setHeader('Content-Disposition', `attachment; filename="${name}-${version}.zip"`);
    res.setHeader('Content-Type', 'application/zip');

    // Pipe the file to the response
    readableStream.pipe(res);
  } catch (err) {
    console.error('Error downloading package:', err);
    res.status(500).send('Error downloading package.');
  }
});

app.get('/user_preferences', (req: Request, res: Response) => {
  res.sendFile(path.join(projectRoot, 'views', 'user_preferences.html'));
});

app.post('/register', async (req: Request, res: Response) => {
  try {
    const newUser = await registerUser(req.body);
    res.status(201).json({ message: 'User registered successfully', user: newUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/sign_in', async (req: Request, res: Response) => {
  try {
    const user = await authenticateUser(req.body.username, req.body.password);
    res.status(200).json({ message: 'Signed in successfully', user });
  } catch (error) {
    res.status(401).json({ error: error.message });
  }
});

app.post('/update_user', async (req: Request, res: Response) => {
  try {
    const updatedUser = await updateUser(req.body.username, req.body.updates);
    res.status(200).json({ message: 'User updated successfully', user: updatedUser });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/delete_account', async (req: Request, res: Response) => {
  try {
    await deleteUser(req.body.username);
    res.status(200).json({ message: 'Account deleted successfully' });
  } catch (error) {
    res.status(500).json({ error: error.message });
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