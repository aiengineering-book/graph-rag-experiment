"""Sample 100 answerable MuSiQue dev questions (seed 42) and pool their paragraphs."""
import glob, json, random

path = next(glob.iglob("data/raw/**/musique_ans_v1.0_dev.jsonl", recursive=True))
rows = [json.loads(line) for line in open(path, encoding="utf8")]
print("dev questions:", len(rows))

random.seed(42)
sample = random.sample(rows, 100)

paragraphs = {}
for r in sample:
    for p in r["paragraphs"]:
        paragraphs[(p["title"], p["paragraph_text"])] = p

questions = [
    {
        "id": r["id"],
        "question": r["question"],
        "answer": r["answer"],
        "answer_aliases": r.get("answer_aliases", []),
        "supporting": [
            {"title": p["title"], "text": p["paragraph_text"]}
            for p in r["paragraphs"]
            if p.get("is_supporting")
        ],
    }
    for r in sample
]
json.dump(questions, open("data/questions.json", "w"), indent=1)
json.dump([{"title": t, "text": x} for (t, x) in paragraphs], open("data/paragraphs.json", "w"), indent=1)
print("sample questions:", len(questions), "unique paragraphs:", len(paragraphs))
