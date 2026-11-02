# graph-rag-experiment

A reproducible comparison of three ways to answer questions over a document collection:

1. **No retrieval**: the model answers from what it already knows (control).
2. **Hybrid search**: vector search plus keyword search in Postgres (pgvector and `tsvector`).
3. **Graph retrieval**: entities and relations extracted by an LLM, stored as Postgres tables, queried by following the graph.

Everything runs on Postgres and TypeScript. No graph database is needed.

> Multi-hop experiment done (results below). Global questions are not tested: they need community summaries, which this graph does not have.

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

## Results (100 MuSiQue dev questions, 1,847 passages, DeepSeek)

Intervals are 95% bootstrap intervals over questions (`npm run report -- results/a.json results/b.json ...`; the first file is the baseline). "Paired" counts the questions only one system answered correctly.

| run | exact match | F1 | evidence retrieved | EM vs hybrid (paired) | prompt tokens |
|---|---|---|---|---|---|
| closed-book (no retrieval) | 10% | 0.19 | n/a | n/a | 5,506 |
| hybrid | 28% [19, 37] | 0.42 | 51% | baseline | 79,645 |
| graph | 35% [26, 45] | 0.48 | 61% | +7 pts [-3, 17], 18 vs 11 | 75,860 |
| graph + hybrid | 42% [33, 52] | 0.53 | 68% | +14 pts [5, 24], 20 vs 6 | 82,028 |

Variations (each uses the same graph, no rebuild):

| run | exact match | evidence retrieved | EM vs baseline (paired) | prompt tokens |
|---|---|---|---|---|
| graph, 1 hop | 30% | 58% | +2 vs hybrid [-8, 12] | 66,887 |
| graph + hybrid, 1 hop | 36% | 64% | +8 vs hybrid [-1, 18] | 82,005 |
| graph, hub cap 20 | 39% | 63% | +11 vs hybrid [1, 21] | 72,398 |
| graph + hybrid, hub cap 20 | 48% | 70% | +6 vs graph + hybrid [0, 12] | 81,155 |
| hybrid, 8 passages | 33% | 60% | +5 vs hybrid [-1, 12] | 120,758 |
| graph + hybrid, 8 passages | 48% | 76% | +15 vs hybrid, 8 passages [7, 23] | 124,226 |

Costs:

- Building the graph once: 1,827 LLM calls, about 964,000 tokens (450,000 prompt, 514,000 completion), about 14 minutes at concurrency 4. 57 passages (3%) returned JSON that did not parse and have no graph entries.
- Updating one edited passage: about 255 prompt + 306 completion tokens and 2 s for the graph, against 70-90 ms and no LLM call for the hybrid index (`npm run update-cost`).
- Each graph query adds one LLM call (extracting the question's entities).

Read these with the following in mind:

- One run, one sample of 100 questions, one model. Intervals are wide.
- The hub cap of 20 neighbours was chosen after looking at failures on these same questions, so its gain is optimistic. It fixed the case it was designed for (a hub entity, "Florida", crowding out the answer). One question appears twice in the sample under different ids, so that fix counts twice.
- Graph retrieval did not help every question. It lost where the question names no entity to start from (for example a question about the Dow Jones and unemployment).
- The graph has no communities or community summaries, so this says nothing about global, whole-corpus questions.
