import AWS from 'aws-sdk';

// Configure S3
const s3 = new AWS.S3({
  region: 'us-east-1',
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

/**
 * Lists all objects in the S3 bucket under a specific prefix.
 * @param bucketName - Name of the S3 bucket
 * @param prefix - Prefix to filter objects (optional)
 * @returns List of objects in the bucket
 */
export const listS3Objects = async (bucketName: string, prefix: string = '') => {
  const params = {
    Bucket: bucketName,
    Prefix: prefix,
  };

  try {
    const result = await s3.listObjectsV2(params).promise();
    return result.Contents || [];
  } catch (err) {
    console.error('Error listing S3 objects:', err);
    throw err;
  }
};

/**
 * Matches requested packages with S3 objects and extracts metadata.
 * @param requestedPackages - List of packages from the request
 * @param s3Objects - List of S3 objects from the bucket
 * @returns Matched package metadata
 */
export const matchPackagesWithS3Objects = (requestedPackages: any[], s3Objects: AWS.S3.Object[]) => {
    return requestedPackages.map((pkg) => {
      const { Name, Version } = pkg;
  
      // Filter objects for the requested package
      const matchingObjects = s3Objects.filter((obj) => {
        const keyParts = obj.Key?.split('/') || [];
        const packageName = keyParts[0];
        return packageName.toLowerCase() === Name.toLowerCase();
      });
  
      if (matchingObjects.length === 0) {
        return {
          Name,
          Version: 'unknown',
          ID: Name.toLowerCase().replace(/[^a-z0-9]/g, ''),
        };
      }
  
      // Handle "unknown" version: return the latest version if available
      let selectedObject = matchingObjects[0]; // Default to the first matching object
      if (Version === 'unknown') {
        // Find the latest version (assuming versions are lexicographically sorted)
        selectedObject = matchingObjects.sort((a, b) => {
          const versionA = a.Key?.split('/')[1];
          const versionB = b.Key?.split('/')[1];
          return versionA > versionB ? -1 : 1; // Descending order
        })[0];
      } else {
        // Match specific version
        selectedObject = matchingObjects.find((obj) => {
          const packageVersion = obj.Key?.split('/')[1];
          return matchVersionRange(Version, packageVersion);
        }) || selectedObject;
      }
  
      // Extract metadata from the selected object
      const keyParts = selectedObject.Key?.split('/') || [];
      return {
        Name: keyParts[0],
        Version: keyParts[1],
        ID: keyParts[0].toLowerCase().replace(/[^a-z0-9]/g, ''),
      };
    });
  };
  
 
  /**
   * Matches a version range (e.g., ^1.2.0 or ~1.2.0) against a specific version.
   * @param range - Version range string
   * @param version - Specific version to match against
   * @returns Whether the version matches the range
   */
  const matchVersionRange = (range: string, version: string): boolean => {
    // Handle exact match
    if (range === version) {
      return true;
    }
  
    // Handle special cases (e.g., ^1.2.0, ~1.2.0, 1.2.3-2.0.0)
    // You can use a library like semver for better range handling
    if (range.startsWith('^')) {
      const baseVersion = range.slice(1);
      return version.startsWith(baseVersion.split('.')[0]); // Match major version
    }
  
    if (range.startsWith('~')) {
      const baseVersion = range.slice(1);
      return version.startsWith(baseVersion.split('.').slice(0, 2).join('.')); // Match major and minor version
    }
  
    if (range.includes('-')) {
      const [min, max] = range.split('-');
      return version >= min && version <= max;
    }
  
    return false;
  };
  
