import { getCost } from '../src/cost';

// Mock the native `fetch` globally
global.fetch = jest.fn();

describe('getCost', () => {
  const TOKEN = 'fake-token';

  afterEach(() => {
    jest.clearAllMocks();
  });

  test('calculates cost for a repository with no dependencies', async () => {
    // Mock `fetch` to return a package.json with no dependencies
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ dependencies: {} }),
    });

    const cost = await getCost('owner', 'repo', TOKEN);

    // Cost should only include the base cost
    expect(cost).toBeGreaterThanOrEqual(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  test('calculates cost for a repository with one dependency', async () => {
    // Mock the package.json of the main repo
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        dependencies: {
          'dep-repo': '1.0.0',
        },
      }),
    });

    // Mock the package.json of the dependency
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ dependencies: {} }),
    });

    const cost = await getCost('owner', 'repo', TOKEN);

    // Cost should include both the base cost and the cost of the dependency
    expect(cost).toBeGreaterThanOrEqual(0);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  test('handles a dependency chain with multiple levels', async () => {
    // Mock the main package.json
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        dependencies: {
          'dep-repo1': '1.0.0',
        },
      }),
    });

    // Mock the first dependency
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        dependencies: {
          'dep-repo2': '1.0.0',
        },
      }),
    });

    // Mock the second dependency
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ dependencies: {} }),
    });

    const cost = await getCost('owner', 'repo', TOKEN);

    // Total cost should include all dependencies and the main package
    expect(cost).toBeGreaterThanOrEqual(0);
    expect(global.fetch).toHaveBeenCalledTimes(3);
  });

  test('throws an error for invalid token', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      statusText: 'Unauthorized',
    });

    await expect(getCost('owner', 'repo', 'invalid-token')).rejects.toThrow(
      'Failed to fetch package.json: Unauthorized'
    );

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

//   test('handles repositories with circular dependencies gracefully', async () => {
//     // Mock a circular dependency scenario
//     (global.fetch as jest.Mock).mockResolvedValueOnce({
//       ok: true,
//       json: async () => ({
//         dependencies: {
//           'dep-repo': '1.0.0',
//         },
//       }),
//     });

//     (global.fetch as jest.Mock).mockResolvedValueOnce({
//       ok: true,
//       json: async () => ({
//         dependencies: {
//           'owner/repo': '1.0.0', // Circular dependency back to the original repo
//         },
//       }),
//     });

//     const cost = await getCost('owner', 'repo', TOKEN);

//     // Should break the circular dependency and calculate cost
//     expect(cost).toBeGreaterThanOrEqual(0);
//     expect(global.fetch).toHaveBeenCalledTimes(2);
//   });
});
