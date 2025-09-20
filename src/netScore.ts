import {handleURL} from './handleURL'
import {calculateRampUpScore} from './RampUp_Metric'
import {getCorrectness} from './correctness'
import {getBusFactor} from './busFactor'
import {getResponsiveMaintainer} from './responsiveMaintainer'
import {getLicense} from './license'
import {getDependenciesFraction} from './goodPinningPractice'
import {getFractionCodeReview} from './pullRequest'
import logger from './logger';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { parse } from 'path'

dotenv.config();

//Main Function to Run Project
export async function RunProject(inputFilePath: string) {
    const TOKEN: string = process.env.GITHUB_TOKEN || '';
    
    const inputfile = fs.readFileSync(inputFilePath, 'utf-8');
    const lines: string[] = inputfile.split(/\r?\n/);

    let url_batch: string[] = [];
    for (const line of lines) { //for each URL in sample file
        url_batch.push(line);
        if (url_batch.length === 5) {
            await processBatch(url_batch, TOKEN);
            url_batch = [];
        }
    }

    //Handle last batch of URLs (for when the number of URLs is not a multiple of 5)
    if (url_batch.length > 0) {
        await processBatch(url_batch, TOKEN);
    }
}

//Process Batch of URLs (5 URLs at a time)
export async function processBatch(url_batch: string[], TOKEN: string) {
    let urls_processed = 0;
    for (const url of url_batch) {
        const repoinfo = await handleURL(url);
        if (!repoinfo) {
            logger.debug("Error: URL not compatible. Please enter github.com or npmjs.com URL\n");
            continue;
        }
        else {
            const owner = repoinfo['owner'];
            const repo = repoinfo['repo'];
            await getNetScore(url, owner, repo, TOKEN);
            if (getNetScore === null) {
                logger.debug(`Error performing Net Score analysis for ${owner}/${repo}`);
            }
            else {
                urls_processed++;
            }
        }
    }
    logger.debug(`Processed ${urls_processed}/${url_batch.length} URLs`);
    return urls_processed/url_batch.length;
}

//Get Net Score for a Single URL
export async function getNetScore(url:string, owner:string, repo:string, TOKEN: string) {
    logger.debug(`Calculating Net Score for ${owner}/${repo}`);

    try {
        //Initialize Timer for Latency Calculations
        const netScoreStart = Date.now();

        //Get Ramp Up Metric Score and Latency

        let rampUp = await calculateRampUpScore(owner, repo, TOKEN);

        const rampUpEnd = Date.now();
        if (rampUp === null) {
            logger.debug('Error getting Ramp Up metric score');
            rampUp = -1;
        }

        //Get Correctness Metric Score and Latency
        let correctness = await getCorrectness(owner, repo, TOKEN);
        const correctnessEnd = Date.now();
        if (correctness === null) {
            logger.debug('Error getting Correctness metric score');
            correctness = -1;
        }

        //Get Bus Factor Metric Score and Latency
        let busFactor = await getBusFactor(owner, repo, TOKEN);
        const busFactorEnd = Date.now();
        if (busFactor === null) {
            logger.debug('Error getting Bus Factor metric score');
            busFactor = -1;
        }

        //Get Responsive Maintainer Metric Score and Latency
        let responsiveMaintainer = await getResponsiveMaintainer(owner, repo, TOKEN);
        const responsiveMaintainerEnd = Date.now();
        if (responsiveMaintainer === null) {
            logger.debug('Error getting Responsive Maintainer metric score');
            responsiveMaintainer = -1;
        }

        //Get License Metric Score and Latency
        let license = await getLicense(owner, repo);
        const licenseEnd = Date.now();
        if (license === null) {
            logger.debug('Error getting License metric score');
            license = -1;
        }

        //Get Fraction of Dependencies Metric Score and Latency
        let goodPinningPractice = await getDependenciesFraction(owner, repo, TOKEN);
        const goodPinningPracticeEnd = Date.now();
        if (goodPinningPractice === null) {
            logger.debug('Error getting Fraction of Dependencies metric score');
            goodPinningPractice = -1;
        }

        //Get Fraction of Pull Request through code review Metric Score and Latency
        let pullRequest = await getFractionCodeReview(url);
        const pullRequestEnd = Date.now();
        if (pullRequest === null) {
            logger.debug('Error getting Fraction of Pull Request through code review metric score');
            pullRequest = -1;
        }

        //Net Score Calculation and Latency
        let netScore = calculateNetScore(rampUp, correctness, busFactor, responsiveMaintainer, license);
        const netScoreEnd = Date.now();
        if (netScore === null) {
            logger.debug('Error computing Net Score');
            netScore = -1;
        }
        logger.info(`Net Score for ${owner}/${repo}: ${netScore}`);

        //Latency Calculations (in seconds)
        const netScoreLatency = ((netScoreEnd - netScoreStart)/1000).toFixed(3);
        const rampUpLatency = ((rampUpEnd - netScoreStart)/1000).toFixed(3);
        const correctnessLatency = ((correctnessEnd - rampUpEnd)/1000).toFixed(3);
        const busFactorLatency = ((busFactorEnd - correctnessEnd)/1000).toFixed(3);
        const responsiveMaintainerLatency = ((responsiveMaintainerEnd - busFactorEnd)/1000).toFixed(3);
        const licenseLatency = ((licenseEnd - responsiveMaintainerEnd)/1000).toFixed(3);
        const goodPinningPracticeLatency = ((netScoreEnd - licenseEnd)/1000).toFixed(3);
        const pullRequestLatency = ((netScoreEnd - licenseEnd)/1000).toFixed(3);

        logger.info(`Net Score Latency: ${netScoreLatency} seconds`);

        //Construct Output Data
        const output_data = {
            URL: url,
            NetScore: parseFloat(netScore.toFixed(1)),
            NetScore_Latency: parseFloat(netScoreLatency),
            RampUp: parseFloat(rampUp.toFixed(1)),
            RampUp_Latency: parseFloat(rampUpLatency),
            Correctness: parseFloat(correctness.toFixed(1)),
            Correctness_Latency: parseFloat(correctnessLatency),
            BusFactor: parseFloat(busFactor.toFixed(1)),
            BusFactor_Latency: parseFloat(busFactorLatency),
            ResponsiveMaintainer: parseFloat(responsiveMaintainer.toFixed(1)),
            ResponsiveMaintainer_Latency: parseFloat(responsiveMaintainerLatency),
            License: parseFloat(license.toFixed(1)),
            License_Latency: parseFloat(licenseLatency),
            goodPinningPractice: parseFloat(goodPinningPractice.toFixed(1)),
            goodPinningPractice_Latency: parseFloat(goodPinningPracticeLatency),
            pullRequest: parseFloat(pullRequest.toFixed(1)),
            pullRequest_Latency: parseFloat(pullRequestLatency)
        }
        const json_output = JSON.stringify(output_data);
        //Print Output Data to Stdout
        console.log(json_output);
        netScore = Math.round(netScore*10)/10;
        return netScore;
    }
    catch (error) {
        logger.debug(`Error calculating Net Score for ${owner}/${repo}`);
        return null;
    }
}

//Calculate Net Score Number
export function calculateNetScore(rampUp: number, correctness: number, busFactor: number, responsiveMaintainer: number, license: number) {
    //Handle Edge Cases: Metric Scoring Error Handling (ignore metric if error)
    if (rampUp === -1 || correctness === -1 || busFactor === -1 || responsiveMaintainer === -1 || license === -1) {
        if (rampUp === -1) {
            rampUp = 0;
        }
        if (correctness === -1) {
            correctness = 0;
        }
        if (busFactor === -1) {
            busFactor = 0;
        }
        if (responsiveMaintainer === -1) {
            responsiveMaintainer = 0;
        }
        if (license === -1) {
            license = 0;
        }
    }
    //Handle Edge Cases: Validate Arguments
    if (rampUp < 0 || rampUp > 1 || correctness < 0 || correctness > 1 || busFactor < 0 || busFactor > 1 || 
        responsiveMaintainer < 0 || responsiveMaintainer > 1 || license < 0 || license > 1) {
        logger.debug(`Invalid Arguments: Arguments must be between 0 and 1`);
        return null;
    }
    //Perform Net Score Calculation
    const netScore = (0.20*rampUp + 0.30*correctness + 0.20*busFactor + 0.30*responsiveMaintainer) * license;
    return netScore;
}

export async function getAllMetrics(url: string, TOKEN: string) {
    try {
        logger.debug(`Calculating all metrics for ${url}`);

        // Extract owner and repo from the URL
        const urlParts = url.replace('https://', '').split('/');
        const owner = urlParts[1];
        const repo = urlParts[2]?.replace('.git', '');

        if (!owner || !repo) {
            throw new Error('Invalid GitHub URL: Cannot extract owner and repository name.');
        }

        // Initialize Timer for Overall Latency
        const metricsStart = Date.now();

        // Calculate individual metrics and their latencies
        const rampUpStart = Date.now();
        let rampUp = await calculateRampUpScore(owner, repo, TOKEN);
        const rampUpLatency = ((Date.now() - rampUpStart) / 1000);

        const correctnessStart = Date.now();
        let correctness = await getCorrectness(owner, repo, TOKEN);
        const correctnessLatency = ((Date.now() - correctnessStart) / 1000);

        const busFactorStart = Date.now();
        let busFactor = await getBusFactor(owner, repo, TOKEN);
        const busFactorLatency = ((Date.now() - busFactorStart) / 1000);

        const responsiveMaintainerStart = Date.now();
        let responsiveMaintainer = await getResponsiveMaintainer(owner, repo, TOKEN);
        const responsiveMaintainerLatency = ((Date.now() - responsiveMaintainerStart) / 1000);

        const licenseStart = Date.now();
        let license = await getLicense(owner, repo);
        const licenseLatency = ((Date.now() - licenseStart) / 1000);

        const goodPinningPracticeStart = Date.now();
        let goodPinningPractice = await getDependenciesFraction(owner, repo, TOKEN);
        const goodPinningPracticeLatency = ((Date.now() - goodPinningPracticeStart) / 1000);

        const pullRequestStart = Date.now();
        let pullRequest = await getFractionCodeReview(url);
        const pullRequestLatency = ((Date.now() - pullRequestStart) / 1000);

        const metricsEnd = Date.now();
        const netScoreLatency = ((metricsEnd - metricsStart) / 1000);

        // Handle null values by setting defaults
        rampUp = rampUp !== null ? rampUp : 0;
        correctness = correctness !== null ? correctness : 0;
        busFactor = busFactor !== null ? busFactor : 0;
        responsiveMaintainer = responsiveMaintainer !== null ? responsiveMaintainer : 0;
        license = license !== null ? license : 0;
        goodPinningPractice = goodPinningPractice !== null ? goodPinningPractice : 0;
        pullRequest = pullRequest !== null ? pullRequest : 0;

        // Calculate Net Score
        const netScore = calculateNetScore(
            rampUp,
            correctness,
            busFactor,
            responsiveMaintainer,
            license
        );

        // Construct metrics object in the specified format
        const metrics: Record<string, number | null> = {
            BusFactor: parseFloat(busFactor.toFixed(1)),
            BusFactorLatency: parseFloat(busFactorLatency.toFixed(3)),
            Correctness: parseFloat(correctness.toFixed(1)),
            CorrectnessLatency: parseFloat(correctnessLatency.toFixed(3)),
            RampUp: parseFloat(rampUp.toFixed(1)),
            RampUpLatency: parseFloat(rampUpLatency.toFixed(3)),
            ResponsiveMaintainer: parseFloat(responsiveMaintainer.toFixed(1)),
            ResponsiveMaintainerLatency: parseFloat(responsiveMaintainerLatency.toFixed(3)),
            LicenseScore: parseFloat(license.toFixed(1)),
            LicenseLatency: parseFloat(licenseLatency.toFixed(3)),
            GoodPinningPractice: parseFloat(goodPinningPractice.toFixed(1)),
            GoodPinningPracticeLatency: parseFloat(goodPinningPracticeLatency.toFixed(3)),
            PullRequest: parseFloat(pullRequest.toFixed(1)),
            PullRequestLatency: parseFloat(pullRequestLatency.toFixed(3)),
            NetScore: parseFloat((netScore !== null ? netScore : 0).toFixed(1)),
            NetScoreLatency: parseFloat(netScoreLatency.toFixed(3)),
        };

        logger.debug(`Metrics for ${url}: ${JSON.stringify(metrics, null, 2)}`);
        return metrics;
    } catch (error) {
        logger.error(`Error calculating all metrics for ${url}:`, error);
        return null;
    }
}

