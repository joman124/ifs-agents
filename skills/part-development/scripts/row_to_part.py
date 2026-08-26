#!/usr/bin/env python3
"""Turn spreadsheet rows into IFS part profiles (the parts/<slug>.md format).

Standard library only. An .xlsx is a zip of XML, so there is nothing to
install - which matters, because this script has to run wherever the person
happens to be working, not only where pandas happens to exist.

    python3 row_to_part.py inspect  parts.xlsx
    python3 row_to_part.py convert  parts.xlsx --row 4 --out parts/
    python3 row_to_part.py convert  parts.xlsx --all --out parts/
    python3 row_to_part.py check    parts/the-critic.md

`inspect` first, always: it prints the tables it found, which row it read as
the header, and how every column was mapped - including the ones it could not
place. Reading that before converting is what keeps a wrong guess from being
written into somebody's profile as if the part had said it.

Mappings can be corrected without editing this file:

    --map "Where I feel it=location" --map "Old label=ignore"
"""

import argparse
import csv
import datetime as _dt
import os
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

# ---------------------------------------------------------------- vocabulary

CATEGORIES = [
    "introduction", "history_origin", "emotions_feelings", "beliefs_motivations",
    "relationships", "communication_needs", "positive_intent", "changes_healing",
    "integration_harmony",
]
PART_TYPES = ["manager", "firefighter", "exile", "unknown"]
TRUST_LEVELS = ["unknown", "none", "low", "growing", "high"]
EDGE_TYPES = ["protects", "protected-by", "polarized-with", "allied-with", "conflicts-with"]
SCALARS = ["name", "type", "age", "location", "appearance", "origin",
           "positive_intent", "unburdened_vision", "trust_in_self"]
LISTS = ["emotions", "fears", "hopes_goals", "behaviors", "wants_needs"]
NARRATIVE_SECTIONS = [
    ("in_its_own_words", "In its own words"),
    ("origin_story", "Origin story"),
    ("what_activates_it", "What activates it"),
    ("relates_to_others", "How it relates to other parts"),
    ("what_it_needs", "What it needs"),
    ("session_notes", "Session notes"),
]

# Ordered: the first field whose synonyms match a header wins, so the more
# specific reading of an ambiguous word ("needs" the list vs. "what it needs
# from me" the section) is settled by position rather than by luck.
SYNONYMS = [
    ("name", ["name", "part name", "part", "the part", "part title", "called",
              "what it calls itself", "who", "who is this part"]),
    ("type", ["type", "part type", "kind", "manager firefighter exile",
              "protector or exile", "role type"]),
    ("age", ["age", "felt age", "how old", "age of part", "how old is it"]),
    ("location", ["location", "where in the body", "body location", "where it lives",
                  "where do you feel it", "where i feel it", "where felt", "body",
                  "embodiment", "where in body", "felt location", "where it sits",
                  "where it shows up in the body"]),
    ("appearance", ["appearance", "what it looks like", "looks like", "image",
                    "how it presents", "visual", "form", "what does it look like"]),
    ("n:origin_story", ["origin story", "backstory", "full history", "how it came to be",
                        "the story", "history story"]),
    ("origin", ["origin", "when did it start", "first appeared", "when it appeared",
                "beginning", "history", "when did this part start", "started"]),
    ("emotions", ["emotions", "emotion", "feelings", "feeling", "emotions feelings",
                  "what it feels", "affect", "emotions and feelings"]),
    ("fears", ["fears", "fear", "afraid of", "what it is afraid of", "worries",
               "concerns", "what is it afraid of", "fears concerns",
               "what would happen if it stopped"]),
    ("hopes_goals", ["hopes goals", "hopes and goals", "hope goal", "hopes", "goals",
                     "hope", "goal", "what it hopes for", "aims", "wishes",
                     "hopes for", "hope/goal"]),
    ("behaviors", ["behaviors", "behaviours", "behavior", "behaviour", "what it does",
                   "actions", "strategies", "how it acts", "its job", "job",
                   "what it does when activated"]),
    ("n:what_activates_it", ["what activates it", "triggers", "trigger", "activation",
                             "when it shows up", "what sets it off", "when it activates",
                             "when does it show up"]),
    ("enemies", ["enemies", "enemy", "who it fights", "opposed by", "adversaries",
                 "in conflict with", "polarized with", "polarised with"]),
    ("allies", ["allies", "ally", "friends", "who it works with", "allied with",
                "supporters", "gets along with"]),
    ("protects", ["protects", "who it protects", "protecting", "stands in front of",
                  "guards"]),
    ("protected_by", ["protected by", "who protects it", "shielded by",
                      "who stands in front of it"]),
    ("relationships", ["relationships", "relationship", "related parts", "connections",
                       "links", "other parts", "relations"]),
    ("n:relates_to_others", ["how it relates to other parts", "relationship notes",
                             "dynamics", "relates to others", "with other parts"]),
    ("wants_needs", ["wants needs", "wants and needs", "wants/needs", "wants", "needs",
                     "what it wants", "asks", "requests", "needs wants", "what it needs from me"]),
    ("n:what_it_needs", ["what it needs", "unmet needs", "needs from self",
                         "what it needs section"]),
    ("positive_intent", ["positive intent", "positive intention", "intent", "intention",
                         "protective intent", "how it helps", "what it is trying to do",
                         "purpose", "why it does this", "protects by", "its job is to"]),
    ("unburdened_vision", ["unburdened", "unburdened vision", "unburdened role",
                           "if it did not have to", "what it would do instead",
                           "released", "without the role", "if it were free"]),
    ("trust_in_self", ["trust in self", "trust", "trusts self", "trust level",
                       "self trust", "does it trust self"]),
    ("n:in_its_own_words", ["in its own words", "own words", "quotes", "quote",
                            "what it says", "verbatim", "its words", "voice"]),
    ("n:session_notes", ["session notes", "notes", "note", "comments", "observations",
                         "journal", "log", "remarks"]),
]

# Which fields feed which coverage category. Mirrors the app's own reading of
# the profile, so the flags this writes and the ring the app draws agree.
COVERAGE_EVIDENCE = {
    "introduction": ["name", "type", "age", "location", "appearance", "n:in_its_own_words"],
    "history_origin": ["origin", "n:origin_story"],
    "emotions_feelings": ["emotions", "n:what_activates_it"],
    "beliefs_motivations": ["fears", "hopes_goals", "behaviors"],
    "relationships": ["relationships", "enemies", "allies", "protects", "protected_by",
                      "n:relates_to_others"],
    "communication_needs": ["wants_needs", "n:what_it_needs"],
    "positive_intent": ["positive_intent"],
    "changes_healing": ["unburdened_vision"],
    "integration_harmony": ["trust_in_self", "n:relates_to_others"],
}

DECLINED_RE = re.compile(
    r"^\s*(declined|decline|refused|won'?t say|would not say|wouldn'?t say|"
    r"not willing|no comment|prefer not|n/?a - declined)\b", re.I)
EMPTY_RE = re.compile(r"^\s*(n/?a|none|-{1,3}|\?+|tbd|unknown|not sure|blank|nil)\s*$", re.I)


def norm(s):
    """Header text down to comparable words: 'Wants / Needs (list)' -> 'wants needs'."""
    s = str(s or "").lower()
    s = re.sub(r"\(.*?\)", " ", s)          # drop parenthetical hints
    s = s.replace("&", " and ")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = re.sub(r"\b(the|a|an|of|for|its|it s|your|my|this|part s)\b", " ", s)
    return re.sub(r"\s+", " ", s).strip()


# ------------------------------------------------------------------ reading

def _local(tag):
    return tag.split("}")[-1]


def _col_index(ref):
    """'BC12' -> 54 (0-based column)."""
    n = 0
    for ch in ref:
        if not ch.isalpha():
            break
        n = n * 26 + (ord(ch.upper()) - 64)
    return n - 1


DATE_FMT_IDS = set(list(range(14, 23)) + list(range(45, 48)))


def _read_xlsx(path, want_sheet=None):
    """-> (sheet_name, [(row_number, [cell, ...]), ...], [all sheet names])"""
    with zipfile.ZipFile(path) as z:
        names = z.namelist()

        shared = []
        if "xl/sharedStrings.xml" in names:
            for si in ET.fromstring(z.read("xl/sharedStrings.xml")):
                shared.append("".join(t.text or "" for t in si.iter()
                                      if _local(t.tag) == "t"))

        date_styles = set()
        if "xl/styles.xml" in names:
            styles = ET.fromstring(z.read("xl/styles.xml"))
            custom = {}
            for nf in styles.iter():
                if _local(nf.tag) == "numFmt":
                    custom[int(nf.get("numFmtId"))] = nf.get("formatCode", "")
            xfs = [x for x in styles.iter() if _local(x.tag) == "cellXfs"]
            if xfs:
                for i, xf in enumerate([c for c in xfs[0] if _local(c.tag) == "xf"]):
                    fid = int(xf.get("numFmtId", 0))
                    code = custom.get(fid, "")
                    if fid in DATE_FMT_IDS or re.search(r"[dy]", code.split(";")[0] or "",):
                        if fid in DATE_FMT_IDS or re.search(r"(yy|dd|mmm)", code):
                            date_styles.add(i)

        rels = {}
        if "xl/_rels/workbook.xml.rels" in names:
            for r in ET.fromstring(z.read("xl/_rels/workbook.xml.rels")):
                rels[r.get("Id")] = r.get("Target")

        sheets = []
        wb = ET.fromstring(z.read("xl/workbook.xml"))
        for sh in wb.iter():
            if _local(sh.tag) != "sheet":
                continue
            rid = next((v for k, v in sh.attrib.items() if k.endswith("}id")), None)
            target = rels.get(rid, "")
            target = target[1:] if target.startswith("/") else "xl/" + target.lstrip("/")
            sheets.append((sh.get("name"), target))

        if not sheets:
            raise SystemExit("No sheets found in " + path)
        chosen = sheets[0]
        if want_sheet:
            for s in sheets:
                if norm(s[0]) == norm(want_sheet):
                    chosen = s
                    break
            else:
                raise SystemExit("No sheet named %r. Sheets: %s"
                                 % (want_sheet, ", ".join(s[0] for s in sheets)))

        rows = []
        for row in ET.fromstring(z.read(chosen[1])).iter():
            if _local(row.tag) != "row":
                continue
            cells = {}
            for c in row:
                if _local(c.tag) != "c":
                    continue
                cells[_col_index(c.get("r", "A1"))] = _cell_value(c, shared, date_styles)
            if not cells:
                rows.append((int(row.get("r", len(rows) + 1)), []))
                continue
            width = max(cells) + 1
            rows.append((int(row.get("r", len(rows) + 1)),
                         [cells.get(i, "") for i in range(width)]))
        return chosen[0], rows, [s[0] for s in sheets]


def _cell_value(c, shared, date_styles):
    t = c.get("t", "n")
    text = ""
    for kid in c:
        if _local(kid.tag) == "v":
            text = kid.text or ""
        elif _local(kid.tag) == "is":
            text = "".join(x.text or "" for x in kid.iter() if _local(x.tag) == "t")
    if t == "s" and text.strip().isdigit():
        idx = int(text)
        return shared[idx] if idx < len(shared) else ""
    if t == "b":
        return "yes" if text.strip() == "1" else "no"
    if t in ("str", "inlineStr", "e"):
        return text
    if text and re.fullmatch(r"-?\d+(\.\d+)?", text.strip()):
        num = float(text)
        try:
            if int(c.get("s", -1)) in date_styles and num > 0:
                base = _dt.date(1899, 12, 30)  # Excel's serial epoch
                return (base + _dt.timedelta(days=int(num))).isoformat()
        except (ValueError, OverflowError):
            pass
        return str(int(num)) if num == int(num) else text
    return text


def _read_csv(path):
    delim = "\t" if path.lower().endswith((".tsv", ".tab")) else ","
    with open(path, newline="", encoding="utf-8-sig") as fh:
        rows = [(i + 1, r) for i, r in enumerate(csv.reader(fh, delimiter=delim))]
    return os.path.basename(path), rows, [os.path.basename(path)]


def read_grid(path, sheet=None, transpose=False):
    if path.lower().endswith((".csv", ".tsv", ".tab", ".txt")):
        name, rows, sheets = _read_csv(path)
    else:
        name, rows, sheets = _read_xlsx(path, sheet)
    if transpose:
        rows = _transpose(rows)
    return name, rows, sheets


def _transpose(rows):
    """Some sheets run the other way: field names down column A, one part per
    column. Same table, rotated - so rotate it back rather than asking the
    person to restructure their spreadsheet."""
    width = max([len(c) for _, c in rows] + [0])
    return [(i + 1, [(cells[i] if i < len(cells) else "") for _, cells in rows])
            for i in range(width)]


def col_index(ref):
    """'C' or '3' -> 3. Lets --col take whatever the person reads off the sheet."""
    ref = str(ref).strip()
    if ref.isdigit():
        return int(ref)
    n = 0
    for ch in ref:
        if not ch.isalpha():
            break
        n = n * 26 + (ord(ch.upper()) - 64)
    return n


def col_letter(n):
    """1 -> A. Used to name what was read when the sheet was transposed."""
    out = ""
    while n > 0:
        n, r = divmod(n - 1, 26)
        out = chr(65 + r) + out
    return out or "A"


# ------------------------------------------------- finding the actual table

def _blank(cells):
    return not any(str(c).strip() for c in cells)


def find_tables(rows):
    """Split a sheet into blocks and read a header row out of each.

    A sheet is rarely one clean table. There is a title, a legend, a scratch
    block off to the side, then the real thing. Blocks are separated by blank
    rows; within a block the header is whichever of the first few rows names
    the most known fields, and single-cell rows above it are read as the
    table's title - which is usually what says which table this is.
    """
    blocks, current = [], []
    for rownum, cells in rows:
        if _blank(cells):
            if current:
                blocks.append(current)
                current = []
        else:
            current.append((rownum, cells))
    if current:
        blocks.append(current)

    # A one-cell block sitting above a table is its title - which is usually
    # the label that says which of several tables on a sheet this is.
    merged, pending = [], ""
    for block in blocks:
        if len(block) == 1 and len([c for c in block[0][1] if str(c).strip()]) == 1:
            pending = str(next(c for c in block[0][1] if str(c).strip())).strip()
            continue
        merged.append((pending, block))
        pending = ""
    blocks = merged

    tables = []
    for pretitle, block in blocks:
        best, best_score = None, 0
        for i, (rownum, cells) in enumerate(block[:4]):
            filled = [c for c in cells if str(c).strip()]
            if len(filled) < 2:
                continue
            score = sum(1 for c in cells if match_field(c)[0])
            # a header labels columns: short cells, few of them prose
            score += sum(0.25 for c in filled if len(str(c).strip()) <= 30)
            if score > best_score:
                best, best_score = i, score
        if best is None:
            continue
        title = " / ".join([t for t in [pretitle] if t] +
                           [str(c).strip() for r, cells in block[:best]
                            for c in cells if str(c).strip()])
        tables.append({
            "title": title,
            "header_row": block[best][0],
            "headers": [str(c).strip() for c in block[best][1]],
            "data": block[best + 1:],
            "score": round(best_score, 2),
        })
    tables.sort(key=lambda t: -t["score"])
    return tables


def match_field(header, overrides=None):
    """-> (field or None, how) for one column heading."""
    h = norm(header)
    if not h:
        return None, "empty"
    if overrides:
        for raw, field in overrides.items():
            if norm(raw) == h:
                return field, "override"   # including the sentinel "ignore"
    for field, words in SYNONYMS:
        if h in [norm(w) for w in words]:
            return field, "exact"
    hw = set(h.split())
    best, best_overlap = None, 0
    for field, words in SYNONYMS:
        for w in words:
            wn = set(norm(w).split())
            if not wn:
                continue
            overlap = len(hw & wn) / max(len(wn), 1)
            if overlap > best_overlap and (hw & wn):
                best, best_overlap = field, overlap
    if best_overlap >= 0.75:
        return best, "fuzzy"
    return None, "unmapped"


# ------------------------------------------------------------ row -> profile

def clean(v):
    v = str(v or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    return "" if EMPTY_RE.match(v) else v


def one_line(v):
    return re.sub(r"\s+", " ", clean(v)).strip()


def split_items(v):
    """A cell holding several things -> a list, without shredding prose.

    Newlines, semicolons and bullets are deliberate separators. Commas are
    not: "keep the person safe, whatever it costs" is one need, not two - so
    a comma only splits when every piece it produces is short enough to be a
    label rather than a sentence.
    """
    v = clean(v)
    if not v:
        return []
    parts = [p for p in re.split(r"\n+|;|•|(?<!\w)\|(?!\w)", v)]
    parts = [re.sub(r"^\s*(?:[-*–—]|\d+[.)])\s+", "", p).strip() for p in parts]
    parts = [p for p in parts if p]
    if len(parts) == 1 and "," in v:
        # "shame, loneliness" is two feelings; "if I stop checking, we get
        # humiliated" is one fear with a comma in it. Labels are short and
        # few-worded, clauses are not - so only split when every piece still
        # reads as a label.
        pieces = [p.strip() for p in v.split(",") if p.strip()]
        if len(pieces) > 1 and all(len(x) <= 24 and len(x.split()) <= 3 for x in pieces):
            return pieces
    return parts


def norm_enum(value, allowed, extra=None):
    """-> (value, leftover) - leftover is text worth keeping somewhere else.

    Deliberately not routed through clean(): "none" and "unknown" are answers
    here, not the placeholder text they are in a free-text cell."""
    v = re.sub(r"\s+", " ", str(value or "")).strip()
    if not v:
        return allowed[0] if allowed[0] == "unknown" else "", ""
    low = v.lower()
    for a in allowed:
        if low == a or low.startswith(a):
            return a, ""
    for pattern, mapped in (extra or {}).items():
        if re.search(pattern, low):
            return mapped, v
    return ("unknown" if "unknown" in allowed else ""), v


TYPE_HINTS = {r"\bfire ?fighter\b": "firefighter", r"\bmanag": "manager",
              r"\bexile\b|\bexiled\b|\byoung\b": "exile"}
# "medium" and "some" are deliberately absent: growing is a claim that trust
# is increasing over time, which a middling tick-box does not say.
TRUST_HINTS = {r"\bhigh\b|\bfull\b|\bcomplete\b": "high",
               r"\bgrow|\bincreas|\bbuilding\b": "growing",
               r"\blow\b|\blittle\b|\bwary\b": "low",
               r"\bnone\b|\bno trust\b|\bzero\b": "none"}


def slugify(name):
    s = re.sub(r"['\".,!?()]", "", str(name or "").lower().strip())
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "unnamed-part"


def blank_profile():
    p = {k: "" for k in SCALARS}
    p["type"] = "unknown"
    p["trust_in_self"] = "unknown"
    for k in LISTS:
        p[k] = []
    p["relationships"] = []
    p["coverage"] = {c: "untouched" for c in CATEGORIES}
    p["sessions"] = []
    p["narrative"] = {k: "" for k, _ in NARRATIVE_SECTIONS}
    return p


def build_profile(headers, cells, mapping, source_note, date, mode="intake"):
    """One spreadsheet row -> one profile dict, plus notes on what happened."""
    p = blank_profile()
    filled = set()
    declined = set()
    leftovers = []      # (header, value) - real content with nowhere schema-shaped to go
    warnings = []

    def cell(i, keep_placeholders=False):
        v = str(cells[i] or "") if i < len(cells) else ""
        v = v.replace("\r\n", "\n").replace("\r", "\n").strip()
        # "none" is a real trust level and "unknown" a real type, so the
        # placeholder filter that empties "n/a" elsewhere must not run here
        return v if keep_placeholders else ("" if EMPTY_RE.match(v) else v)

    for i, header in enumerate(headers):
        field = mapping.get(i)
        edges_before = len(p["relationships"])
        raw = cell(i, keep_placeholders=field in ("type", "trust_in_self"))
        if not raw:
            continue
        if field == "ignore":
            continue
        if field is None:
            leftovers.append((header or "column %d" % (i + 1), raw))
            continue
        if DECLINED_RE.match(raw):
            declined.add(field)
            leftovers.append((header, raw))
            continue

        if field == "type":
            p["type"], extra = norm_enum(raw, PART_TYPES, TYPE_HINTS)
            if extra:
                leftovers.append((header, raw))
                warnings.append("type %r is not one of %s - left as %s and kept in the notes"
                                % (raw, "/".join(PART_TYPES), p["type"]))
        elif field == "trust_in_self":
            p["trust_in_self"], extra = norm_enum(raw, TRUST_LEVELS, TRUST_HINTS)
            if extra:
                leftovers.append((header, raw))
        elif field == "origin":
            # The schema wants one line here and the story below; a paragraph
            # in this cell is the story, so it goes to both places rather than
            # being crushed into an unreadable frontmatter value.
            line = one_line(raw)
            p["origin"] = line if len(line) <= 200 else line[:line[:200].rfind(" ")] + "..."
            if len(line) > 200 and not p["narrative"]["origin_story"]:
                p["narrative"]["origin_story"] = clean(raw)
        elif field in SCALARS:
            p[field] = one_line(raw)
        elif field in LISTS:
            p[field] = split_items(raw)
        elif field in ("enemies", "allies", "protects", "protected_by", "relationships"):
            edges, notes = parse_edges(field, raw)
            p["relationships"].extend(edges)
            if notes:
                leftovers.append((header, notes))
        elif field.startswith("n:"):
            key = field[2:]
            existing = p["narrative"][key]
            p["narrative"][key] = (existing + "\n\n" + clean(raw)).strip() if existing else clean(raw)

        # A cell counts as answered only if something landed in the profile.
        # "protector" in a type column reads as filled and lands as unknown,
        # and a coverage flag raised on that is a claim nothing supports.
        if field.startswith("n:"):
            landed = bool(p["narrative"][field[2:]])
        elif field in ("type", "trust_in_self"):
            landed = p[field] not in ("", "unknown")
        elif field in SCALARS:
            landed = bool(p[field])
        elif field in LISTS:
            landed = bool(p[field])
        else:
            landed = len(p["relationships"]) > edges_before
        if landed:
            filled.add(field)

    if not p["name"]:
        warnings.append("no name column found or the name cell was empty - "
                        "the app will show this part as unnamed until it is given one")

    # Coverage: content recorded is honestly `partial`. `complete` is a claim
    # about an interview that a spreadsheet cannot make, so it is never set here.
    for cat, fields in COVERAGE_EVIDENCE.items():
        if any(f in filled for f in fields):
            p["coverage"][cat] = "partial"
        elif any(f in declined for f in fields):
            # declined only stands for a category nothing else in the row
            # answered - a part that skipped one question still spoke
            p["coverage"][cat] = "declined"

    if leftovers:
        block = ["**%s (%s)** - columns this profile has no field for, kept verbatim:"
                 % (date, source_note)]
        for header, value in leftovers:
            block.append("- **%s:** %s" % (header, one_line(value)))
        existing = p["narrative"]["session_notes"]
        p["narrative"]["session_notes"] = ((existing + "\n\n" if existing else "") + "\n".join(block))

    p["sessions"].append({
        "date": date,
        "mode": mode,
        "categories": [c for c in CATEGORIES if p["coverage"][c] in ("partial", "complete")],
        "note": "imported from " + source_note,
    })
    return p, warnings, leftovers


EDGE_DEFAULTS = {"enemies": "conflicts-with", "allies": "allied-with",
                 "protects": "protects", "protected_by": "protected-by"}


def parse_edges(field, raw):
    """Cells naming other parts -> relationship edges.

    'enemies' becomes conflicts-with rather than polarized-with on purpose:
    polarization is a strong claim about two parts escalating each other, and
    a column heading is not enough to make it. A mapping session can upgrade it.
    """
    edges, unparsed = [], []
    for item in split_items(raw):
        m = re.match(r"^(.*?)\s*[:—–-]{1,2}\s*(protects|protected[ -]by|polari[sz]ed[ -]with|"
                     r"allied[ -]with|conflicts?[ -]with|ally|enemy)\b\s*[:—–-]?\s*(.*)$",
                     item, re.I)
        if m and field == "relationships":
            other, kind, note = m.group(1), m.group(2).lower(), m.group(3)
            kind = {"ally": "allied-with", "enemy": "conflicts-with",
                    "conflict-with": "conflicts-with"}.get(kind, kind.replace(" ", "-"))
            kind = kind.replace("polarised", "polarized")
            if kind not in EDGE_TYPES:
                unparsed.append(item)
                continue
            edges.append({"part": slugify(other), "type": kind, "notes": one_line(note)})
        elif field == "relationships":
            # no type given: recording an edge type nobody stated would be an
            # invention, and the app drops unknown types anyway
            unparsed.append(item)
        else:
            other, _, note = item.partition(" - ")
            edges.append({"part": slugify(other), "type": EDGE_DEFAULTS[field],
                          "notes": one_line(note)})
    return edges, "; ".join(unparsed)


# --------------------------------------------------------------- serializing

def ystr(v):
    v = "" if v is None else str(v)
    if v == "":
        return ""
    if re.search(r"[:#\[\]{}&*!|>'\"%@`\n]", v) or v != v.strip() or v.startswith("-"):
        return '"' + v.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return v


def ylist(items, indent="  "):
    if not items:
        return " []"
    return "\n" + "\n".join(indent + "- " + ystr(i) for i in items)


def serialize(p):
    """Frontmatter in schema field order, then the six sections. The order is
    not cosmetic: the app diffs profiles as text, and a reshuffled file reads
    as a rewrite of a part that did not change."""
    out = ["---", "name: " + ystr(p["name"]), "type: " + (p["type"] or "unknown"),
           "age: " + ystr(p["age"]), "location: " + ystr(p["location"]),
           "appearance: " + ystr(p["appearance"]), "origin: " + ystr(p["origin"])]
    for k in LISTS:
        out.append(k + ":" + ylist(p[k]))
    out.append("positive_intent: " + ystr(p["positive_intent"]))
    out.append("unburdened_vision: " + ystr(p["unburdened_vision"]))
    out.append("trust_in_self: " + (p["trust_in_self"] or "unknown"))
    if p["relationships"]:
        out.append("relationships:")
        for r in p["relationships"]:
            out.append("  - part: " + ystr(r["part"]))
            out.append("    type: " + r["type"])
            out.append("    notes: " + ystr(r.get("notes", "")))
    else:
        out.append("relationships: []")
    out.append("coverage:")
    for c in CATEGORIES:
        out.append("  %s: %s" % (c, p["coverage"].get(c, "untouched")))
    if p["sessions"]:
        out.append("sessions:")
        for s in p["sessions"]:
            out.append("  - date: " + s["date"])
            out.append("    mode: " + s["mode"])
            out.append("    categories: [" + ", ".join(s.get("categories", [])) + "]")
            out.append("    note: " + ystr(s.get("note", "")))
    else:
        out.append("sessions: []")
    out.append("---")
    out.append("")
    out.append("# " + (p["name"] or "(unnamed)"))
    for key, title in NARRATIVE_SECTIONS:
        out.append("")
        out.append("## " + title)
        out.append("")
        body = (p["narrative"].get(key) or "").strip()
        if body:
            out.append(body)
    out.append("")
    return "\n".join(line.rstrip() for line in out)


# -------------------------------------------------------------- reading back

def check(path):
    """Re-read a profile the way the app's importer does, and say what it sees."""
    text = open(path, encoding="utf-8").read()
    text = re.sub(r"^﻿?\s*(?:<!--[\s\S]*?-->\s*)+", "", text)
    m = re.match(r"^\s*---[ \t]*\r?\n([\s\S]*?)\r?\n---\s*\r?\n?([\s\S]*)$", text)
    problems, seen = [], {}
    if not m:
        return ["no YAML frontmatter - the app would refuse this file"], {}
    fm, body = m.group(1), m.group(2)

    for line in fm.split("\n"):
        km = re.match(r"^([A-Za-z_][A-Za-z0-9_]*):\s*(.*)$", line)
        if km:
            seen[km.group(1)] = km.group(2).strip()
    if not seen.get("name"):
        problems.append("no name value - the app imports this as '(unnamed part)'")
    if seen.get("type", "unknown") not in PART_TYPES:
        problems.append("type %r is not one of %s - the app resets it to unknown"
                        % (seen.get("type"), "/".join(PART_TYPES)))
    if seen.get("trust_in_self", "unknown") not in TRUST_LEVELS:
        problems.append("trust_in_self %r is not a known level - the app resets it"
                        % seen.get("trust_in_self"))
    for cov in re.findall(r"^\s{2}(\w+):\s*(\w+)\s*$", fm, re.M):
        if cov[0] in CATEGORIES and cov[1] not in ("untouched", "partial", "complete", "declined"):
            problems.append("coverage.%s = %r is not a status the app knows" % cov)
    for kind in re.findall(r"^\s+type:\s*(\S+)\s*$", fm, re.M):
        if kind not in EDGE_TYPES and kind not in PART_TYPES:
            problems.append("relationship type %r is not one of %s - the app drops that edge"
                            % (kind, "/".join(EDGE_TYPES)))
    for line in fm.split("\n"):
        v = line.split(":", 1)[1].strip() if ":" in line else ""
        if v and not v.startswith(('"', "'", "[", "-")) and ":" in v:
            problems.append("value on %r has an unquoted colon and would be cut short"
                            % line.strip()[:60])
    titles = re.findall(r"^##\s+(.+?)\s*$", body, re.M)
    for _, title in NARRATIVE_SECTIONS:
        if title not in titles:
            problems.append("missing section '## %s' - the app expects all six, in order" % title)
    for t in titles:
        if t not in [x[1] for x in NARRATIVE_SECTIONS]:
            problems.append("section '## %s' is not part of the format - the app would drop it" % t)
    return problems, seen


# ------------------------------------------------------------------ commands

def resolve_mapping(headers, overrides):
    mapping, report = {}, []
    used = {}
    for i, h in enumerate(headers):
        field, how = match_field(h, overrides)
        if field and field != "ignore" and field in used and not field.startswith("n:"):
            report.append((h, field, "duplicate of column %s - merged" % used[field]))
            mapping[i] = field
            continue
        mapping[i] = field
        if field and field != "ignore":
            used[field] = h or "col %d" % (i + 1)
        report.append((h, field, how))
    return mapping, report


def cmd_inspect(args):
    sheet, rows, sheets = read_grid(args.path, args.sheet, args.transpose)
    unit = "column" if args.transpose else "row"
    tables = find_tables(rows)
    print("File:   %s" % args.path)
    print("Sheets: %s (reading %r)" % (", ".join(sheets), sheet))
    if not tables:
        print("\nNo table found - no row in this sheet reads as column headings.")
        return
    for n, t in enumerate(tables):
        print("\n--- table %d%s" % (n + 1, (": " + t["title"]) if t["title"] else ""))
        print("    header %s %s, %d data %ss, match score %s%s"
              % (unit, (col_letter(t["header_row"]) if args.transpose else t["header_row"]),
                 len(t["data"]), unit, t["score"],
                 "   <- best match for a part profile" if n == 0 else ""))
        mapping, report = resolve_mapping(t["headers"], parse_overrides(args.map))
        for h, field, how in report:
            print("      %-28s -> %s%s" % ((h or "(blank)")[:28],
                                           "IGNORED" if field == "ignore" else
                                           (field or "UNMAPPED (kept in Session notes)"),
                                           "" if how in ("exact", "override") else "  [%s]" % how))
        if n == 0:
            print("    %ss:" % unit)
            for rownum, cells in t["data"][:25]:
                first = next((clean(c) for c in cells if clean(c)), "(blank)")
                print("      %s %-4s %s" % (unit, col_letter(rownum) if args.transpose
                                            else rownum, first[:60]))
            if len(t["data"]) > 25:
                print("      ... %d more" % (len(t["data"]) - 25))


def parse_overrides(pairs):
    out = {}
    for p in pairs or []:
        if "=" not in p:
            raise SystemExit("--map needs the form \"Column heading=field\", got %r" % p)
        k, v = p.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def cmd_convert(args):
    sheet, rows, _ = read_grid(args.path, args.sheet, args.transpose)
    tables = find_tables(rows)
    if not tables:
        raise SystemExit("No header row found - run `inspect` and pass --header-row.")
    table = tables[0]
    if args.table:
        for t in tables:
            if norm(args.table) in norm(t["title"]) or str(t["header_row"]) == args.table:
                table = t
                break
    if args.header_row:
        table = next((t for t in tables if t["header_row"] == args.header_row), table)

    mapping, report = resolve_mapping(table["headers"], parse_overrides(args.map))
    unmapped = [h for h, f, _ in report if not f and h]   # "ignore" is not unmapped
    date = args.date or _dt.date.today().isoformat()

    wanted = list(args.row or []) + [col_index(c) for c in (args.col or [])]
    targets = [(n, c) for n, c in table["data"] if n in wanted] if wanted else \
              ([(n, c) for n, c in table["data"] if any(clean(x) for x in c)] if args.all else [])
    if not targets:
        raise SystemExit("Nothing to convert: pass --row N (spreadsheet row numbers) or --all.")

    os.makedirs(args.out, exist_ok=True)
    for rownum, cells in targets:
        base = os.path.basename(args.path)
        where = ("column " + col_letter(rownum)) if args.transpose else ("row %d" % rownum)
        note = ("%s, %s" % (base, where) if sheet == base
                else "%s, sheet %s, %s" % (base, sheet, where))
        p, warnings, leftovers = build_profile(table["headers"], cells, mapping, note, date, args.mode)
        slug = slugify(p["name"]) if p["name"] else "unnamed-part-%d" % rownum
        dest = os.path.join(args.out, slug + ".md")
        if os.path.exists(dest) and not args.force:
            print("SKIPPED %s: %s already exists (use --force to overwrite, but a "
                  "profile grows over time - merging by hand is usually right)" % (where, dest))
            continue
        with open(dest, "w", encoding="utf-8") as fh:
            fh.write(serialize(p))
        print("\n%s -> %s" % (where, dest))
        print("  name: %s | type: %s | coverage: %s"
              % (p["name"] or "(none)", p["type"],
                 ", ".join(c for c in CATEGORIES if p["coverage"][c] != "untouched") or "none"))
        if unmapped:
            print("  unmapped columns kept in Session notes: " + ", ".join(unmapped))
        for w in warnings:
            print("  ! " + w)
        problems, _ = check(dest)
        for pr in problems:
            print("  ! " + pr)


def cmd_check(args):
    problems, seen = check(args.path)
    print("%s: name=%r type=%r trust=%r"
          % (args.path, seen.get("name", ""), seen.get("type", ""), seen.get("trust_in_self", "")))
    if problems:
        for p in problems:
            print("  ! " + p)
        sys.exit(1)
    print("  reads back cleanly - the app will import this as written")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    i = sub.add_parser("inspect", help="show tables, header rows and column mapping")
    i.add_argument("path")
    i.add_argument("--sheet")
    i.add_argument("--map", action="append", help='"Column heading=field" (repeatable)')
    i.add_argument("--transpose", action="store_true",
                   help="the sheet runs the other way: field names down column A, one part per column")
    i.set_defaults(func=cmd_inspect)

    c = sub.add_parser("convert", help="write parts/<slug>.md from one or more rows")
    c.add_argument("path")
    c.add_argument("--sheet")
    c.add_argument("--row", type=int, action="append",
                   help="spreadsheet row number, as shown by inspect (repeatable)")
    c.add_argument("--col", action="append",
                   help="with --transpose: which column to convert, by letter or number (repeatable)")
    c.add_argument("--all", action="store_true", help="every data row in the table")
    c.add_argument("--table", help="table title or header row number, when the sheet holds several")
    c.add_argument("--header-row", type=int)
    c.add_argument("--out", default="parts")
    c.add_argument("--map", action="append", help='"Column heading=field" (repeatable)')
    c.add_argument("--date", help="session date to record (default: today)")
    c.add_argument("--mode", default="intake", choices=["intake", "checkin", "mapping", "meeting"])
    c.add_argument("--transpose", action="store_true",
                   help="the sheet runs the other way: field names down column A, one part per column")
    c.add_argument("--force", action="store_true", help="overwrite an existing profile")
    c.set_defaults(func=cmd_convert)

    k = sub.add_parser("check", help="re-read a profile the way the app's importer does")
    k.add_argument("path")
    k.set_defaults(func=cmd_check)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
