import axios from 'axios';
import logger from './logger';

//Get Number of Contributors from a Given Repository
export async function getNumContributors(owner: string, repo: string, token: string){
  if (!owner || !repo || !token) {
    logger.error(`Error getting number of contributors: Invalid arguments`);
    return null;
  }  
  try {
    logger.debug(`Fetching contributors for ${owner}/${repo}`);
    const response = await axios.get(`https://api.github.com/repos/${owner}/${repo}/contributors`, {
      headers: {
        Authorization: `token ${token}`,
      },
      params: {
        per_page: 100,
        page: 1
      }
    });
    const numContributors = response.data.length;
    logger.debug(`Fetched ${numContributors} contributors`);
    return numContributors;
  }
  catch (error: any) {
    logger.debug(`Error fetching contributors: ${error.message}`);
    return null;
  }
}

//Calculate Bus Factor Score
export function calculateBusFactor(minAcceptableContributors: number, maxAcceptableContributors: number, numContributors: number){
    // Handle Edge Cases: Validate Arguments
    if (minAcceptableContributors < 0 || maxAcceptableContributors < 0 || numContributors < 0) {
      logger.debug(`Invalid Arguments: Arguments must be positive integers`);
      return null;
    }
    if (minAcceptableContributors >= maxAcceptableContributors) {
      logger.debug(`Invalid Arguments: minAcceptableContributors(${minAcceptableContributors}) must be less than maxAcceptableContributors(${maxAcceptableContributors})`);
      return null;
    }

    let busFactor = 0;
    busFactor = (numContributors - minAcceptableContributors) / (maxAcceptableContributors - minAcceptableContributors);
    
    // Handle Edge Case: Repo has fewer than 10 contributors
    if (busFactor < 0) {
      busFactor = 0;
    }
    // Handle Edge Case: Repo has more than 100 contributors
    if (busFactor > 1) {
      busFactor = 1;
    }

    return busFactor;
}

//Outer Function to get Bus Factor
export async function getBusFactor(owner: string, repo: string, token: string){
  if (!owner || !repo || !token) {
    logger.error(`Error getting bus factor: Invalid arguments`);
    return null;
  }
  try {
    const numContributors = await getNumContributors(owner, repo, token);
    if (numContributors === null) {
      logger.error(`Error getting bus factor: Invalid arguments`);
      return null;
    }
    const minAcceptableContributors = 10;
    const maxAcceptableContributors = 100;
    const busFactor = calculateBusFactor(minAcceptableContributors, maxAcceptableContributors, numContributors);
    if (busFactor === null) {
      logger.error(`Error getting bus factor: Invalid arguments`);
      return null;
    }
    logger.info(`Bus Factor score for ${owner}/${repo}: ${busFactor}`);
    return busFactor;
  }
  catch (error: any) {
    logger.debug(`Error getting bus factor: ${error.message}`);
    return null;
  }
}
