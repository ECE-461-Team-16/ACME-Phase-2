import { calculateRampUpScore } from '../src/RampUp_Metric';
import axios from 'axios';

jest.mock('axios'); // Mock axios for API calls

describe('calculateRampUpScore', () => {
  const mockToken = 'mockToken';
  const ownerName = 'mockOwner';
  const repoName = 'mockRepo';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should calculate a perfect score for a README with all expected sections', async () => {
    const readmeContent = `
      # Table of Contents
      ## Installation
      ## Examples
      ## Troubleshooting
      ## FAQ
      ## Key Features
      ## Usage
      ## License
      ## Setup
      ## Dependencies
      ## Roadmap
      ## Testing
      ## Getting Started
    `;
    (axios.get as jest.Mock).mockResolvedValue({ data: readmeContent });

    const score = await calculateRampUpScore(ownerName, repoName, mockToken);
    expect(score).toBeCloseTo(1, 2); // Expect perfect score normalized to 1
  });

  it('should calculate a partial score for a README with some sections', async () => {
    const readmeContent = `
      ## Installation
      ## Usage
      ## Testing
    `;
    (axios.get as jest.Mock).mockResolvedValue({ data: readmeContent });

    const score = await calculateRampUpScore(ownerName, repoName, mockToken);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('should return a score of 0 for an empty README', async () => {
    const readmeContent = '';
    (axios.get as jest.Mock).mockResolvedValue({ data: readmeContent });

    const score = await calculateRampUpScore(ownerName, repoName, mockToken);
    expect(score).toBe(0);
  });

  it('should return a score of 0 for a README with no recognized sections', async () => {
    const readmeContent = `
      # Welcome to the Project
      This is a basic README with no meaningful sections.
    `;
    (axios.get as jest.Mock).mockResolvedValue({ data: readmeContent });

    const score = await calculateRampUpScore(ownerName, repoName, mockToken);
    expect(score).toBe(0.2);
  });

  it('should handle API errors gracefully and return a score of 0', async () => {
    (axios.get as jest.Mock).mockRejectedValue(new Error('GitHub API error'));

    const score = await calculateRampUpScore(ownerName, repoName, mockToken);
    expect(score).toBe(0);
  });
});
