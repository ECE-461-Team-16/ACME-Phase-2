import AWS from 'aws-sdk';
import fs from 'fs';
import path from 'path';
// import dotenv from 'dotenv';
import * as dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
// dotenv.config();


// Configure AWS SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: 'us-east-1',
});

console.log('AWS Config:', {
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});


const s3 = new AWS.S3();

/**
 * Uploads a file to S3
 * @param filePath - Path to the local file
 * @param bucketName - S3 bucket name
 * @param key - S3 object key (path in the bucket)
 * @returns Promise with the result of the S3 upload
 */
export const uploadS3 = async (
  filePath: string,
  bucketName: string,
  key: string
): Promise<AWS.S3.ManagedUpload.SendData> => {
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }

  const params = {
    Bucket: bucketName,
    Key: key,
    Body: fs.createReadStream(filePath),
  };

  try {
    const result = await s3.upload(params).promise();
    console.log('File uploaded successfully:', result);
    return result;
  } catch (err) {
    console.error('Error uploading file:', err);
    throw err; // Re-throw the error for upstream handling
  }
};
