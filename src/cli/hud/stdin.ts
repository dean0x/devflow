import type { StdinData } from './types.js';

/**
 * Read and parse JSON from stdin. Returns empty object on parse failure.
 */
export function readStdin(): Promise<StdinData> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk: string) => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(data) as StdinData);
      } catch {
        resolve({});
      }
    });
    process.stdin.on('error', () => {
      resolve({});
    });
    process.stdin.resume();
  });
}
