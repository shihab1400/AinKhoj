"""
prepare.py - clean the Bangladesh education laws JSON and convert it to chunks.

Usage:
    python prepare.py laws.json                 # writes laws.jsonl
    python prepare.py criminal_laws.json criminal.jsonl   # choose the output name

The output name becomes the "domain" in the chatbot: put the file in backend/data
(e.g. education.jsonl, criminal.jsonl, land.jsonl) and run `python ingest.py`.

Rules:
  * Only fixes ENCODING and SPACING. Legal wording is never changed.
  * Anything it is unsure about is reported, not fixed.
"""
import json
import re
import sys
import unicodedata
from collections import Counter

MAX_CHARS = 1500  # long sections are split into parts below this size

# Add known one-off damage here (exact text -> corrected text).
MANUAL_FIXES = {
    "Repu-blic": "Republic",
}

# Characters that usually mean mangled encoding is still present.
SUSPECT = re.compile(r"[ÔÇÃÂâ€�]")


def fix_mojibake(s: str) -> str:
    """'ÔÇö' is UTF-8 bytes (E2 80 94) that were read as cp850. Reverse it
    piece by piece, because the same string also contains good characters."""
    def repl(m):
        try:
            return m.group(0).encode("cp850").decode("utf-8")
        except (UnicodeEncodeError, UnicodeDecodeError):
            return m.group(0)
    return re.sub(r"ÔÇ\S", repl, s)


SPACE_FIX_LOG = Counter()


def fix_glued_words(s: str) -> str:
    """'theSocieties' -> 'the Societies' (lowercase run directly followed by Capital)."""
    def repl(m):
        SPACE_FIX_LOG[m.group(0)] += 1
        return f"{m.group(1)} {m.group(2)}"
    s = re.sub(r"\b([a-z]{2,})([A-Z][a-z]+)", repl, s)
    return re.sub(r"\b([A-Z][a-z]{2,})([A-Z][a-z]{2,})\b", repl, s)


def clean(s) -> str:
    if not s:
        return ""
    s = fix_mojibake(str(s))
    s = unicodedata.normalize("NFC", s)
    for bad, good in MANUAL_FIXES.items():
        s = s.replace(bad, good)
    s = fix_glued_words(s)
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\s*\n\s*", "\n", s)
    return s.strip()


def slug(s: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")
    return s[:60].strip("-")


def split_text(text: str):
    """Split on ; or . boundaries, packing pieces up to MAX_CHARS."""
    if len(text) <= MAX_CHARS:
        return [text]
    pieces = re.split(r"(?<=[;.])\s+", text)
    parts, cur = [], ""
    for p in pieces:
        while len(p) > MAX_CHARS:  # no punctuation: hard cut on whitespace
            if cur:  # flush first so the hard-cut part stays under MAX_CHARS
                parts.append(cur)
                cur = ""
            cut = p.rfind(" ", 0, MAX_CHARS)
            if cut <= 0:  # rfind gives -1 when there is no space at all
                cut = MAX_CHARS
            parts.append(p[:cut].strip())
            p = p[cut:].strip()
        if cur and len(cur) + len(p) + 1 > MAX_CHARS:
            parts.append(cur)
            cur = p
        else:
            cur = f"{cur} {p}".strip()
    if cur:
        parts.append(cur)
    return parts


def build_header(r) -> str:
    act = r["act_title"]
    no, yr = r["act_no"], r["act_year"]
    ref = f"Act No. {no} of {yr}" if no and yr else (f"Year {yr}" if yr else "")
    lines = [f"{act}" + (f" ({ref})" if ref else "")]
    if r["chapter_no"] or r["chapter_title"]:
        lines.append(f"{r['chapter_no']} {r['chapter_title']}".strip())
    sec = f"Section {r['section_no']}" if r["section_no"] else "Section"
    if r["section_title"]:
        sec += f": {r['section_title']}"
    lines.append(sec)
    return "\n".join(lines)


def main(path, out_path=None):
    out_path = out_path or re.sub(r"\.json$", "", path) + ".jsonl"
    stem = re.sub(r"\.jsonl$", "", out_path)
    with open(path, encoding="utf-8") as f:
        raw = json.load(f)
    acts = raw["acts"] if isinstance(raw, dict) else raw

    records, seen_ids = [], Counter()
    seen_exact, skipped, conflicts = set(), [], []
    stats = Counter()
    problems = []

    for i, a in enumerate(acts):
        r = {k: clean(a.get(k, "")) for k in (
            "act_title", "act_no", "act_year", "publication_date", "chapter_no",
            "chapter_title", "section_title", "section_no", "section_text",
            "section_footnotes")}

        if not r["act_title"]:
            problems.append(f"row {i}: missing act_title")
            continue
        if r["chapter_no"]:
            m = re.match(r"(?i)chapter\s*(.+)", r["chapter_no"])
            if m:
                r["chapter_no"] = f"Chapter {m.group(1).strip().upper()}"

        if not r["section_text"]:
            problems.append(f"row {i}: empty section_text ({r['act_title'][:50]}, s{r['section_no']})")
            stats["empty_text"] += 1
            skipped.append({"row": i, "act_title": r["act_title"],
                            "section_title": r["section_title"],
                            "section_no": r["section_no"],
                            "footnotes": r["section_footnotes"]})
            continue

        exact_key = (r["act_title"], r["act_year"], r["section_no"], r["section_text"])
        if exact_key in seen_exact:
            stats["exact_duplicates_removed"] += 1
            continue
        seen_exact.add(exact_key)

        header = build_header(r)
        base_id = f"{slug(r['act_title'])}-{r['act_year'] or 'na'}-s{slug(r['section_no']) or 'na'}"
        seen_ids[base_id] += 1
        if seen_ids[base_id] > 1:
            conflicts.append(f"row {i}: {r['act_title'][:50]} s{r['section_no']} ({base_id})")
            base_id += f"-dup{seen_ids[base_id]}"
            stats["duplicate_section_ids"] += 1

        parts = split_text(r["section_text"])
        for k, part in enumerate(parts):
            body = part
            if k == len(parts) - 1 and r["section_footnotes"]:
                body += f"\nNotes: {r['section_footnotes']}"
            rec = {
                "id": base_id + (f"-p{k+1}" if len(parts) > 1 else ""),
                "act_title": r["act_title"], "act_no": r["act_no"],
                "act_year": r["act_year"], "publication_date": r["publication_date"],
                "chapter_no": r["chapter_no"], "chapter_title": r["chapter_title"],
                "section_no": r["section_no"], "section_title": r["section_title"],
                "part": k + 1, "parts_total": len(parts),
                "text": f"{header}\n{body}",
            }
            records.append(rec)
        if len(parts) > 1:
            stats["sections_split"] += 1

    with open(out_path, "w", encoding="utf-8") as out:
        for rec in records:
            out.write(json.dumps(rec, ensure_ascii=False) + "\n")

    with open(stem + "_skipped_rows.json", "w", encoding="utf-8") as f:
        json.dump(skipped, f, ensure_ascii=False, indent=2)

    # ------------------------- report -------------------------
    lens = [len(r["text"]) for r in records]
    acts_seen = {(r["act_title"], r["act_year"]) for r in records}
    print("=" * 50)
    print(f"Input rows            : {len(acts)}")
    print(f"Distinct acts         : {len(acts_seen)}")
    print(f"Chunks written        : {len(records)}  -> {out_path}")
    print(f"Sections split in >1  : {stats['sections_split']}")
    print(f"Empty-text rows       : {stats['empty_text']}  -> {stem}_skipped_rows.json")
    print(f"Exact duplicates removed       : {stats['exact_duplicates_removed']}")
    print(f"Same section no, different text: {stats['duplicate_section_ids']} (kept both - review)")
    for c in conflicts:
        print("  -", c)
    if lens:
        print(f"Chunk length min/avg/max: {min(lens)} / {sum(lens)//len(lens)} / {max(lens)}")

    short = [r for r in records if len(r["text"]) < 120]
    print(f"\nVery short chunks (<120 chars): {len(short)}")
    for r in short[:8]:
        print("  -", r["id"], "|", r["text"][-60:].replace("\n", " "))

    sus = [r for r in records if SUSPECT.search(r["text"])]
    print(f"\nChunks still containing suspicious characters: {len(sus)}")
    for r in sus[:8]:
        m = SUSPECT.search(r["text"])
        s = max(0, m.start() - 30)
        print("  -", r["id"], "|", r["text"][s:m.end() + 30].replace("\n", " "))

    print(f"\nGlued-word fixes applied: {sum(SPACE_FIX_LOG.values())} "
          f"({len(SPACE_FIX_LOG)} distinct) - review this list:")
    for w, c in SPACE_FIX_LOG.most_common(25):
        print(f"  {w}  x{c}")

    hy = Counter()
    for r in records:
        for w in re.findall(r"\b[A-Za-z]{2,}-[a-z]{2,}\b", r["text"]):
            hy[w] += 1
    print("\nHyphenated words (check for breaks like 'Repu-blic'; top 20):")
    for w, c in hy.most_common(20):
        print(f"  {w}  x{c}")

    if problems:
        print(f"\nProblems ({len(problems)}):")
        for p in problems[:20]:
            print("  -", p)
    print("=" * 50)


if __name__ == "__main__":
    if len(sys.argv) not in (2, 3):
        sys.exit("usage: python prepare.py laws.json [output.jsonl]")
    main(sys.argv[1], sys.argv[2] if len(sys.argv) == 3 else None)
