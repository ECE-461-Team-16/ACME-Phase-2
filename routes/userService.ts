import AWS from 'aws-sdk';
import bcrypt from 'bcrypt';

AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: 'us-east-1', // Replace with your S3 bucket region
});

const s3 = new AWS.S3();
const BUCKET_NAME = 'users-phase2';

/**
 * Registers a new user.
 */
export async function registerUser(userData: {
  username: string;
  password: string;
  email: string;
  firstName?: string;
  lastName?: string;
}) {
  const { username, password, email, firstName, lastName } = userData;

  if (!username || !password || !email) {
    throw new Error('Missing required fields');
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // Create user object
  const newUser = {
    username,
    email,
    firstName,
    lastName,
    password: hashedPassword,
    createdAt: new Date().toISOString(),
  };

  // Upload to S3
  const params = {
    Bucket: BUCKET_NAME,
    Key: `${username}.json`,
    Body: JSON.stringify(newUser),
    ContentType: 'application/json',
  };

  await s3.upload(params).promise();
  return newUser;
}

/**
 * Authenticates a user by verifying their username and password.
 */
export async function authenticateUser(username: string, password: string) {
  if (!username || !password) {
    throw new Error('Missing required fields');
  }

  const params = {
    Bucket: BUCKET_NAME,
    Key: `${username}.json`,
  };

  const userFile = await s3.getObject(params).promise();
  const userData = JSON.parse(userFile.Body?.toString() || '{}');

  // Compare hashed passwords
  const match = await bcrypt.compare(password, userData.password);
  if (!match) {
    throw new Error('Invalid credentials');
  }

  return userData;
}

/**
 * Updates user data in the S3 bucket.
 */
export async function updateUser(username: string, updates: Partial<Record<string, any>>) {
  const params = {
    Bucket: BUCKET_NAME,
    Key: `${username}.json`,
  };

  const userFile = await s3.getObject(params).promise();
  const existingUserData = JSON.parse(userFile.Body?.toString() || '{}');

  // Merge updates with existing data
  const updatedUserData = { ...existingUserData, ...updates };

  // Save updated user data
  await s3.upload({
    Bucket: BUCKET_NAME,
    Key: `${username}.json`,
    Body: JSON.stringify(updatedUserData),
    ContentType: 'application/json',
  }).promise();

  return updatedUserData;
}

/**
 * Deletes a user's account from the S3 bucket.
 */
export async function deleteUser(username: string) {
  const params = {
    Bucket: BUCKET_NAME,
    Key: `${username}.json`,
  };

  await s3.deleteObject(params).promise();
}
