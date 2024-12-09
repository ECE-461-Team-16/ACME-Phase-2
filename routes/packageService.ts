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
  const matchedPackages = new Map<string, any>(); // Use a Map to enforce uniqueness

  requestedPackages.forEach((pkg) => {
    const { Name, Version } = pkg;

    // Filter S3 objects for the requested package name
    const matchingObjects = s3Objects.filter((obj) => {
      const keyParts = obj.Key?.split('/') || [];
      const packageName = keyParts[0];
      return Name === '*' || packageName.toLowerCase() === Name.toLowerCase();
    });

    matchingObjects.forEach((obj) => {
      const keyParts = obj.Key?.split('/') || [];
      const packageName = keyParts[0];
      const packageVersion = keyParts[1];

      if (!packageVersion) return; // Skip objects without version info

      // Check version range match
      if (Version === '*' || matchVersionRange(Version, packageVersion)) {
        const packageId = `${packageName}-${packageVersion}`; // Unique identifier

        if (!matchedPackages.has(packageId)) {
          matchedPackages.set(packageId, {
            Name: packageName,
            Version: packageVersion,
            ID: packageId.toLowerCase().replace(/[^a-z0-9]/g, ''),
          });
        }
      }
    });

    // Handle case where no matches were found for a package
    if (matchingObjects.length === 0) {
      const packageId = `${Name}-${Version}`;
      if (!matchedPackages.has(packageId)) {
        matchedPackages.set(packageId, {
          Name,
          Version: 'unknown',
          ID: Name.toLowerCase().replace(/[^a-z0-9]/g, ''),
        });
      }
    }
  });

  return Array.from(matchedPackages.values()); // Convert Map to array
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
  
