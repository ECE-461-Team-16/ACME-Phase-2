import * as dotenv from 'dotenv';
import axios from 'axios';

// Load environment variables
dotenv.config({ path: '../.env' });
const TOKEN = process.env.GITHUB_TOKEN;

// Validate token
if (!TOKEN) {
    console.error('GitHub token is missing. Please check your .env file.');
    process.exit(1);
}
console.log(`Loaded GitHub Token: ${TOKEN ? 'Yes' : 'No'}`);

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

// Function to extract repository owner and name from a GitHub URL
function extractRepoInfo(url: string): { owner: string; name: string } | null {
    const githubPattern = /https:\/\/github\.com\/([^/]+)\/([^/]+)/;
    const match = url.match(githubPattern);

    if (match && match[1] && match[2]) {
        return { owner: match[1], name: match[2] };
    }

    return null; // Not a valid GitHub repository URL
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

// Main function to process multiple URLs and print results
(async () => {
    const urls = [
        'https://github.com/cloudinary/cloudinary_npm',
        'https://github.com/nullivex/nodist',
        'https://github.com/lodash/lodash',
    ];

    for (const url of urls) {
        const repoInfo = extractRepoInfo(url);

        if (!repoInfo) {
            console.log(`Invalid or unsupported URL: ${url}`);
            continue;
        }

        const { owner, name } = repoInfo;

        try {
            console.log(`Processing repository: ${owner}/${name}`);
            const data = await fetchPullRequestInfo(owner, name);

            const totalPRs = data.data.repository.pullRequests.totalCount;
            const approvedPRs = data.data.repository.approvedPullRequests.totalCount;
            const fraction = totalPRs > 0 ? approvedPRs / totalPRs : 0;

            console.log(`Repository: ${owner}/${name}`);
            console.log(`Total Pull Requests: ${totalPRs}`);
            console.log(`Approved Pull Requests: ${approvedPRs}`);
            console.log(`Approved PR Fraction: ${fraction.toFixed(2)}`);
            console.log('-----------------------------');
        } catch (error) {
            console.error(`Error processing ${owner}/${name}: ${(error as Error).message}`);
        }
    }
})();
