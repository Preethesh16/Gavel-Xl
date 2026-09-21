/* global self */
// Kokoro and its model are Apache-2.0. See docs/neural-commentary.md.
// The public module worker keeps ONNX inference off the React/UI thread and avoids
// bundling the package's Node-only ONNX runtime into the web application.
let modelPromise;
let latestId = null;
let pending = null;
let running = false;
let lastProgress = -1;
let TextSplitter;

async function prepare() {
  if (!modelPromise) {
    modelPromise = (async () => {
      const { KokoroTTS, TextSplitterStream, env } =
        await import('https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js');
      TextSplitter = TextSplitterStream;
      env.wasmPaths = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.1/dist/';
      const model = await KokoroTTS.from_pretrained('onnx-community/Kokoro-82M-v1.0-ONNX', {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: (event) => {
          if (event.status === 'progress' && event.file?.endsWith('.onnx')) {
            const progress = Math.round(event.progress);
            if (Number.isFinite(progress) && progress !== lastProgress) {
              lastProgress = progress;
              self.postMessage({ type: 'progress', progress });
            }
          }
        },
      });
      // Download the default speaker and warm the graph before announcing ready.
      await model.generate('Welcome.', { voice: 'af_heart' });
      self.postMessage({ type: 'ready' });
      return model;
    })().catch(() => {
      self.postMessage({ type: 'load-error' });
      throw new Error('Neural commentary could not load');
    });
  }
  return modelPromise;
}

async function drain() {
  if (running) return;
  running = true;
  while (pending) {
    const request = pending;
    pending = null;
    try {
      const model = await prepare();
      if (latestId !== request.id) continue;
      // Sentence streaming avoids the model's phoneme limit on longer analysis,
      // and lets the opening sentence play while the remaining speech is generated.
      const sentences = new TextSplitter();
      sentences.push(request.text);
      sentences.close();
      const chunks = new TextSplitter();
      for (const sentence of sentences.sentences) {
        const words = sentence.split(/\s+/);
        // Bound long sentences so a slow CPU can deliver a first chunk promptly.
        // Keeping punctuation and every word also avoids silently truncating analysis.
        for (let offset = 0; offset < words.length; offset += 24) {
          chunks.push(words.slice(offset, offset + 24).join(' '));
          chunks.flush();
        }
      }
      chunks.close();
      for await (const { audio, text } of model.stream(chunks, {
        voice: request.voice,
        speed: 1.03,
      })) {
        if (latestId !== request.id) break;
        const wav = audio.toWav();
        self.postMessage({ type: 'audio', id: request.id, wav, text }, [wav]);
      }
      if (latestId === request.id) self.postMessage({ type: 'complete', id: request.id });
    } catch {
      if (latestId === request.id) self.postMessage({ type: 'speech-error', id: request.id });
    }
  }
  running = false;
}

self.onmessage = ({ data }) => {
  if (data.type === 'prepare') {
    void prepare().catch(() => undefined);
  } else if (data.type === 'cancel') {
    if (latestId === data.id) latestId = null;
    if (pending?.id === data.id) pending = null;
  } else if (
    data.type === 'speak' &&
    typeof data.text === 'string' &&
    data.text.length > 0 &&
    data.text.length <= 1800 &&
    ['af_heart', 'bf_emma'].includes(data.voice)
  ) {
    latestId = data.id;
    // Keep at most the current inference and its newest replacement, never a queue
    // of commentary about players or ceremony frames that are no longer visible.
    pending = data;
    void drain();
  }
};
