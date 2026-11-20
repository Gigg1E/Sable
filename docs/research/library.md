# Research: the Library, Sable's shared database

*Researched 2026-11-20, with Sable's current code read for context. Items marked **unverified** need testing.*

## What you asked for

One big shared store that every chat, sub-agent and Space can read **without asking you**. It holds everything you give Sable or Sable finds:
- files, images, video, links and pages, notes, emails
- what chats made
- **how things were done before** ("how did I do this?")

It keeps learning over time, and only the main chat can write to its own private journal.

## Decisions (from you, 2026-11-20)

- **We build it our own way.** No framework dictates the design; the research below is input, not a template.
- **Two halves: open and private.**
  - **Open:** no restrictions. Things from the internet, general pictures, public facts, how-tos about tools. Any model may see it, including cloud models.
  - **Private:**
    - anything that could be a **secret** (tokens, API keys, passwords)
    - **personal details** (your address, phone number, IDs)
    - **intimate or sensitive images**
    - **messages and memories**
    - **people** in your life
    - **what Sable sent on your behalf** (emails, messages)

    Private content goes **only to local models**. A cloud model gets a redacted version or nothing.
  - **Classification happens on the way in.** A local check (patterns for secrets and personal details, plus a small local model for anything subtle) marks each item. When unsure, it's private. You can flip any item.
  - **Today you use cloud models only,** so for now "private" means: never sent to a cloud model unredacted, and kept out of cloud-visible search results. Once the AI server is in, private content gets its full local treatment.
- **Email content isn't stored in the Library.** Email is read live for context. What *is* kept, as private, is what Sable did: "emailed Sam about the deposit on Nov 3".
- **People are first-class (private):**
  - Sable learns **you** most, and the people around you a little: who they are to you (best friend, sister, cat), and how to reach them (Discord, email, phone).
  - "Send my best friend a message" works without asking for details. Sable knows who that is and only asks *which way* ("Discord or email?"), and remembers your answer as a preference.
  - Pets count.
  - People pages are editable, and Sable never shares them outward.

## Where Sable is today

- **Memories:** one table (`me`, `other`, `howto`) with embeddings stored as JSON. Search loads up to 2,000 rows and scores them in JavaScript. Fine for a few thousand facts, but **not** for files, pages and media.
- **Embedding cuts:** inputs are cut to 2,000 characters, which wastes about three quarters of what embeddinggemma can read.
- **Files** live in per-chat folders, and uploads are tracked. None of it is searchable by meaning.

## What other systems do, and what fits one person

| System | Idea | Take for Sable |
|---|---|---|
| Letta (MemGPT) | Editable "memory blocks" always in context, archival memory to search, background "sleep-time" agents that tidy memory | Blocks = main chat's journal and "about me". Archival = the Library. Sleep-time = nightly tidy-up |
| Mem0 | A model extracts facts and adds, updates or deletes them | Sable's memory_save with dedupe already does this. Running Mem0 is overkill |
| Zep / Graphiti | Facts with "valid from / until"; contradictions **retire** old facts instead of deleting | **Copy this**: "you moved" retires the old address and keeps the history |
| GraphRAG, LightRAG, Cognee | Build a full knowledge graph with a model at import time | Too expensive for personal data. A light people/places/projects layer is plenty |
| Khoj, Open WebUI | Second-brain apps on Postgres | Confirms the pattern; heavier than needed |
| Claude memory tool | Memory as files the model reads and writes | Readable, editable pages are the right UX |
| Obsidian vault | Markdown files as the source of truth | Good as an **export**, not the main store |

**Works for one user:**
- SQLite with hybrid search (keywords plus meaning).
- Where everything came from, on every row.
- Model-written summaries you can see and edit.
- A nightly tidy-up.

**Overkill:** a graph database, a separate vector database, and multi-user memory servers.

## Storage and search

- **sqlite-vec** (v0.1.9, maintained again in 2026) adds vector search inside SQLite. At personal scale (hundreds of thousands of chunks), plain exact search is fast enough, so stay on the stable version.
  - Loading it in Node needs `allowExtension: true` when the database is opened. That's a small change in `db.ts`, and the pattern is **unverified** in Node.
- **Hybrid search:** SQLite FTS5 (keyword) plus vectors (meaning), merged with **reciprocal rank fusion**. This is a simple, proven way to combine the two rankings.
- **Reranker:** Qwen3-Reranker re-sorts the top 30–50 results. Ollama has no rerank endpoint, so it runs in llama.cpp `llama-server --rerank` or vLLM on the GPU server.
- **Chunking:**
  - Split by structure (headings, pages, email parts, transcript segments), about 300–500 tokens with a little overlap.
  - Prefix each chunk with its item's title and a one-line summary.
  - Every chunk keeps where it came from: page, heading, or video time.
- **Dedupe:** content hashes, so the same file or page isn't stored twice.
- **Vectors:** stored as compact binary, not JSON. **One vector table per embedding model**, so changing models re-embeds in the background and switches over when done.

## Taking in everything, locally

| Type | How |
|---|---|
| Text, notes, code | Chunk and embed |
| Web pages | Readability (clean article text), stored with URL, fetch time and a snapshot |
| Email | Each message is an item; attachments are child items |
| PDF / Word / slides | **Docling** (a document converter) in a small sidecar container. Slow on CPU, fine overnight |
| Images | Keep the original. A local vision model writes a caption, reads text (OCR) and adds tags. The caption and text are embedded, plus an image embedding once a multimodal embedder is available |
| Video | Keyframes per scene, captioned, and the audio transcribed with timestamps, so you can cite "video @ 3:12" |
| Audio, voice notes | Whisper transcript |

- **Models:**
  - **EmbeddingGemma 2** (text, image, audio and video in one 768-dimension space; on Ollama) is the natural upgrade from today's embeddinggemma. How to send images through Ollama's embed endpoint is **unverified**.
  - On the GPU server, Qwen3-VL-Embedding and its matching reranker are stronger alternatives.
- **Import queue:**
  - Priorities: you're waiting, then your uploads, then chat outputs, then bulk email and web, then re-embedding.
  - Jobs that need a GPU **wait** until the GPU server exists, instead of failing.

## How it learns

- **Episodes:** when a chat goes quiet, a model writes a short record:
  - the goal, what was done, which tools, how it turned out, what was made
  - who and what was involved, and what's still open

  This is also the digest that mini chats send to the main brain.
- **Procedures ("how did I do this before"):**
  - Successful episodes become "When <situation>: <steps, tools, gotchas>". Failures become "pitfalls".
  - This builds on today's how-to memories. They start as **proposed** and become active when you or the main brain confirm, or after two separate successes.
- **Nightly tidy-up** (local model):
  - merge duplicates
  - update people and place pages
  - retire facts that were contradicted, keeping the history
  - roll the journal into weekly summaries
- **Nothing is deleted on its own.** Old, unused facts are flagged in a weekly "still true?" card.
- **People, places and projects pages:**
  - A generated, editable page each, with aliases ("Sam" = sam@…).
  - Sections you edit are locked so regeneration never overwrites them.
- **Not a black box.** Everything derived shows **why Sable knows it**, linking back to the original.

## Who can read and write what

| Tier | Read | Write |
|---|---|---|
| **Journal** (main chat's private memory) | Main chat | Main chat. Others can only *propose* |
| **Library** (shared) | **Every chat, sub-agent and Space, no permission needed** | Anyone can *add* raw items (files, pages, notes, episodes) with their source. Changing beliefs (facts, people pages, procedures, deletes) is a proposal the main brain or you approve |
| **Scratch** (a chat's folder) | That chat | That chat. Promoted to the Library with `library_add`, or automatically at the end |

**Trust labels** on every item: `owner` (you typed or uploaded it), `agent` (Sable wrote it from your material), `external` (web, email, webhooks, other people's files).
- Anything built from external content is external too.
- When external content is retrieved later, it's wrapped and marked as data, never instructions.

**Memory poisoning is the biggest risk.** 2025–26 research shows that a planted web page or email can trick agents into "learning" bad facts or procedures about half the time. Sable's rules:
- External content can never become a procedure, an active fact or a journal entry without your confirmation.
- Procedures can only come from your own or Sable's episodes.
- A run that has external content in front of it can't write to the journal or procedures.

**Spaces** get a read-only `sable.library.query()` limited to the collections the Space is allowed. External content comes back as data, never rendered as HTML.

**Forgetting really forgets:**
- Deleting an item removes its chunks, its search entries, its vectors in every model table, the file, thumbnails, transcripts, and every summary built from it.
- Only a hash is kept so it isn't re-imported.
- Backups need their own expiry setting.

## Proposed design

**Storage:** a separate `library.sqlite` file next to Sable's database, so backups and maintenance stay independent.

**Tables:**
- `items`: kind, title, summary, source, trust, status, when, valid/invalid dates
- `blobs`: content-addressed files
- `chunks`
- `fts` and `vec_<model>`: search indexes
- `entities`, `aliases`, `mentions`, `facts` (with valid/until dates)
- `links`: derived from, attachment of, reply to, about
- `tags`, `collections` (saved filters Spaces can use), `jobs`, and an access log

Today's memories move in as items, and `memory_*` keeps working.

**Tools:**
- `library_search` (hybrid, then rerank; returns snippets with citations)
- `library_get` (whole item, or one page or time range)
- `library_add` (queues an import; trust is set from the source, **never by the model**)
- `library_link`, `library_tag`
- `library_propose` and `library_commit`
- `library_forget`
- `entity_get`
- `procedure_search`: runs automatically at the start of each task, replacing today's how-to matching

**Library page:**
- Search with "why this matched".
- Filters: type, source, chat, trust, date, person, tag.
- Grid or list with thumbnails, and an import queue.
- Item view: the original, its text, what was derived from it, and **Forget**.
- People and places pages with a fact timeline (retired facts struck through).
- A day-by-day timeline of episodes and journal.
- A weekly review card, and Obsidian export.

## Phases

| Phase | Hardware | Build |
|---|---|---|
| **P0** | Today's server (embeddinggemma on CPU) | `library.sqlite`, sqlite-vec plus FTS5 hybrid search, proper chunking and batch embedding, memories moved in. Import notes, text and code, web pages, chat outputs and uploads. Trust and sources, `library_*` tools, a basic Library page, real forgetting |
| P1 | Today's server | Episodes and procedures from finished chats (and digests to the main brain), people pages from contacts and email, the Space read bridge, email import, the priority queue with "waiting for GPU" |
| P2 | Today's server, overnight | PDF and Office via Docling, OCR for screenshots, nightly tidy-up on a small local model |
| P3 | GPU server | Vision captions, Whisper for audio and video, EmbeddingGemma 2 or Qwen3-VL embeddings, reranker, full re-embed |
| P4 | GPU server | Fuller fact history and contradiction handling, page-image search for PDFs, "how is X related to Y", weekly sleep-time review |

## Questions for you

1. **Cloud models:** may they ever see Library content (summarizing long chats, captioning, answering)? Per kind, or never for anything marked private?
2. **Email:** import all of it, or only some labels? Attachments? How far back?
3. **Chat files:** should chat outputs and uploads go into the Library automatically, or only when promoted?
4. **Spaces:** should each Space see only the collections it's allowed, or everything except the journal?
5. **Backups:** how long should forgotten things stay in them?
6. **Disk space:** keep original videos and photos, or only text and thumbnails?
7. **Procedures:** who approves them, the main brain alone or always you?

## Sources

- Letta: [memory blocks](https://letta.com/blog/memory-blocks) · [sleep-time agents](https://forum.letta.com/t/sleeptime-agents-for-memory-consolidation-best-practices-guide/154)
- [Mem0 paper](https://www.arxiv.org/pdf/2504.19413) · [Graphiti](https://github.com/getzep/graphiti) · [Khoj](https://github.com/khoj-ai/khoj) · [Claude memory tool](https://platform.claude.com/docs/en/agents-and-tools/tool-use/memory-tool)
- Search: [sqlite-vec releases](https://github.com/asg017/sqlite-vec/releases) · [Hybrid FTS5 and vector search](https://simonwillison.net/2024/Oct/4/hybrid-full-text-search-and-vector-search-with-sqlite/) · [Ollama rerank issue](https://github.com/ollama/ollama/issues/4510)
- Models: [EmbeddingGemma 2](https://ollama.com/library/embeddinggemma-2) · [Qwen3-VL-Embedding](https://huggingface.co/Qwen/Qwen3-VL-Embedding-8B) · [Gemma 4](https://ai.google.dev/gemma/docs/core/model_card_4) · [Granite-Docling](https://ibm.com/new/announcements/granite-docling-end-to-end-document-conversion)
- Learning from experience: [ReasoningBank](https://arxiv.org/abs/2509.25140)
- Prompt injection: [Spotlighting](https://arxiv.org/abs/2403.14720) · [CaMeL](https://simonwillison.net/2025/Apr/11/camel/)
- Memory poisoning: [MemoryGraft](https://arxiv.org/html/2512.16962) · [arXiv 2606.04329](https://arxiv.org/abs/2606.04329) · [Sleeper poisoning](https://arxiv.org/html/2605.15338)
