import { getDependenciesFraction } from '../src/goodPinningPractice';

describe('getDependenciesFraction', () => {
    beforeEach(() => {
        // Clear any previous mocks
        jest.restoreAllMocks();
    });

    test('returns 1.0 when there are no dependencies', async () => {
        global.fetch = jest.fn().mockResolvedValueOnce({
            ok: true,
            json: async () => ({ dependencies: {} }),
        } as Response);

        const fraction = await getDependenciesFraction('owner', 'repo', 'token');
        expect(fraction).toBe(1.0);
        expect(global.fetch).toHaveBeenCalledWith(
            `https://api.github.com/repos/owner/repo/contents/package.json`,
            {
                headers: {
                    'Authorization': 'Bearer token',
                    'Accept': 'application/vnd.github.v3.raw',
                },
            }
        );
    });

    test('returns 1.0 when all dependencies are pinned', async () => {
        global.fetch = jest.fn().mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                dependencies: {
                    "package1": "1.0.0",
                    "package2": "2.3.4",
                    "package3": "3.5.0",
                },
            }),
        } as Response);

        const fraction = await getDependenciesFraction('owner', 'repo', 'token');
        expect(fraction).toBe(1.0);
    });

    test('returns 0.5 when half of the dependencies are pinned', async () => {
        global.fetch = jest.fn().mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                dependencies: {
                    "package1": "1.0.0",
                    "package2": "^2.3.4",
                    "package3": "~3.5.0",
                    "package4": "4.5",
                },
            }),
        } as Response);

        const fraction = await getDependenciesFraction('owner', 'repo', 'token');
        expect(fraction).toBe(0.5);
    });

    test('returns 0.0 when no dependencies are pinned', async () => {
        global.fetch = jest.fn().mockResolvedValueOnce({
            ok: true,
            json: async () => ({
                dependencies: {
                    "package1": "^1.0.0",
                    "package2": "~2.3.4",
                    "package3": "*",
                },
            }),
        } as Response);

        const fraction = await getDependenciesFraction('owner', 'repo', 'token');
        expect(fraction).toBe(0.0);
    });

    test('handles fetch error gracefully and returns 0', async () => {
        global.fetch = jest.fn().mockRejectedValueOnce(new Error('API is down'));

        const fraction = await getDependenciesFraction('owner', 'repo', 'token');
        expect(fraction).toBe(0.0);
    });
});
