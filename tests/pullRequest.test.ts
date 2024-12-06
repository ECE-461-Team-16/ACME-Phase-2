import { getFractionCodeReview, extractRepoInfo, getNpmPackageGithubRepo } from '../src/pullRequest';
import logger from '../src/logger';

describe('Pull Request Fraction Test', () => {
    jest.setTimeout(360000); // Set timeout to 6 minutes

    // it('getFractionCodeReview: Should return fraction for a valid GitHub repo', async () => {
    //     const url = "https://github.com/lodash/lodash";
    //     const fraction = await getFractionCodeReview(url);
    //     logger.info(`Fraction of approved PRs for ${url}: ${fraction}`);
    //     expect(fraction).toBeGreaterThanOrEqual(0);
    //     expect(fraction).toBeLessThanOrEqual(1);
    // });

    // it('getFractionCodeReview: Should return fraction for an npm package URL', async () => {
    //     const url = "https://www.npmjs.com/package/cloudinary";
    //     const fraction = await getFractionCodeReview(url);
    //     logger.info(`Fraction of approved PRs for ${url}: ${fraction}`);
    //     expect(fraction).toBeGreaterThanOrEqual(0);
    //     expect(fraction).toBeLessThanOrEqual(1);
    // });

    it('getFractionCodeReview: Should return null for invalid URL', async () => {
        const url = "https://example.com/invalid-repo";
        const fraction = await getFractionCodeReview(url);
        logger.info(`Fraction of approved PRs for ${url}: ${fraction}`);
        expect(fraction).toBeNull();
    });
});
