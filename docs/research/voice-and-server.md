# Research: local voice and a dedicated Sable server

*Researched 2026-11-20. Model facts were checked on Hugging Face model cards. **Prices are the shakiest part:** GPU and DDR5 prices rose sharply through 2026, so re-check before buying.*

## The voice plan in one line

Use **Witty** (your voice-loop project: hearing, turn-taking, interruptions, speaking back) or **Pipecat** as the voice engine, and **Sable as the brain** behind it. All of Sable's tools and memory stay in Sable. Both run on the GPU box.

## Speech-to-text (STT)

| Model | VRAM | Streaming | Accuracy | License |
|---|---|---|---|---|
| Whisper large-v3-turbo (faster-whisper / whisper.cpp) | 3–6 GB | No | ~7.7% WER, 99 languages | MIT |
| NVIDIA Parakeet TDT 0.6B v3 | 2–4 GB | Chunked | ~6.3% WER, 25 European languages, very fast | CC-BY-4.0 |
| NVIDIA Nemotron Speech Streaming 0.6B | small | **Yes** (~0.56 s, even on CPU) | Strong for English | NVIDIA license (read it) |
| Kyutai STT 1B | ~2.5 GB | **Yes** (~0.5 s, built-in end-of-turn detection) | Good, English and French | CC-BY-4.0 |
| Voxtral Mini 4B Realtime | 9–10 GB | **Yes** (<200 ms possible) | 13 languages | Apache-2.0 |
| Moonshine v2 | tiny | Yes | Lower | MIT; runs on a Raspberry Pi |

**Picks:**
- **Voice notes** (Telegram, batch): faster-whisper large-v3-turbo or Parakeet v3.
- **Live conversation:** Nemotron Streaming or Kyutai for English. Voxtral Realtime if you need other languages.

## Text-to-speech (TTS)

| Model | VRAM | Speed | Voice cloning | License |
|---|---|---|---|---|
| **Kokoro-82M** | 1–2 GB or CPU | Very fast | No (preset voices) | Apache-2.0 |
| Piper | CPU | Fastest | No | GPL engine; each voice has its own terms |
| Chatterbox Turbo | ~3 GB | <200 ms | **Yes** (can laugh; Witty already supports it) | MIT |
| Qwen3-TTS 0.6B/1.7B | ~2–4 GB | ~100 ms claimed | Yes, plus describe-a-voice | Apache-2.0 |
| Kyutai TTS 1.6B | ~5 GB | ~220 ms | Yes | CC-BY-4.0 |
| F5-TTS / XTTS-v2 | — | Slow | Yes | **Non-commercial**; avoid |

**Pick:** Kokoro as the default voice. Use Chatterbox Turbo or Qwen3-TTS if Sable should have its own custom voice.

## Live voice conversation

- **Pipecat** (BSD) is the best fit:
  - WebRTC to the browser and Android app.
  - Twilio and Telnyx for phone calls.
  - Silero voice detection and **Smart Turn v3** end-of-turn detection, both on CPU.
  - Its local reference stack reaches under 800 ms voice-to-voice on a Mac.
- **LiveKit Agents:** fully self-hostable and stronger for SIP. But the best interruption handling is Cloud-only for now.
- **Kyutai Unmute:** very natural turn-taking, but CUDA x86 only, 16 GB VRAM or more, and English/French only.
- **Single-model speech-to-speech** (Moshi, Ultravox, Qwen3-Omni): weak at tool calling, and Qwen3-Omni needs 60 GB or more. Not for an agent with tools.

**Realistic latency on one 3090/4090-class GPU with a streaming setup:** about **0.6–1.0 s** from you finishing to Sable speaking. A phone call adds 0.1–0.3 s. A non-streaming setup takes 1.5–2.5 s.

## Local models (what runs on the box)

- **Serving engines:** single-user speed is about the same across engines (within ~11%).
  - **Ollama**, which Sable uses today, is the easiest.
  - **llama.cpp** gives the most control on a 24 GB card.
  - **vLLM/SGLang** cover more models and tool-call formats, but use more VRAM and take more setup.
  - Test tool calling in the engine you'll actually use.
- **Models** (all Apache-2.0 and all natively multimodal, so they can look at camera frames too):

| Card | Main model | Router / small tasks |
|---|---|---|
| 16 GB | Gemma 4 12B, gpt-oss-20b, Qwen3.5-9B | Qwen3.5-4B |
| **24 GB** | **Gemma 4 26B-A4B** (fast mixture-of-experts) or **Qwen3.6-27B** (stronger) | Qwen3.5-4B |
| 32 GB+ | Qwen3.6-35B-A3B, Gemma 4 31B | |
| 128 GB unified | Qwen3.5-122B-A10B, gpt-oss-120b | |

- **Embeddings:** keep embeddinggemma. Add the **Qwen3-Reranker-0.6B** reranker for better memory search.

## Hardware

**VRAM needed with everything running at once:**

| Component | VRAM |
|---|---|
| 26–27B model | ~16–18 GB |
| Context (KV cache) | 2–4 GB |
| Streaming STT | 2–3 GB |
| TTS | 1–3 GB |
| Embeddings | 1–2 GB |
| **Total** | **22–30 GB** |

So 24 GB works with care, and 32–48 GB is comfortable.

| Option | Memory | Price, late 2026 (**re-check**) | Fit |
|---|---|---|---|
| RTX 5060 Ti 16 GB | 16 GB | ~$430–550 | Budget; more work goes to Claude |
| **Used RTX 3090** | 24 GB | ~$1,300–1,450 (up from $600–800 in March) | **Best CUDA value**; power-limit it to about 270 W |
| 2× RTX 3090 | 48 GB | ~$2,600–2,900 | LLM on one card, voice and vision on the other; loud; 1,200 W PSU |
| RTX 5090 | 32 GB | $3,500–4,500 street price | Ideal single card if you can find one |
| AMD Strix Halo mini PC | 128 GB unified | ~$2,200–3,500 | Quiet, great for big MoE models. **No CUDA**, so the NVIDIA speech models are hard to run; Whisper and Kokoro are fine |
| NVIDIA DGX Spark | 128 GB | ~$4,700 | CUDA, but ARM, so some containers don't run |
| Mac Studio / mini | up to 128 GB+ | $1,800–4,000+ | Silent. But Docker on a Mac can't use the GPU, so models run outside Docker |

**Other parts:**
- **RAM:** 64 GB of DDR5 costs about **$1,000–1,400** right now (it was about $200 in 2025). Reuse DDR4 or an older platform if you can.
- **CPU:** any modern 8-core.
- **Storage:** 2 TB NVMe for models.
- **Network:** wired Ethernet.

**Software:** Ubuntu LTS on bare metal with Docker and the NVIDIA Container Toolkit is simplest. Use Proxmox only if the box will also run other VMs.

**Power and noise:** a 3090 box idles at 60–90 W and draws 350–450 W under load, roughly 100–150 kWh a month. Strix Halo and Macs are near-silent.

### Three builds

| | Hardware | Cost | What it runs |
|---|---|---|---|
| Budget | RTX 5060 Ti 16 GB, Ryzen 5/7, 32 GB RAM | ~$1,400–1,900 | 9–20B model and voice; more work sent to Claude |
| **Mid (recommended)** | Used RTX 3090, Ryzen 7/9, 64 GB, 850 W PSU, 2 TB NVMe | ~$2,800–3,500 | 26–27B model, full voice stack, vision; ~0.7–1 s voice replies |
| High | 2× 3090 or one 5090, 64–128 GB | ~$4,500–6,500 | Bigger models with long context, plus voice and vision side by side |

## Containers on the box

1. `sable`: the existing server.
2. `llm`:
   - Ollama, or llama.cpp behind llama-swap.
   - Main model: Gemma 4 26B-A4B or Qwen3.6-27B.
   - Router: Qwen3.5-4B.
3. `stt-batch`: faster-whisper with an OpenAI-compatible transcription endpoint.
4. `stt-stream`: Nemotron, Parakeet or Kyutai STT.
5. `tts`: Kokoro (OpenAI-compatible speech endpoint), optionally Chatterbox.
6. `voice`: Witty or Pipecat. WebRTC for the app, Twilio/Telnyx for phone calls, and Sable as the brain.
7. `embed`: embeddinggemma plus Qwen3-Reranker.
8. HTTPS through Tailscale or Caddy, because the microphone and WebRTC need TLS. Plus coturn for calls off your home network.

## Sources

- STT: [Parakeet v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) · [Nemotron streaming](https://huggingface.co/nvidia/nemotron-speech-streaming-en-0.6b) · [Voxtral Realtime](https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602) · [Kyutai STT](https://kyutai.org/stt) · [Whisper turbo](https://huggingface.co/openai/whisper-large-v3-turbo) · [Moonshine v2](https://arxiv.org/html/2602.12241v1)
- TTS: [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M) · [Chatterbox Turbo](https://huggingface.co/ResembleAI/chatterbox-turbo) · [Qwen3-TTS](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice) · [Kyutai TTS](https://huggingface.co/kyutai/tts-1.6b-en_fr)
- Pipelines: [Smart Turn v3](https://huggingface.co/pipecat-ai/smart-turn-v3) · [Pipecat local agents](https://github.com/kwindla/macos-local-voice-agents) · [LiveKit interruption thread](https://community.livekit.io/t/roadmap-for-adaptive-interruption-handling-in-self-hosted-livekit-workers/1172) · [Qwen3-Omni](https://github.com/QwenLM/Qwen3-Omni)
- Models: [Qwen3.6-27B](https://huggingface.co/Qwen/Qwen3.6-27B) · [Gemma 4 26B-A4B](https://huggingface.co/google/gemma-4-26B-A4B-it) · [Qwen3-Reranker](https://huggingface.co/Qwen/Qwen3-Reranker-0.6B) · [Tool calling depends on the runtime](https://pub.towardsai.net/local-llm-tool-calling-depends-on-your-runtimes-parser-b636843b6c97)
- Hardware: [Used 3090 prices](https://www.shanethegamer.com/news/old-gpus-are-cashing-in-as-ramageddon-pushes-used-rtx-3090-prices-past-1300/) · [RTX 5090 prices](https://www.tomshardware.com/pc-components/gpus/usd3-700-rtx-5090-gpus-have-found-new-homes-after-sitting-on-us-retailers-shelves) · [Strix Halo benchmarks](https://dev.to/jovan_chan_9500711396d4e6/amd-ryzen-ai-max-395-strix-halo-for-local-llms-in-2026-128gb-unified-memory-100-ts-on-30b-2875) · [DGX Spark review](https://www.tomshardware.com/pc-components/gpus/nvidia-dgx-spark-review/5)
