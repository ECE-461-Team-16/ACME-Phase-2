import * as dotenv from 'dotenv';
import logger from "./logger";
dotenv.config();

async function fetchDependencies(owner: string, repo: string, TOKEN: string): Promise<{ [key: string]: string }> {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/package.json`;

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        Accept: 'application/vnd.github.v3.raw', // Fetch raw file content
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch package.json: ${response.statusText}`);
    }

    const packageJson: { dependencies?: { [key: string]: string } } = await response.json();
    return packageJson.dependencies || {};
  } catch (error) {
    logger.debug('Error fetching dependencies:', error);
    throw error;
  }
}

async function calculateCost(owner: string, repo: string, TOKEN: string): Promise<number> {
  const dependencies = await fetchDependencies(owner, repo, TOKEN);

  // Assign random costs to each dependency (this should be replaced with real cost data logic)
  const baseCost = Math.random() * 50; // Base cost of the main package
  let totalCost = baseCost;

  for (const [dep, version] of Object.entries(dependencies)) {
    //console.log(`Calculating cost for dependency ${dep}@${version}`);
    const depOwner = dep.split('/')[0] || owner; // Adjust logic if dependencies follow a specific pattern
    const depRepo = dep.split('/')[1] || dep;

    try {
      totalCost += await calculateCost(depOwner, depRepo, TOKEN); // Recursive calculation
    } catch (error) {
        logger.debug(`Failed to fetch cost for dependency ${dep}@${version}:`, error);
    }
  }

  return totalCost;
}

export async function getCost(owner: string, repo: string, TOKEN: string): Promise<number> {
  try {
    const totalCost = await calculateCost(owner, repo, TOKEN);
    return totalCost;
  } catch (error) {
    logger.debug('Error calculating total cost:', error);
    throw error;
  }
}

