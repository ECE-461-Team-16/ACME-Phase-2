import * as AWS from 'aws-sdk';

// Function to calculate the size cost of a package and its dependencies
export async function calculateSizeCost(
  bucketName: string,
  packageName: string,
  version: string,
  s3: AWS.S3,
  visited: Set<string> = new Set()
): Promise<number> {
  const key = `${packageName}/${version}/`;
  if (visited.has(key)) {
    return 0; // Avoid double-counting dependencies
  }
  visited.add(key);

  try {
    const data = await s3
      .listObjectsV2({
        Bucket: bucketName,
        Prefix: key,
      })
      .promise();

    if (!data.Contents || data.Contents.length === 0) {
      return 0; // No objects found for this package
    }

    // Sum up the sizes of all objects in this package
    let totalSize = 0;
    for (const obj of data.Contents) {
      totalSize += obj.Size || 0;
    }

    // Recursively calculate the size of dependencies (if any)
    for (const dep of data.Contents) {
      const parts = dep.Key?.split('/');
      if (parts && parts.length >= 2) {
        const depName = parts[0];
        const depVersion = parts[1];
        totalSize += await calculateSizeCost(bucketName, depName, depVersion, s3, visited);
      }
    }

    return totalSize;
  } catch (err) {
    console.error(`Error calculating size for ${packageName}@${version}:`, err);
    throw err;
  }
}
