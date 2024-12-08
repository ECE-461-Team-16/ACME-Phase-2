import { calculateNetScore, processBatch, getNetScore, RunProject } from '../src/netScore';
import * as fs from 'fs';

describe('calculateNetScore', () => {
    it('should return null if any of the inputs are not between 0 and 1 and not -1', async () => {
        const rampUp = 0.5;
        const correctness = 0.5;
        const busFactor = -4;
        const responsiveMaintainer = 0.5;
        const license = 0;
        const netScore = calculateNetScore(rampUp, correctness, busFactor, responsiveMaintainer, license);
        expect(netScore).toBeNull();
    });

    it('should return a value between 0 and 1 if license is 1', async () => {
        const rampUp = 0.5;
        const correctness = 0.5;
        const busFactor = 0.5;
        const responsiveMaintainer = 0.5;
        const license = 1;
        const netScore = calculateNetScore(rampUp, correctness, busFactor, responsiveMaintainer, license);
        expect(netScore).toBe(0.5);
    });

    it('should ignore a metric if it is -1', async () => {
        const rampUp = 0.5;
        const correctness = 0.5;
        const busFactor = -1;
        const responsiveMaintainer = 0.5;
        const license = 1;
        const netScore = calculateNetScore(rampUp, correctness, busFactor, responsiveMaintainer, license);
        expect(netScore).toBe(0.4);
    });

    it('should return 0 if license is 0', async () => {
        const rampUp = 0.5;
        const correctness = 0.5;
        const busFactor = 0.5;
        const responsiveMaintainer = 0.5;
        const license = 0;
        const netScore = calculateNetScore(rampUp, correctness, busFactor, responsiveMaintainer, license);
        expect(netScore).toBe(0);
    });

    it('should return score if inputs are valid', async () => {
        const owner = 'lodash';
        const repo = 'lodash';
        const token = process.env.GITHUB_TOKEN || '';
        const url = 'https://github.com/lodash/lodash';
        const netScore = await getNetScore(url, owner, repo, token);
        expect(netScore).toBeLessThanOrEqual(0.6);
    }, 30000);

    it('should return 0 if none of the URLs in the batch are valid', async () => {
        const token = 'invalidToken';
        const url_batch = ['invalidUrl1', 'invalidUrl2', 'invalidUrl3', 'invalidUrl4', 'invalidUrl5'];
        const numURLprocessed = await processBatch(url_batch, token);
        expect(numURLprocessed).toBe(0);
    });

    // this test cases takes a minute I'm sorry
    it('should run without throwing an error', async () => {
        await expect(RunProject('Sample Url File.txt')).resolves.not.toThrow();
    }, 120000);
});
