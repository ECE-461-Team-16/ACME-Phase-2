import * as dotenv from 'dotenv';
import axios from "axios";
import logger from "./logger";
dotenv.config();

/**
 * Fetches dependencies from the package.json file and calculates the fraction of dependencies
 * that are pinned to a specific major+minor version.
 * 
 * @param owner - The GitHub repository owner.
 * @param repo - The GitHub repository name.
 * @param TOKEN - The GitHub personal access token.
 * @returns The fraction of dependencies pinned to at least major and minor versions.
 */
export async function getDependenciesFraction(owner: string, repo: string, TOKEN: string): Promise<number> {
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/package.json`;

    try {
        // Fetch the package.json file
        const response = await fetch(url, {
            headers: {
                'Authorization': `Bearer ${TOKEN}`,
                'Accept': 'application/vnd.github.v3.raw' // Fetch raw file content
            }
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch package.json: ${response.statusText}`);
        }

        const packageJson: { dependencies?: { [key: string]: string } } = await response.json();
        const dependencies = packageJson.dependencies || {};

        // Calculate the fraction of pinned dependencies
        if (Object.keys(dependencies).length === 0) return 1.0; // No dependencies, score is 1.0

        let pinnedCount = 0;

        Object.values(dependencies).forEach(version => {
            // Check if the version is pinned to major+minor by matching x.y.z, x.y, or x.y.x patterns
            const isPinned = /^\d+\.\d+(\.\d+)?$/.test(version); // Matches "1.0", "1.0.0", but not "^1.0.0" or "~1.0.0"
            if (isPinned) {
                pinnedCount++;
            }
        });

        return pinnedCount / Object.keys(dependencies).length;
    } catch (error) {
        logger.debug("Error processing dependencies:", (error as Error).message);
        return 0; // Return 0 on error
    }
}
