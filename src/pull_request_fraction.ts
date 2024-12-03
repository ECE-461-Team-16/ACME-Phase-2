import * as dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config({ path: '../.env' });
const TOKEN = process.env.GITHUB_TOKEN;

// GraphQL API endpoint
const GITHUB_API_URL = 'https://api.github.com/graphql';

// Structure for the GraphQL response
export interface RepositoryPullRequestInfo {
    data: {
        repository: {
            pullRequests: {
                totalCount: number;
            };
            approvedPullRequests: {
                totalCount: number;
            };
        };
    };
}

async function getNpmPackageGithubRepo(packageName: string): Promise<string | null> {
    try {
        const response = await axios.get(`https://registry.npmjs.org/${packageName}`);
        const packageData = response.data;
  
        if (packageData.repository && packageData.repository.url) {
            let repoUrl = packageData.repository.url;
  
            if (repoUrl.startsWith('git+ssh://git@')) {
                repoUrl = repoUrl.replace('git+ssh://git@', 'https://').replace('.git', '');
            } else if (repoUrl.startsWith('git+')) {
                repoUrl = repoUrl.replace('git+', '').replace('.git', '');
            } else {
                repoUrl = repoUrl.replace('.git', ''); // Always remove `.git` suffix
            }
  
            if (repoUrl.includes('github.com')) {
                return repoUrl;
            }
        }
  
        return null;
    } catch (error) {
        console.error(`Failed to fetch NPM package data for ${packageName}:`, error);
        return null;
    }
}

// Function to extract repository owner and name from a GitHub URL
async function extractRepoInfo(url: string): Promise<{ owner: string; name: string } | null> {
    const githubPattern = /https:\/\/github\.com\/([^/]+)\/([^/]+)/;
    const match = url.match(githubPattern);

    if (match && match[1] && match[2]) {
        return { owner: match[1], name: match[2] };
    } else if (url.startsWith("https://www.npmjs.com")) {
        const packageName = url.split("/").pop(); // Extract the package name from the URL
        if (packageName) {
            const repoUrl = await getNpmPackageGithubRepo(packageName); // Ensure this is awaited
            if (repoUrl) {
                const repoMatch = repoUrl.match(githubPattern);
                if (repoMatch && repoMatch[1] && repoMatch[2]) {
                    return { owner: repoMatch[1], name: repoMatch[2] };
                }
            }
        }
    }

    return null; // Not a valid GitHub or npm package URL
}

// Function to fetch pull request info via GraphQL
async function fetchPullRequestInfo(owner: string, name: string): Promise<RepositoryPullRequestInfo> {
    const query = `
      query {
        repository(owner: "${owner}", name: "${name}") {
          pullRequests {
            totalCount
          }
          approvedPullRequests: pullRequests(states: MERGED) {
            totalCount
          }
        }
      }`;

    try {
        const response = await axios.post(
            GITHUB_API_URL,
            { query },
            {
                headers: {
                    Authorization: `Bearer ${TOKEN}`,
                    'Content-Type': 'application/json',
                },
            }
        );

        if (response.status !== 200) {
            throw new Error(`Failed to fetch data: ${response.statusText}`);
        }

        return response.data as RepositoryPullRequestInfo;
    } catch (error) {
        console.error(`Error in GraphQL request: ${(error as Error).message}`);
        throw error;
    }
}

export async function getFractionCodeReview(url: string): Promise<number | null> {
    try {
        const repoInfo = await extractRepoInfo(url);

        if (!repoInfo) {
            console.log(`Invalid or unsupported URL: ${url}`);
            return null;
        }

        const { owner, name } = repoInfo;

        console.log(`Processing repository: ${owner}/${name}`);
        const data = await fetchPullRequestInfo(owner, name);

        const totalPRs = data.data.repository.pullRequests.totalCount;
        const approvedPRs = data.data.repository.approvedPullRequests.totalCount;

        // Calculate the fraction of approved pull requests
        const fraction = totalPRs > 0 ? approvedPRs / totalPRs : 0;
        
        return fraction;
    } catch (error) {
        console.error(`Error processing URL ${url}: ${(error as Error).message}`);
        return null;
    }
}


