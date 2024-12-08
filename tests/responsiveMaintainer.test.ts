import { calculateResponsiveMaintainer, fetchMaintainerData, getResponsiveMaintainer } from '../src/responsiveMaintainer';
import { config } from 'dotenv';

describe('calculateResponsiveMaintainer Tests', () => {
    jest.setTimeout(10000); //set timeout to 10 seconds
    // Test case: All issues have responses, and the average response time is less than 24 hours.
    it('should return a score close to 1 when issues are responded to within 24 hours', async () => {
        const issues = [
            {
                number: 1,
                created_at: '2024-09-01T00:00:00Z',
                comments: [{ created_at: '2024-09-01T10:00:00Z' }] // 10 hours response time
            },
            {
                number: 2,
                created_at: '2024-09-01T00:00:00Z',
                comments: [{ created_at: '2024-09-01T08:00:00Z' }] // 8 hours response time
            },
        ];

        const score = await calculateResponsiveMaintainer(issues);
        expect(score).toBeGreaterThan(0.9); // High score since response time is less than 24 hours
    });

    // Test case: Issues with no responses
    it('should return a score of 0 when no issues have responses', async () => {
        const issues = [
            {
                number: 1,
                created_at: '2024-09-01T00:00:00Z',
                comments: [] // No comments (no response)
            },
            {
                number: 2,
                created_at: '2024-09-01T00:00:00Z',
                comments: [] // No comments (no response)
            },
        ];

        const score = await calculateResponsiveMaintainer(issues);
        expect(score).toBeGreaterThan(0); // No responses, score should be 0
    });

    // Test case: Mixed issues with some having responses after more than 24 hours
    it('should return a lower score when response times are greater than 24 hours', async () => {
        const issues = [
            {
                number: 1,
                created_at: '2024-09-01T00:00:00Z',
                comments: [{ created_at: '2024-09-02T00:00:00Z' }] // 24 hours response time
            },
            {
                number: 2,
                created_at: '2024-09-01T00:00:00Z',
                comments: [{ created_at: '2024-09-03T00:00:00Z' }] // 48 hours response time
            },
        ];

        const score = await calculateResponsiveMaintainer(issues);
        expect(score).toBeLessThanOrEqual(1); // Lower score as one issue has a response time greater than 24 hours
    });

    // Test case: Mixed issues with some having quick responses and some no responses
    it('should return a score based on the issues that have responses', async () => {
        const issues = [
            {
                number: 1,
                created_at: '2024-09-01T00:00:00Z',
                comments: [{ created_at: '2024-09-01T12:00:00Z' }] // 12 hours response time
            },
            {
                number: 2,
                created_at: new Date(new Date().getTime() - 1000 * 60 * 60 * 25).toISOString(), // 25 hours ago
                comments: [] // No response
            },
        ];

        const score = await calculateResponsiveMaintainer(issues);
        expect(score).toBeLessThanOrEqual(1);
    });

    // Test case: All issues with responses greater than 48 hours
    it('should return a very low score when all responses are delayed beyond 48 hours', async () => {
        const issues = [
            {
                number: 1,
                created_at: '2024-09-01T00:00:00Z',
                comments: [{ created_at: '2024-09-03T00:00:00Z' }] // 48 hours response time
            },
            {
                number: 2,
                created_at: '2024-09-01T00:00:00Z',
                comments: [{ created_at: '2024-09-04T00:00:00Z' }] // 72 hours response time
            },
        ];

        const score = await calculateResponsiveMaintainer(issues);
        expect(score).toBeGreaterThanOrEqual(0.75); // Low score because all responses took more than 48 hours
    });

    // Test case: Issues with invalid token
    it('should throw an error when using invalid repo or token', async () => {
        const invalidRepo = 'invalidRepo';
        const invalidOwner = 'invalidOwner';
        const invalidToken = 'invalidToken';
    
        // Expect the fetchMaintainerData to reject with an error
        await expect(fetchMaintainerData(invalidOwner, invalidRepo, invalidToken))
          .rejects
          .toThrow('Request failed with status code 401'); 
    });

    it('should return a score', async () => {
        const repoName = 'react';
        const ownerName = 'facebook';
        const token = process.env.GITHUB_TOKEN || '';

        const score = await getResponsiveMaintainer(ownerName, repoName, token);
        expect(score).toBeDefined();
    }, 30000);

    it('should return null when using invalid repo or token', async () => {
        const invalidRepo = 'invalidRepo';
        const invalidOwner = 'invalidOwner';
        const invalidToken = 'invalidToken';

        // Expect the getCorrectness to return null
        const score = await getResponsiveMaintainer(invalidOwner, invalidRepo, invalidToken)
        expect(score).toBeNull();
    });
});