# Data

`data/` is gitignored except this file. Create the sample like this:

```bash
python3 -m venv .venv && .venv/bin/pip install -q gdown
.venv/bin/gdown "https://drive.google.com/uc?id=1tGdADlNjWFaHLeZZGShh2IRcpO6Lv24h" -O data/musique.zip
unzip -o data/musique.zip -d data/raw
```

Then run `scripts/sample-musique.py` (seed 42, 100 questions) to write `data/questions.json` and `data/paragraphs.json`.
