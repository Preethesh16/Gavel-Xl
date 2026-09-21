# Natural commentary

The default commentator is Kokoro's `af_heart` (Heart, American English). The sound booth also offers `bf_emma` (Emma, British English) and the browser's installed voice. Preview, voice selection, commentary mute and master volume work independently of the music. Background music stops as soon as the room leaves the lobby.

The neural model runs in a module worker on the listener's device. The first interaction starts a lazy download of about 120 MB of model/runtime data; browser caching makes subsequent loads faster. No API credential or paid service is required, and commentary text is not sent to a speech service. The initial downloads contact jsDelivr and Hugging Face. Network access, WebAssembly, memory and browser cache availability affect the first load. While loading, unsupported, or after a synthesis failure, the app uses the best available English device voice and shows that fallback in the sound booth. A failed load can be retried with **Load natural voice**.

Runtime dependencies are fetched only inside `public/audio/commentary-worker.js`:

- [Kokoro.js 1.2.1](https://github.com/hexgrad/kokoro/tree/main/kokoro.js), via its published browser bundle on jsDelivr. Apache-2.0.
- [Transformers.js 3.5.1](https://github.com/huggingface/transformers.js), bundled with Kokoro; matching WASM runtime files are pinned to that version on jsDelivr. Apache-2.0. ONNX Runtime is MIT licensed.
- [Kokoro-82M-v1.0 ONNX model](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX), q8 WASM weights and voice embeddings, loaded by Kokoro's library from its upstream model repository. Apache-2.0.

Sentence streaming keeps long analysis intact and starts playback before the entire script is synthesized. The UI thread only decodes and schedules the returned WAV chunks. A replacement announcement cancels pending work, ignores late chunks and stops already scheduled audio. Mute, skip, route cleanup and ceremony completion use the same lifecycle. Downloads and synthesis have bounded watchdogs; the football game never waits for a model to download.

Inference speed depends on the device's CPU; a natural line may take several seconds to prepare. Longer scripts stream as short sentences or bounded word groups. If generation fails partway through, completed audio finishes and the device voice reads the remaining words. An inference stall terminates the worker and exposes a retry, while a normal skip keeps the loaded model for the next line.

This is a synthetic commentator, not a recording or clone of the Codex voice. Runtime availability is checked separately from voice quality: automated checks confirm playable, non-silent audio and cancellation, not a subjective listening score.

With the web app and backend running, the optional real-model browser check downloads the model,
plays all three preview sentences and a single player announcement, and checks cancellation:

```sh
GAVEL_TEST_NEURAL_VOICE=true pnpm exec playwright test tests/e2e/neural-voice.spec.ts --project=chromium
```

The ordinary test suite skips this network- and CPU-dependent check; worker lifecycle tests run
without downloading a model.
