# Unit Tests

This project uses [Vitest](https://vitest.dev/) for unit testing.

## Running Tests

```bash
# Run all tests once
pnpm test

# Run tests in watch mode
pnpm test:watch

# Run tests with coverage report
pnpm test:coverage
```

## Test Coverage

The test suite includes comprehensive unit tests for the streaming module (`src/music/stream.ts`), which handles:

### yt-dlp Integration Tests

The tests mock the `yt-dlp` binary to handle cases where it's not available in the test environment:

- **Binary Detection**: Tests verify that the code correctly detects when `yt-dlp` is not available and falls back to alternative providers (youtubei.js)
- **Custom Binary Path**: Tests that `YTDLP_PATH` environment variable is respected
- **Provider Fallback**: Validates the fallback chain: ytdlp-nodejs → youtubei.js → yt-dlp CLI

### Stream Module Coverage

- **Track Streaming**: Tests various track streaming scenarios including cache hits, live stream rejection, and provider fallback
- **Prefetching**: Tests prefetch functionality, cache checking, and error handling
- **Resource Creation**: Tests audio resource creation with volume control and audio filters
- **Error Handling**: Tests graceful handling of missing URLs, yt-dlp errors, and network failures
- **Cookies Handling**: Tests behavior when `cookies.txt` is missing

## Key Testing Patterns

### Mocking yt-dlp

Since `yt-dlp` is an external binary that may not be available in CI/test environments, the tests mock it:

```typescript
vi.mock('child_process');
vi.mocked(childProcess.spawnSync).mockReturnValue({
  status: 1,
  error: new Error('yt-dlp not found'),
} as any);
```

This ensures tests pass even when `yt-dlp` is not installed on the test machine.

### Mocking Web Streams

The tests use a helper function to create mock web streams for the youtubei.js download method:

```typescript
function createMockWebStream(buffer: Buffer) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(buffer);
      controller.close();
    }
  });
}
```

## Test Structure

Tests are organized by functionality:

- `checkYtDlpBinary`: Binary detection and environment variable handling
- `streamTrack`: Main streaming functionality
- `prefetchTrack`: Background prefetching
- `createTrackResource`: Audio resource creation with filters
- `cookies.txt handling`: Cookie file behavior

## CI/CD Considerations

The test suite is designed to run in environments where:
- `yt-dlp` binary may not be installed
- Network access may be restricted
- External APIs (YouTube) are mocked

This makes the tests reliable for CI/CD pipelines.
