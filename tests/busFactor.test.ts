import { calculateBusFactor, getNumContributors, getBusFactor } from '../src/busFactor';

describe('calculateBusFactor', () => {
    it('should return null if minAcceptableContributors is negative', async () => {
        const minAcceptableContributors = -1;
        const maxAcceptableContributors = 100;
        const numContributors = 10;
        const bf_score = calculateBusFactor(minAcceptableContributors, maxAcceptableContributors, numContributors);
        expect(bf_score).toBeNull();
    });
    it('should return null if maxAcceptableContributors is negative', async () => {
        const minAcceptableContributors = 1;
        const maxAcceptableContributors = -100;
        const numContributors = 10;
        const bf_score = calculateBusFactor(minAcceptableContributors, maxAcceptableContributors, numContributors);
        expect(bf_score).toBeNull();
    });
    it('should return null if numContributors is negative', async () => {
        const minAcceptableContributors = 1;
        const maxAcceptableContributors = 100;
        const numContributors = -10;
        const bf_score = calculateBusFactor(minAcceptableContributors, maxAcceptableContributors, numContributors);
        expect(bf_score).toBeNull();
    });
    it('should return null if minAcceptableContributors >= maxAcceptableContributors', async () => {
        const minAcceptableContributors = 150;
        const maxAcceptableContributors = 100;
        const numContributors = 10;
        const bf_score = calculateBusFactor(minAcceptableContributors, maxAcceptableContributors, numContributors);
        expect(bf_score).toBeNull();
    });
    it('should return 0 if the repo has fewer than minAcceptableContributors', async () => {
        const minAcceptableContributors = 10;
        const maxAcceptableContributors = 100;
        const numContributors = 5;
        const bf_score = calculateBusFactor(minAcceptableContributors, maxAcceptableContributors, numContributors);
        expect(bf_score).toBe(0);
    });
    it('should return 1 if the repo has more than maxAcceptableContributors', async () => {
        const minAcceptableContributors = 10;
        const maxAcceptableContributors = 100;
        const numContributors = 150;
        const bf_score = calculateBusFactor(minAcceptableContributors, maxAcceptableContributors, numContributors);
        expect(bf_score).toBe(1);
    });
    it('should return a value between 0 and 1 if the repo has between minAcceptableContributors and maxAcceptableContributors', async () => {
        const minAcceptableContributors = 10;
        const maxAcceptableContributors = 100;
        const numContributors = 19;
        const bf_score = calculateBusFactor(minAcceptableContributors, maxAcceptableContributors, numContributors);
        console.log(`bf_score: ${bf_score}`);
        expect(bf_score).toBe(0.1);
    });
    it('getNumContributors should return null if inputs are invalid', async () => {
        const owner = 'invalidOwner';
        const repo = 'invalidRepo';
        const token = 'invalidToken';
        const numContributors = await getNumContributors(owner, repo, token);
        expect(numContributors).toBeNull();
    });
    // it('getNumContributors should return between 0 and 100 if inputs are valid', async () => {
    //     const owner = 'lodash';
    //     const repo = 'lodash';
    //     const token = process.env.GITHUB_TOKEN || '';
    //     const numContributors = await getNumContributors(owner, repo, token);
    //     expect(numContributors).toBe(100);
    // });
    it('getBusFactor should return null if inputs are invalid', async () => {
        const owner = 'invalidOwner';
        const repo = 'invalidRepo';
        const token = 'invalidToken';
        const busFactor = await getBusFactor(owner, repo, token);
        expect(busFactor).toBeNull();
    });
    // it('getBusFactor should return between 0 and 1 if inputs are valid', async () => {
    //     const owner = 'lodash';
    //     const repo = 'lodash';
    //     const token = process.env.GITHUB_TOKEN || '';
    //     const busFactor = await getBusFactor(owner, repo, token);
    //     expect(busFactor).toBeLessThanOrEqual(1);
    // });
});