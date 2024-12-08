import axios from 'axios';
import logger from './logger';

const section_weights = {
  'table of contents': 2,
  'installation': 3,
  'examples': 3,
  'troubleshooting': 2,
  'faq': 2,
  'key features': 3,
  'usage': 3,
  'license': 1,
  'setup': 2,
  'dependencies': 2,
  'roadmap': 2,
  'testing': 3,
  'getting started': 3,
};

// Maximum possible score based on the weights
const max_score = Object.values(section_weights).reduce((a, b) => a + b, 0);

async function calculateRampUpScore(ownerName: string, repoName: string, token: string): Promise<number> {
  try {
    // Fetch the README file from the repository
    const url = `https://api.github.com/repos/${ownerName}/${repoName}/readme`;
    const headers = {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3.raw', // This header ensures the raw content of the README is returned
    };

    const response = await axios.get(url, { headers });

    // Convert README content to lowercase for case-insensitive matching
    const content = response.data.toLowerCase();

    if (!content.trim()) {
      logger.warn(`README.md content is empty for ${ownerName}/${repoName}`);
      return 0;
    }

    // Calculate the ramp-up score
    let score = 0;
    for (const [section, weight] of Object.entries(section_weights)) {
      const regex = new RegExp(`\\b${section}\\b`, 'i'); // Case-insensitive matching
      if (regex.test(content)) {
        score += weight;
        logger.info(`Matched section: "${section}" with weight ${weight}`);
      } else {
        logger.info(`Section not found: "${section}"`);
      }
    }

    const final_score = score / max_score;
    logger.info(`Ramp-up score for ${ownerName}/${repoName}: ${final_score}`);
    return final_score;
  } catch (error) {
    logger.error(`Error fetching or analyzing README.md for ${ownerName}/${repoName}: ${error}`);
    return 0; // Return 0 if any error occurs
  }
}

export { calculateRampUpScore };
