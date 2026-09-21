import { afterEach, describe, expect, it, vi } from 'vitest';
import { NeuralCommentary } from './neural-commentary';

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    MockWorker.instances.push(this);
  }
  emit(data: unknown) {
    this.onmessage?.({ data });
  }
}

function setup() {
  vi.useFakeTimers();
  MockWorker.instances = [];
  vi.stubGlobal('Worker', MockWorker);
  const commentary = new NeuralCommentary();
  const status = vi.fn();
  commentary.subscribe(status);
  commentary.prepare();
  const worker = MockWorker.instances[0]!;
  return { commentary, worker, status };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('local neural commentary', () => {
  it('warms one worker and streams every sentence before settling', async () => {
    const { commentary, worker, status } = setup();
    commentary.prepare();
    expect(MockWorker.instances).toHaveLength(1);
    expect(commentary.ready).toBe(false);
    worker.emit({ type: 'progress', progress: 42 });
    expect(status).toHaveBeenLastCalledWith({ state: 'loading', progress: 42 });
    worker.emit({ type: 'ready' });
    const chunk = vi.fn();
    const complete = vi.fn();
    const speech = commentary
      .synthesize('First sentence. Second sentence.', 'af_heart', chunk)
      .then(complete);
    const { id } = worker.postMessage.mock.lastCall![0];
    worker.emit({ type: 'audio', id, wav: new ArrayBuffer(48) });
    worker.emit({ type: 'audio', id, wav: new ArrayBuffer(64) });
    await Promise.resolve();
    expect(chunk).toHaveBeenCalledTimes(2);
    expect(complete).not.toHaveBeenCalled();
    worker.emit({ type: 'complete', id });
    await speech;
    expect(complete).toHaveBeenCalledOnce();
  });

  it('cancels obsolete speech and cannot play late worker chunks after a skip', async () => {
    const { commentary, worker } = setup();
    worker.emit({ type: 'ready' });
    const oldChunk = vi.fn();
    const oldSpeech = commentary
      .synthesize('The previous player.', 'af_heart', oldChunk)
      .catch(String);
    const oldId = worker.postMessage.mock.lastCall![0].id;
    const newChunk = vi.fn();
    const newSpeech = commentary.synthesize('The current player.', 'bf_emma', newChunk);
    const newId = worker.postMessage.mock.lastCall![0].id;
    expect(worker.postMessage).toHaveBeenCalledWith({ type: 'cancel', id: oldId });
    worker.emit({ type: 'audio', id: oldId, wav: new ArrayBuffer(48) });
    worker.emit({ type: 'complete', id: oldId });
    expect(oldChunk).not.toHaveBeenCalled();
    worker.emit({ type: 'audio', id: newId, wav: new ArrayBuffer(48) });
    worker.emit({ type: 'complete', id: newId });
    await newSpeech;
    expect(newChunk).toHaveBeenCalledOnce();
    expect(await oldSpeech).toContain('cancelled');
  });

  it('bounds stalled synthesis and releases the caller for device fallback', async () => {
    const { commentary, worker } = setup();
    worker.emit({ type: 'ready' });
    const speech = commentary
      .synthesize('A stalled player call.', 'af_heart', vi.fn())
      .catch(String);
    vi.advanceTimersByTime(30_000);
    expect(await speech).toContain('cancelled');
    expect(worker.postMessage).toHaveBeenLastCalledWith({ type: 'cancel', id: 1 });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(commentary.ready).toBe(false);
  });

  it('keeps slow but progressing speech alive and delivers each chunk text for partial fallback', async () => {
    const { commentary, worker } = setup();
    worker.emit({ type: 'ready' });
    const chunk = vi.fn();
    const speech = commentary.synthesize(
      'An analysis with enough words to permit several slow chunks to arrive without a premature device fallback.',
      'af_heart',
      chunk,
    );
    const { id } = worker.postMessage.mock.lastCall![0];
    vi.advanceTimersByTime(25_000);
    worker.emit({
      type: 'audio',
      id,
      text: 'An analysis with enough words.',
      wav: new ArrayBuffer(48),
    });
    vi.advanceTimersByTime(10_000);
    expect(worker.terminate).not.toHaveBeenCalled();
    expect(chunk).toHaveBeenCalledWith(expect.any(ArrayBuffer), 'An analysis with enough words.');
    worker.emit({ type: 'complete', id });
    await speech;
  });

  it('terminates stalled downloads and only retries when explicitly requested', () => {
    const { commentary, worker, status } = setup();
    vi.advanceTimersByTime(180_000);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(status).toHaveBeenLastCalledWith({ state: 'unavailable', progress: 0 });
    commentary.prepare();
    expect(MockWorker.instances).toHaveLength(1);
    commentary.prepare(true);
    expect(MockWorker.instances).toHaveLength(2);
    expect(status).toHaveBeenLastCalledWith({ state: 'loading', progress: 0 });
  });

  it('settles an in-flight utterance if the worker crashes', async () => {
    const { commentary, worker, status } = setup();
    worker.emit({ type: 'ready' });
    const speech = commentary
      .synthesize('The champion is Athletic.', 'af_heart', vi.fn())
      .catch(String);
    worker.onerror?.();
    expect(await speech).toContain('cancelled');
    expect(status).toHaveBeenLastCalledWith({ state: 'unavailable', progress: 0 });
    expect(commentary.ready).toBe(false);
  });
});
