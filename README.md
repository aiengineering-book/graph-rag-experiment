# graph-rag-experiment

A reproducible comparison of three ways to answer questions over a document collection:

1. **No retrieval**: the model answers from what it already knows (control).
2. **Hybrid search**: vector search plus keyword search in Postgres (pgvector and `tsvector`).
3. **Graph retrieval**: entities and relations extracted by an LLM, stored as Postgres tables, queried by following the graph.

Everything runs on Postgres and TypeScript. No graph database is needed.

> Work in progress. Done: schema, embeddings, LLM client with a token budget, ingestion, the no-retrieval and hybrid systems, and the scoring harness. Graph retrieval comes next.

## Requirements

- Node 22 and pnpm or npm
- Docker, for Postgres with pgvector (`docker compose up -d`)
- [Ollama](https://ollama.com) with `ollama pull nomic-embed-text`
- An API key for an OpenAI-compatible chat model (the experiment uses DeepSeek)

## Setup

```bash
npm install
cp .env.example .env   # fill in LLM_API_KEY
docker compose up -d
npm test               # runs on PGlite, no server needed
```

## Data

The multi-hop questions come from the [MuSiQue](https://github.com/StonyBrookNLP/musique) dev set (CC BY 4.0). Download it and take a fixed sample of 100 questions with the commands in `data/README.md`.

## Run

```bash
npm run ingest                                     # embeds data/paragraphs.json into Postgres
npm run eval -- --system closed-book --limit 10    # control, no retrieval
npm run eval -- --system hybrid --limit 10         # vector + keyword search
```

Each run prints a summary and writes per-question results to `results/`. Scoring is exact match and token F1 against the answer and its aliases, plus the share of each question's supporting passages that the system retrieved.
