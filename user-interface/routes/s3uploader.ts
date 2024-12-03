import AWS from 'aws-sdk';
import fs from 'fs';

AWS.config.update({
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

// Enable detailed debugging logs
AWS.config.logger = console;

const s3 = new AWS.S3();

export const uploadToS3 = async (
  bucketName: string,
  fileKey: string,
  filePath: string
): Promise<AWS.S3.ManagedUpload.SendData> => {
  const fileStream = fs.createReadStream(filePath);

  const params = {
    Bucket: bucketName,
    Key: fileKey,
    Body: fileStream,
  };

  console.log('Uploading to S3 with params:', params);

  return s3.upload(params).promise();
};
