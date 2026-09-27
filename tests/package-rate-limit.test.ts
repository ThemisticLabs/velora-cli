import { test, expect } from 'bun:test';
import packageRequest from '../src/downloads/package-request.js';

test('unsigned rate limits remain unavailable and retries are bounded', async function () {
    var calls = 0;
    var transport = async function () {
        calls++;
        return new Response('{}', { status: 429, headers: { 'Retry-After': '0' } });
    } as typeof fetch;
    await expect(packageRequest({ operation: 'resolve', license_key: 'FIXTURE-LICENSE', runtime_target: 'macosx-14.0-arm64' }, new AbortController().signal, transport)).rejects.toThrow('server is busy');
    expect(calls).toBe(3);
});

test('cancellation interrupts a rate limit wait', async function () {
    var controller = new AbortController();
    var transport = async function () {
        setTimeout(function () { controller.abort(); }, 10);
        return new Response('{}', { status: 429, headers: { 'Retry-After': '60' } });
    } as typeof fetch;
    await expect(packageRequest({ operation: 'resolve', license_key: 'FIXTURE-LICENSE', runtime_target: 'macosx-14.0-arm64' }, controller.signal, transport)).rejects.toThrow();
});
