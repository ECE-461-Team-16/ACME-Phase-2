import axios from 'axios';
import logger from './logger';

export async function fetchMaintainerData(ownerName: string, repoName: string, token: string) {
    const perPage = 100;
    let allIssues: any[] = [];

    try {
        logger.info(`Fetching issues for repo: ${ownerName}/${repoName}`);

        const apiURL = `https://api.github.com/repos/${ownerName}/${repoName}/issues?state=open&per_page=${perPage}`;
        const response = await axios.get(apiURL, {
            headers: {
                Authorization: `token ${token}`,
            },
        });

        const issues = response.data;

        // Iterate over each issue to fetch comments
        for (const issue of issues) {
            if (issue.pull_request) continue; // Skip pull requests

            const commentsURL = issue.comments_url;
            const commentsResponse = await axios.get(commentsURL, {
                headers: {
                    Authorization: `token ${token}`,
                },
            });

            // Append comments to each issue
            issue.comments = commentsResponse.data;
            allIssues.push(issue);
        }

        return allIssues;

    } catch (error: any) {
        logger.info('Error fetching issues');
        logger.debug(`Error details: ${error.message}`);
        throw error;
    }
}

export async function calculateResponsiveMaintainer(issues: any[]) {
    let totalResponseTime = 0;
    let issuesWithResponse = 0;

    const now = new Date().getTime();

    try {
        for (const issue of issues) {
            const issueCreatedAt = new Date(issue.created_at).getTime();
            const hoursSinceCreated = (now - issueCreatedAt) / (1000 * 60 * 60); // Convert to hours
            const comments = issue.comments;

            if (comments.length > 0) {
                const firstCommentTime = new Date(comments[0].created_at).getTime();
                const responseTime = (firstCommentTime - issueCreatedAt) / (1000 * 60 * 60); // Convert to hours

                totalResponseTime += responseTime;
                issuesWithResponse++;
                //logger.debug(`Issue #${issue.number} has a response time of ${responseTime} hours`);
            } else {
                //no comment assume response time rounded to nearest 24 hours
                const assumedResponseTime = Math.ceil(hoursSinceCreated / 24) * 24;
                totalResponseTime += assumedResponseTime;
                issuesWithResponse++;
                //logger.debug(`Issue #${issue.number} has no response, assuming response time of ${assumedResponseTime} hours`);
            }
        }

        if (issuesWithResponse === 0) {
            logger.debug("No issues with response time found");
            return 0; // No issues found
        }

        const avgResponseTime = totalResponseTime / issuesWithResponse;
        logger.debug(`Average response time: ${avgResponseTime} hours`);

        const responsiveMaintainerScore = Math.max(0, 1 - (avgResponseTime / 730) * 0.25);

        return Math.min(responsiveMaintainerScore + 0.5, 1);

    } catch (error: any) {
        logger.debug(`Error calculating responsive maintainer: ${error.message}`);
        return null;
    }
}

export async function getResponsiveMaintainer(ownerName: string, repoName: string, token: string) {
    try {
        const issues = await fetchMaintainerData(ownerName, repoName, token);
        const responsiveMaintainer = await calculateResponsiveMaintainer(issues);
        logger.info(`Responsive Maintainer score for ${ownerName}/${repoName}: ${responsiveMaintainer}`);
        return responsiveMaintainer;
    } catch (error) {
        logger.info('Error fetching and calculating responsive maintainer');
        return null;
    }
}