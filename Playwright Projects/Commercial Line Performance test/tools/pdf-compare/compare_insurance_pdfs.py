"""
PDF Comparison Tool  (Generic – works with any document type)
=============================================================
Scans a root directory of sub-folders, finds PDF pairs in each folder,
compares them from the first meaningful document header onward, and writes
one consolidated Excel workbook.

Key behaviours
--------------
* Comparison starts at the first recognised document header on each file.
* First 4 lines of every page are dropped (header/footer overlay text).
* Known boilerplate/watermark lines (e.g. OpenText Exstream) are stripped.
* Section boundaries are detected from BOLD font lines in the PDF itself
  (not from a hardcoded list), so any section header the document uses is
  automatically found – even one like "Property Schedule of Additional Interests"
  that wasn't in a predefined list.
* A hardcoded fallback list is still used when bold-detection yields nothing
  (e.g. scanned / image-only PDFs).
* Summary sheet has an inline Differences column for one-view review.

Usage
-----
  python compare_insurance_pdfs.py --input-dir "C:\\path\\CPPProposalParallel" --output results.xlsx
  python compare_insurance_pdfs.py --demo
  python compare_insurance_pdfs.py --input-dir "C:\\..." --output results.xlsx --limit 10
  python compare_insurance_pdfs.py --input-dir "C:\\flat_folder" --output results.xlsx --flat
  python compare_insurance_pdfs.py --input-dir "C:\\nested_root" --output results.xlsx --recursive
"""

import re
import sys
import argparse
from pathlib import Path
from difflib import SequenceMatcher
from collections import defaultdict

import pdfplumber
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side

# ── Document header triggers ──────────────────────────────────────────────────
# Comparison begins at the FIRST line matching any of these (case-insensitive).
DOCUMENT_HEADERS = [
    "COMMERCIAL PACKAGE POLICY PROPOSAL",
    "COMMERCIAL PACKAGE PROPOSAL",
    "APPLICATION",
    "DECLARATIONS",
    "POLICY DECLARATIONS",
    "CERTIFICATE OF INSURANCE",
    "EVIDENCE OF PROPERTY INSURANCE",
    "BINDER",
    "ENDORSEMENT",
    "SCHEDULE OF",
]

# ── Noise / boilerplate lines to strip before comparing ──────────────────────
# Any page line that CONTAINS one of these substrings (case-insensitive) is removed.
NOISE_PATTERNS = [
    "Demonstration Powered by OpenText Exstream",
    "OpenText Exstream",
    "-*-",
    "Version 23.",
    "64-bit",
]

# Lines that are noise ONLY when they are the ENTIRE line (after trim), never
# as a mere substring match - the word itself is too common/generic to add
# to NOISE_PATTERNS above (it could legitimately appear inside real section
# titles or body text elsewhere). Confirmed live: a standalone "REQUIREMENTS"
# line sits inside a recurring per-page footer (regulatory complaint-
# department notice + return-mail address) that one PDF variant renders and
# the other doesn't - not real section content - which otherwise shows up
# as a spurious "Modified" diff on every section near a page boundary.
EXACT_NOISE_LINES = {
    "requirements",
}

# Lines that are noise whenever the ENTIRE line (after trim) matches one of
# these patterns - for content whose exact text varies (a date/time stamp)
# so an exact-string set can't cover it, but the full-line shape is
# distinctive enough to be safe as a whole-line regex.
#
# Confirmed live across two document families (Michigan + Donegal), dozens
# of occurrences each: a standalone "Date: <Month D, YYYY>" line always sits
# immediately after that page's "www.<company>.com" footer URL, and a bare
# "MM/DD/YYYY HH:MM:SS" line always sits amid the same footer/demo-stamp
# block (next to form codes like "ILD N 015 01 18" or the letterhead phone
# number) - in both cases it's the PDF's own generation timestamp, not a
# business field. A real business date is always labeled with more than the
# bare word "Date" (e.g. "Effective Date:", "Policy Date:") or carries other
# text on the same line, so it can't match either pattern below.
NOISE_LINE_REGEXES = [
    re.compile(r"^\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2}$"),
    re.compile(r"^Date:\s*\w+ \d{1,2},\s*\d{4}$", re.IGNORECASE),
]

# ── Lines to drop from the TOP of every page ─────────────────────────────────
PAGE_TOP_LINES_TO_DROP = 4          # ← changed from 3 to 4

# Patterns that identify page-header/footer overlay lines (not document
# content) - company name, prepared-for/by lines, policy date/number stamps.
# Shared by clean_page_text() (strips these lines from extracted body text)
# and extract_bold_section_headers() (rejects a bold-above-blue-rect
# candidate whose TEXT matches one of these, regardless of where on the
# page it sits - see that function for why position alone isn't safe to
# use as the filter).
PAGE_HEADER_PATTERNS = [
    r"Michigan Insurance Company",
    r"COMMERCIAL PACKAGE PROPOSAL",
    r"Prepared\s+For\s*:",
    r"Prepared\s+By\s*:",
    r"Policy\s+Date\s*:",
    r"Policy\s+Number\s*:",
    r"PolicyNumber\s*:",
    r"Page\s+\d+\s+of\s+\d+",
]


def _flex_ws_pattern(s: str) -> str:
    """
    Build a regex that finds the literal string `s` in body text while
    tolerating missing or extra whitespace between its words.

    Needed because pdfplumber's extract_text() (used for all body text,
    the plain-text cross-check, and the doc-title/section-boundary search)
    sometimes drops the space between two words - confirmed live: the same
    title extracts as "Location of Described Premises" in one PDF variant
    of a document and "Location ofDescribed Premises" (no space before
    "Described") in the other. A header string discovered (bold-detected,
    or from a hardcoded list) in one variant must still be found via plain
    substring search in BOTH variants to split/align them consistently -
    an exact-whitespace match silently fails to find the boundary in
    whichever variant collapsed the space, leaving that variant's content
    merged into the section before it while the other variant splits it
    out normally. The two both end up wildly "different" from each other
    even though the underlying content matches, because they're no longer
    chunked the same way.
    """
    words = s.split()
    return r"\s*".join(re.escape(w) for w in words)


# ── Bold-font section detection settings ─────────────────────────────────────
# A line is treated as a section header if:
#  • Its dominant font is bold  AND
#  • It is between MIN and MAX characters long (avoids single words / huge titles)
#  • It does NOT look like a plain value/number line
BOLD_SECTION_MIN_CHARS = 5
BOLD_SECTION_MAX_CHARS = 120

# ── Fallback hardcoded section list (used only when bold-detection finds nothing) ──
FALLBACK_SECTION_HEADERS = [
    "Coverage Summary",
    "Common Coverage Information",
    "Named Insured Supplemental Schedule",
    "Property Coverage Information",
    "Property Schedule of Additional Interests",
    "General Liability Coverage Information",
    "Inland Marine Coverage",
    "Silver Series Property Coverage Enhancement",
    "Silver Series General Liability Coverage Enhancement",
    "General Liability Form, Coverage and Endorsement",
    "Inland Marine Form, Coverage and Endorsement",
    "Policy Forms Inventory Schedule",
]

# ── Key fields to extract ─────────────────────────────────────────────────────
KEY_FIELD_PATTERNS = {
    "Document Title":     r"((?:COMMERCIAL\s+PACKAGE|APPLICATION|DECLARATIONS|CERTIFICATE)[^\n]{0,60})",
    "Quote / Policy No":  r"(?:QUOTE|POLICY)\s+NUMBER[:\s]+(\S+)",
    "Quote Date":         r"QUOTE\s+DATE[:\s]+([\d/]+)",
    "Effective Dates":    r"PROPOSED\s+EFFECTIVE\s+DATES[:\s]+([\d/\s\-]+)",
    "Writing Company":    r"WRITING\s+COMPANY[:\s]+(.+?)(?:\n|$)",
    "Named Insured":      r"PREPARED\s+FOR[:\s\n]+([\w\s,\.&]+(?:LLC|INC|CORP|LTD|CO\b|COMPANY))",
    "Policy Date":        r"Policy\s+Date[:\s]+([\d/:\s]+)",
    "Total Premium":      r"Total\s+Policy\s+Premium[:\s]+\$([\d,]+)",
    "Property Premium":   r"Property\s+\$([\d,]+)",
    "GL Premium":         r"General\s+Liability\s+\$([\d,]+)",
    "Inland Marine Prem": r"Inland\s+Marine\s+\$([\d,]+)",
    "General Aggregate":  r"General\s+Aggregate\s+\$([\d,]+)",
    "Each Occurrence":    r"Each\s+Occurrence\s+\$([\d,]+)",
    "Building Limit":     r"Building\s+Limit\s+Of\s+Insurance[:\s]+\$([\d,]+)",
    "Garagekeepers Prem": r"Garagekeepers\s+Coverage.*?Premium[:\s]+\$([\d,]+)",
}

# ── PDF pairing hints ─────────────────────────────────────────────────────────
PAIR_HINTS = [
    ("qa", "prod"), ("qa", "production"), ("dev", "prod"),
    ("test", "prod"), ("old", "new"), ("before", "after"),
    ("draft", "final"), ("v1", "v2"), ("orig", "updated"),
]

# ── Colours ───────────────────────────────────────────────────────────────────
C_HDR_BG = "1F4E79"
C_HDR_FG = "FFFFFF"
C_SEC_BG = "D6E4F0"
C_DIFF   = "FFE0CC"
C_ONLY_A = "FCE4D6"
C_ONLY_B = "E2EFDA"
C_SAME   = "FFFFFF"
C_ALT    = "F5F9FF"
C_ERR    = "FF0000"
C_WARN   = "FFF2CC"


# ══════════════════════════════════════════════════════════════════════════════
#  Section-header detection via "bold line above blue table row"
# ══════════════════════════════════════════════════════════════════════════════

def _font_is_bold(fontname: str) -> bool:
    """Heuristic: font name contains Bold/bold or ends in -B/,B."""
    if not fontname:
        return False
    return bool(re.search(r'[Bb]old|[,\-]B[dD]?$|[,\-]B\b', fontname))


def _is_blue_fill(color) -> bool:
    """
    Return True if colour looks like the light-blue table-header fill
    used in these documents: RGB ≈ (0.71, 0.90, 1.0).
    Accepts any tuple (R,G,B) where G>0.55, B>0.55 and B≥R.
    """
    if not isinstance(color, (list, tuple)) or len(color) != 3:
        return False
    r, g, b = color
    return g > 0.55 and b > 0.55 and b >= r


def _join_chars_with_gaps(chs: list) -> str:
    """
    Join pdfplumber char dicts (already sorted by x0) into a string,
    inserting a space wherever the horizontal gap between consecutive
    characters is wide enough to be a real word boundary.

    Needed because some PDFs position bold title text via absolute
    character coordinates with NO literal space glyph between words - a
    plain "".join() then collapses e.g. "Inland Marine Schedule of
    Additional Interests" into "InlandMarineScheduleofAdditionalInterests".
    Confirmed live: that single-word blob then fails
    _is_valid_section_title()'s "at least 2 words" check and gets silently
    dropped - across one real 40-page document this rejected 5 of 6 true
    section headers (only the one already present in
    FALLBACK_SECTION_HEADERS survived, via the separate plain-text cross-
    check pass), leaving just one header to split the whole document on and
    producing a single ~14,000-character catch-all "section" that mixed
    several unrelated parts of the document together.

    Threshold: measured directly against a real rejected title - genuine
    within-word letter gaps in that font were ~0 (often slightly negative /
    overlapping), while real word gaps were consistently ~3.7pt. Comparing
    the gap to the PRECEDING character's own width (not a fixed point
    value) keeps this working across different font sizes.
    """
    parts = []
    prev_x1 = None
    prev_width = None
    for c in chs:
        x0 = c.get("x0", 0)
        x1 = c.get("x1", x0)
        if prev_x1 is not None:
            gap = x0 - prev_x1
            threshold = max((prev_width or 0) * 0.35, 1.0)
            if gap > threshold:
                parts.append(" ")
        parts.append(c.get("text", ""))
        prev_x1 = x1
        prev_width = x1 - x0
    return "".join(parts)


def _bold_line_just_above(band: dict, rect_top: float,
                           window: float = 35.0) -> str | None:
    """
    Given a y-band dict {y: [chars]} and the top-y of a blue rect,
    find the closest fully-bold text line in the window [rect_top-window, rect_top-2].
    Returns the normalised text string, or None.
    """
    candidates = []
    for y, chs in band.items():
        if not (rect_top - window < y < rect_top - 2):
            continue
        non_sp = [c for c in chs if c.get("text", "").strip()]
        if not non_sp:
            continue
        # Line must be 100% bold
        if not all(_font_is_bold(c.get("fontname", "")) for c in non_sp):
            continue
        text = _join_chars_with_gaps(
            sorted(chs, key=lambda c: c.get("x0", 0))
        ).strip()
        if text:
            candidates.append((y, text))

    if not candidates:
        return None

    # Take the line closest (highest y) to the blue rect
    _, text = max(candidates, key=lambda x: x[0])
    return re.sub(r"\s+", " ", text).strip()


def _is_valid_section_title(text: str) -> bool:
    """
    Sanity-check a candidate section title.
    Filters out table-cell labels and value lines that also happen to sit
    above a blue table row but are NOT section headers.
    """
    t = text.strip()
    if not t or len(t) < 5:
        return False
    if _is_noise(t):
        return False

    # Must contain at least 2 words
    words = t.split()
    if len(words) < 2:
        return False

    # Reject "$" amounts and lines starting with a digit
    if "$" in t or re.match(r'^\d', t):
        return False

    # Reject "Key:Value" pairs — colon immediately followed by non-space
    # e.g. "Construction:FrameYear of Construction:2005", "Category:Service"
    if re.search(r':\s*\S', t):
        return False

    # Reject lines ending in just ":" (e.g. "Premium:")
    if t.endswith(":"):
        return False

    # Reject standalone construction/material words that bleed from table cells
    one_word_rejects = {
        "non-combustible", "frame", "masonry", "service", "tenant", "owner"
    }
    if t.lower() in one_word_rejects:
        return False

    # Reject form-code lines: "CPD 910 01/25 ..." or "CG 00 01 ..."
    if re.match(r'^[A-Z]{1,6}\s+\d{2,3}\s+\d{2}', t):
        return False

    # Reject lines with 3+ digit runs (table data)
    if re.search(r'\d{3,}', t):
        return False

    # Must be mostly alphabetic
    if sum(c.isalpha() for c in t) / max(len(t), 1) < 0.55:
        return False

    return True


_PDF_PAGE_CACHE = {}


def _load_pdf_pages(pdf_path: Path) -> list:
    """
    Parse a PDF exactly once and cache each page's chars, rects, and
    cleaned text, keyed by resolved path.

    Needed because pdfplumber/pdfminer's page parsing is effectively the
    ENTIRE cost of comparing a large PDF - confirmed via cProfile: on a
    40-page, densely-tabular declarations document (hundreds of locations,
    a "PSFLAT" variant), extract_bold_section_headers()'s own char/rect
    scan plus its plain-text fallback cross-check plus the separate
    extract_text() used for the actual field/section diffing each opened
    the SAME file independently and re-ran that same expensive full-
    document parse from scratch - three complete re-parses of one file for
    what only needs one. Sharing a single parse across all three callers
    cuts that to one, with identical output (this only changes WHERE the
    parsing happens, not what gets parsed or how any of the three callers
    use the result).

    Raises on a parse failure rather than swallowing it - callers had (and
    keep) different error-handling needs: extract_bold_section_headers()
    silently falls back to an empty page list, while extract_text() surfaces
    the failure as visible "[ERROR reading ...]" text in the report - so
    this only does the shared parsing, not error policy.
    """
    key = str(pdf_path.resolve())
    cached = _PDF_PAGE_CACHE.get(key)
    if cached is not None:
        return cached

    pages = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            raw = page.extract_text() or ""
            pages.append({
                "chars": page.chars,
                "rects": page.rects,
                "cleaned_text": clean_page_text(raw),
            })

    _PDF_PAGE_CACHE[key] = pages
    return pages


def extract_bold_section_headers(pdf_path: Path) -> list:
    """
    Detect section headers by finding the bold line immediately above every
    blue-shaded table-header row in the PDF.

    This is the most reliable approach because:
      • Every section in these documents starts with a bold title, immediately
        followed by a blue-background table row.
      • Scanning rects for the blue fill gives us exact y-positions.
      • The bold line just above that y-position is unambiguously the section title.
      • No false positives from table cells, form codes, or legal boilerplate.

    Falls back to FALLBACK_SECTION_HEADERS if the PDF has no blue rects
    (e.g. scanned / greyscale documents).

    Returns an ordered, deduplicated list of section-header strings as they
    appear in document order.
    """
    discovered = []   # list of (page_index * 10000 + rect_top, header_text)
    seen       = set()
    has_blue   = False

    try:
        pages_data = _load_pdf_pages(pdf_path)
    except Exception:
        pages_data = []

    for pg_num, pd in enumerate(pages_data):
        # ── Build y-band char map for this page ───────────────────────
        band = defaultdict(list)
        for ch in pd["chars"]:
            y = round(ch.get("top", 0) / 2) * 2
            band[y].append(ch)

        # ── Find all blue-filled rectangles ───────────────────────────
        blue_rects = [
            r for r in pd["rects"]
            if r.get("fill") and
               _is_blue_fill(r.get("non_stroking_color"))
        ]
        if not blue_rects:
            continue
        has_blue = True

        # Sort rects top-to-bottom; only process the FIRST blue rect in
        # each cluster (multiple consecutive blue rows belong to the same
        # table — only the first one has a section title above it).
        blue_tops = sorted(r["top"] for r in blue_rects)
        prev_top  = -999
        for rect_top in blue_tops:
            # Skip if this rect is within 5pt of the previous one
            # (consecutive table rows share the same section title)
            if rect_top - prev_top < 5:
                continue
            prev_top = rect_top

            title = _bold_line_just_above(band, rect_top)

            # Reject the candidate if its TEXT matches known page-
            # header boilerplate (company name, prepared-for/by,
            # policy date/number stamps). Deliberately content-based
            # rather than a Y-position cutoff: a genuine section can
            # legitimately start at the very top of a page when its
            # table runs across a page break (e.g. two confirmed
            # real headers - "Inland Marine Schedule of Additional
            # Interests" and "General Liability Schedule of
            # Additional Interests" - sit within the first 4 text
            # lines of their page). A blind "skip the first N lines"
            # cutoff silently dropped both of those on a real
            # document; matching the header text itself instead
            # keeps the true boilerplate rejected without losing
            # real page-top titles.
            if title and any(re.search(p, title, re.IGNORECASE) for p in PAGE_HEADER_PATTERNS):
                continue

            if title and _is_valid_section_title(title) and title not in seen:
                seen.add(title)
                sort_key = pg_num * 100000 + int(rect_top)
                discovered.append((sort_key, title))

    # ── Merge blue-rect discoveries with fallback-list confirmations ──────────
    # Even if blue-rect detection worked, some sections may lack a blue rect
    # (e.g. a section with only plain text, no table).  Also scan the plain
    # text for any FALLBACK_SECTION_HEADERS that appear in the document and
    # weren't already found via blue rects.
    page_text_offsets = []
    full_text = ""
    for pg_num, pd in enumerate(pages_data):
        page_text_offsets.append((len(full_text), pg_num))
        full_text += pd["cleaned_text"] + "\n"

    pg_to_char_offset = {pg: off for off, pg in page_text_offsets}

    for hdr in FALLBACK_SECTION_HEADERS:
        if hdr in seen:
            continue   # already found via blue rect
        m = re.search(_flex_ws_pattern(hdr), full_text, re.IGNORECASE)
        if m:
            # Find which page this falls on
            char_pos = m.start()
            pg_num = 0
            for off, pg in page_text_offsets:
                if off <= char_pos:
                    pg_num = pg
            sort_key = pg_num * 100000 + char_pos % 100000
            seen.add(hdr)
            has_blue = True   # ensure we don't fall through to plain fallback
            discovered.append((sort_key, hdr))

    if not discovered:
        return list(FALLBACK_SECTION_HEADERS)

    # Sort by document position and return titles only
    discovered.sort(key=lambda x: x[0])
    return [title for _, title in discovered]


# ══════════════════════════════════════════════════════════════════════════════
#  Text cleaning helpers
# ══════════════════════════════════════════════════════════════════════════════

def _is_noise(line: str) -> bool:
    stripped = line.strip()
    stripped_lower = stripped.lower()
    if stripped_lower in EXACT_NOISE_LINES:
        return True
    if any(rx.match(stripped) for rx in NOISE_LINE_REGEXES):
        return True
    return any(p.lower() in stripped_lower for p in NOISE_PATTERNS)


def clean_page_text(raw: str) -> str:
    """
    Remove page-header/footer overlay lines and noise from a single page's text.

    Strategy:
      1. Drop lines that match known page-header patterns (company name,
         prepared-for/by lines, policy date/number stamps).
         This is more reliable than a fixed line count because different PDF
         variants place the section title on different line numbers.
      2. Additionally enforce a hard cap of PAGE_TOP_LINES_TO_DROP lines
         dropped maximum (to avoid over-stripping short pages).
      3. Remove noise lines (watermarks, version stamps, etc.) anywhere.
    """
    lines = raw.splitlines()
    cleaned = []
    dropped = 0

    for line in lines:
        # Hard cap: never drop more than PAGE_TOP_LINES_TO_DROP lines
        if dropped >= PAGE_TOP_LINES_TO_DROP:
            if not _is_noise(line):
                cleaned.append(line)
            continue

        # Check if this line is a page-header line
        if any(re.search(p, line, re.IGNORECASE) for p in PAGE_HEADER_PATTERNS):
            dropped += 1
            continue

        # Check noise
        if _is_noise(line):
            continue

        cleaned.append(line)

    return "\n".join(cleaned)


def find_doc_start(text: str) -> int:
    """Return character index of first DOCUMENT_HEADER; 0 if none found."""
    best = len(text)
    for hdr in DOCUMENT_HEADERS:
        m = re.search(_flex_ws_pattern(hdr), text, re.IGNORECASE)
        if m and m.start() < best:
            best = m.start()
    return best if best < len(text) else 0


# ══════════════════════════════════════════════════════════════════════════════
#  PDF extraction
# ══════════════════════════════════════════════════════════════════════════════

def extract_text(pdf_path: Path) -> str:
    """Extract, clean and trim text from all pages."""
    try:
        pages_data = _load_pdf_pages(pdf_path)
    except Exception as exc:
        return f"[ERROR reading {pdf_path.name}: {exc}]"

    pages = [pd["cleaned_text"] for pd in pages_data if pd["cleaned_text"].strip()]
    full = "\n".join(pages)
    return full[find_doc_start(full):]


def extract_fields(text: str) -> dict:
    out = {}
    for name, pattern in KEY_FIELD_PATTERNS.items():
        m = re.search(pattern, text, re.IGNORECASE | re.DOTALL)
        out[name] = re.sub(r"\s+", " ", m.group(1)).strip() if m else "(not found)"
    return out


def split_sections_grouped(text: str, section_headers: list) -> dict:
    """
    Split document text into chunks by header occurrence, grouping same-
    named headers into an ordered list under one key instead of numbering
    them into separate dict entries immediately.

    Numbering/pairing occurrences between file A and file B happens later,
    in _align_chunks() - splitting first without deciding the pairing is
    what lets that alignment be content-aware instead of assuming the Nth
    occurrence in A always corresponds to the Nth occurrence in B (see
    _align_chunks()'s docstring for why that assumption breaks on real
    documents).
    """
    hdrs = section_headers if section_headers else FALLBACK_SECTION_HEADERS

    hits = []
    for hdr in hdrs:
        for m in re.finditer(_flex_ws_pattern(hdr), text, re.IGNORECASE):
            hits.append((m.start(), hdr))
    hits.sort()

    if not hits:
        # Last resort: no headers detected at all
        return {"Full Document": [text]}

    grouped = defaultdict(list)
    for i, (start, name) in enumerate(hits):
        end = hits[i + 1][0] if i + 1 < len(hits) else len(text)
        grouped[name].append(text[start:end])
    return grouped


def _chunk_identity_key(chunk_text: str, header: str) -> str:
    """
    Short fragment identifying WHAT a repeated section chunk is about (e.g.
    which location's address, which loss payee's name, which class code) -
    taken as the first non-empty line of body text right after the header
    itself. Used by _align_chunks() to pair same-named chunks between file
    A and file B by content identity instead of raw occurrence order.
    """
    body = chunk_text[len(header):].strip()
    for line in body.splitlines():
        s = line.strip()
        if s:
            return s[:80].lower()
    return ""


def _align_chunks(header: str, chunks_a: list, chunks_b: list) -> list:
    """
    Pair up same-named section chunks between file A and file B by WHAT
    they're about, not by raw occurrence order.

    Why this matters: documents like a multi-location policy repeat a
    header (e.g. "Property Coverage") once per location - dozens or
    hundreds of times in a large document. Comparing purely by occurrence
    index (A's Nth "Property Coverage" vs B's Nth "Property Coverage")
    works fine until A and B have a different COUNT of that header - one
    extra/missing location, a page-break shifting where a table gets
    split - at which point every occurrence after that point in the
    document is compared against the wrong location, and the whole rest of
    the diff degenerates into noise. Confirmed live: a 40-location PSFLAT
    declarations document produced 432 reported "differences", the large
    majority of which were this index drift rather than real content
    changes.

    Fix: align chunks using each chunk's identity key (see
    _chunk_identity_key - usually an address / loss-payee name / class
    description, i.e. the part that actually identifies WHICH location or
    item the chunk is about) as the sequence for the same LCS algorithm
    difflib already uses for text diffing. Matching keys pair directly; a
    run of keys with no match on one side becomes "Only in File A/B"
    entries instead of shifting every later occurrence out of alignment.

    Uses SequenceMatcher's default autojunk=True deliberately (not False):
    on a large multi-location document, many chunks share the exact same
    generic key (e.g. a "Property Coverage Form" boilerplate paragraph
    whose identity-key line is just "form", repeated 100+ times) - with
    autojunk off, every one of those duplicates is a candidate match the
    LCS search has to consider, which measured live as minutes of runtime
    on a 400+ chunk document. autojunk downweights exactly these "popular"
    repeated keys, which is the right tradeoff here: those generic chunks
    carry little identifying information anyway, so a slightly less
    globally-optimal pairing among THEM specifically is a small cost for a
    large speedup, while the genuinely unique keys (addresses, bank names,
    class codes - the ones that actually matter for correct alignment)
    match exactly as before.

    Returns an ordered list of (text_a_or_None, text_b_or_None) tuples.
    """
    if len(chunks_a) <= 1 and len(chunks_b) <= 1:
        # Common case - a header that appears at most once per file. No
        # ambiguity, skip the alignment machinery entirely.
        return [(chunks_a[0] if chunks_a else None,
                 chunks_b[0] if chunks_b else None)]

    keys_a = [_chunk_identity_key(c, header) for c in chunks_a]
    keys_b = [_chunk_identity_key(c, header) for c in chunks_b]

    pairs = []
    for tag, i1, i2, j1, j2 in SequenceMatcher(None, keys_a, keys_b).get_opcodes():
        if tag == "equal":
            for k in range(i2 - i1):
                pairs.append((chunks_a[i1 + k], chunks_b[j1 + k]))
        elif tag == "replace":
            n = min(i2 - i1, j2 - j1)
            for k in range(n):
                pairs.append((chunks_a[i1 + k], chunks_b[j1 + k]))
            for k in range(n, i2 - i1):
                pairs.append((chunks_a[i1 + k], None))
            for k in range(n, j2 - j1):
                pairs.append((None, chunks_b[j1 + k]))
        elif tag == "delete":
            for k in range(i1, i2):
                pairs.append((chunks_a[k], None))
        elif tag == "insert":
            for k in range(j1, j2):
                pairs.append((None, chunks_b[k]))
    return pairs


# ══════════════════════════════════════════════════════════════════════════════
#  Comparison
# ══════════════════════════════════════════════════════════════════════════════

def compare_fields(fa: dict, fb: dict) -> list:
    rows = []
    for key in sorted(set(fa) | set(fb)):
        va, vb = fa.get(key, "(not found)"), fb.get(key, "(not found)")
        rows.append({"field": key, "value_a": va, "value_b": vb, "match": va == vb})
    return rows


def compare_sections(text_a: str, text_b: str, section_headers: list) -> list:
    """
    Split both files into sections and diff them.

    Each same-named header's occurrences are aligned by content identity
    (see _align_chunks()) before comparing, rather than by raw occurrence
    order - required for documents that repeat a header once per location/
    item, where A and B can easily have a different occurrence count.
    """
    grouped_a = split_sections_grouped(text_a, section_headers)
    grouped_b = split_sections_grouped(text_b, section_headers)
    all_names = list(dict.fromkeys(list(grouped_a) + list(grouped_b)))

    rows = []
    for name in all_names:
        chunks_a = grouped_a.get(name, [])
        chunks_b = grouped_b.get(name, [])

        sfx = 1
        for ta, tb in _align_chunks(name, chunks_a, chunks_b):
            sec = name if sfx == 1 else f"{name} ({sfx})"
            sfx += 1

            if not ta and not tb:
                continue
            if not ta:
                rows.append({"section": sec, "change_type": "Only in File B",
                             "detail_a": "", "detail_b": f"Present ({len(tb):,} chars)",
                             "similarity": 0.0})
                continue
            if not tb:
                rows.append({"section": sec, "change_type": "Only in File A",
                             "detail_a": f"Present ({len(ta):,} chars)", "detail_b": "",
                             "similarity": 0.0})
                continue

            ratio = SequenceMatcher(None, ta, tb).ratio()
            if ratio >= 0.999:
                rows.append({"section": sec, "change_type": "Identical",
                             "detail_a": "(same)", "detail_b": "(same)",
                             "similarity": ratio})
            else:
                lines_a = {l.strip() for l in ta.splitlines() if l.strip()}
                lines_b = {l.strip() for l in tb.splitlines() if l.strip()}
                only_a  = sorted(lines_a - lines_b)[:6]
                only_b  = sorted(lines_b - lines_a)[:6]
                rows.append({"section": sec, "change_type": "Modified",
                             "detail_a": " | ".join(only_a) or "(format/whitespace only)",
                             "detail_b": " | ".join(only_b) or "(format/whitespace only)",
                             "similarity": ratio})
    return rows


MAX_SUMMARY_ROWS = 15   # cap on how many issues get listed per file-pair in the
                        # Summary sheet's one-cell overview (full detail always
                        # stays on that pair's own tab - this cap only keeps the
                        # overview cell scannable instead of a wall of text)


def build_diff_summary(key_fields: list, sec_diffs: list) -> str:
    parts = []
    for fd in key_fields:
        if not fd["match"]:
            parts.append(f"[FIELD] {fd['field']}: A={fd['value_a']} | B={fd['value_b']}")
    for sd in sec_diffs:
        if sd["change_type"] == "Identical":
            continue
        sim = f"{sd['similarity']*100:.0f}%"
        if sd["change_type"] == "Modified":
            a_snip = sd["detail_a"].split(" | ")[0][:80]
            b_snip = sd["detail_b"].split(" | ")[0][:80]
            # Both sides collapse to this exact placeholder only when every
            # line matches after .strip() - i.e. nothing but blank-line /
            # ordering noise differs, not real section content. Surfacing
            # these in the one-line overview just floods it with entries
            # that don't point to an actual field mismatch; the section
            # still shows up (as "Modified", real similarity %) on the
            # pair's own detail tab for anyone who wants to double check.
            if a_snip == "(format/whitespace only)" and b_snip == "(format/whitespace only)":
                continue
            parts.append(f"[{sd['section']} – {sim}] A: {a_snip}  /  B: {b_snip}")
        else:
            parts.append(f"[{sd['section']}] {sd['change_type']}")

    if not parts:
        return "No differences found"
    if len(parts) > MAX_SUMMARY_ROWS:
        shown = parts[:MAX_SUMMARY_ROWS]
        shown.append(f"… and {len(parts) - MAX_SUMMARY_ROWS} more (see this pair's own tab for full detail)")
        return "\n".join(shown)
    return "\n".join(parts)


# ══════════════════════════════════════════════════════════════════════════════
#  PDF-pair detection
# ══════════════════════════════════════════════════════════════════════════════

def find_pdf_pairs(folder: Path) -> list:
    pdfs = sorted(p for p in folder.iterdir()
                  if p.is_file() and p.suffix.lower() == ".pdf")
    if len(pdfs) < 2:
        return []
    if len(pdfs) == 2:
        a, b = pdfs
        return [(a, b, a.stem, b.stem)]

    pairs, used = [], set()
    for ha, hb in PAIR_HINTS:
        for p in pdfs:
            if p in used or ha not in p.stem.lower():
                continue
            for q in pdfs:
                if q in used or q is p or hb not in q.stem.lower():
                    continue
                pairs.append((p, q, p.stem, q.stem))
                used.update([p, q])
                break

    remaining = [p for p in pdfs if p not in used]
    for i in range(0, len(remaining) - 1, 2):
        a, b = remaining[i], remaining[i + 1]
        pairs.append((a, b, a.stem, b.stem))
    return pairs


def find_pdf_pairs_recursive(root: Path) -> list:
    """
    Walk every subfolder under root, at ANY depth (root itself included),
    and treat each folder that directly contains a valid PDF pair as its
    own pair-group.

    Unlike the two existing modes - --flat (PDFs directly in root, depth 0)
    and the default (PDFs one level down, depth 1) - this handles trees
    where the pair-holding folder is nested arbitrarily deep, e.g.
    root/PC_CLCPPDeclarationPrint_Donegal_.../PS10STD/*.pdf (depth 2).
    Confirmed live: a folder like CPPDecParallel has state-folders that
    themselves have no PDFs directly inside them - only their own
    print-variant sub-folders (PS10STD, PSAGENT, ...) do - so neither
    existing mode ever finds anything there.

    Returns a list of (label, pairs) tuples, where label is the folder's
    path relative to root (not just its bare name) so that same-named
    variant folders under different parents - "PS10STD" appears under
    every state folder here - don't collide in the report.
    """
    groups = []
    for folder in sorted(p for p in root.rglob("*") if p.is_dir()):
        pairs = find_pdf_pairs(folder)
        if pairs:
            groups.append((str(folder.relative_to(root)), pairs))

    # Pairs sitting directly in root itself (mixed-depth trees) are checked
    # last so their plain root.name label doesn't collide with a relative
    # path that also happens to be just the root's own name.
    root_pairs = find_pdf_pairs(root)
    if root_pairs:
        groups.insert(0, (root.name, root_pairs))

    return groups


# ══════════════════════════════════════════════════════════════════════════════
#  Excel helpers
# ══════════════════════════════════════════════════════════════════════════════

def _fill(hex_color):
    return PatternFill("solid", fgColor=hex_color)

def _font(bold=False, color="000000", size=10, italic=False):
    return Font(name="Arial", bold=bold, color=color, size=size, italic=italic)

def _border():
    s = Side(style="thin", color="BFBFBF")
    return Border(left=s, right=s, top=s, bottom=s)

def _align(h="left", wrap=True):
    return Alignment(horizontal=h, vertical="top", wrap_text=wrap)

def _hdr_row(ws, row, values, bg=C_HDR_BG, fg=C_HDR_FG, height=20):
    for col, val in enumerate(values, 1):
        c = ws.cell(row=row, column=col, value=val)
        c.font      = _font(bold=True, color=fg, size=11)
        c.fill      = _fill(bg)
        c.alignment = _align("center")
        c.border    = _border()
    ws.row_dimensions[row].height = height

def _cell(ws, row, col, value, bold=False, bg=C_SAME,
          align_h="left", fc="000000", rh=16):
    c = ws.cell(row=row, column=col, value=value)
    c.font      = _font(bold=bold, color=fc)
    c.fill      = _fill(bg)
    c.alignment = _align(align_h)
    c.border    = _border()
    ws.row_dimensions[row].height = max(
        ws.row_dimensions[row].height or 0, rh)
    return c


# ══════════════════════════════════════════════════════════════════════════════
#  Excel builder
# ══════════════════════════════════════════════════════════════════════════════

def build_excel(all_results: list, output_path: str):
    wb  = openpyxl.Workbook()
    ws0 = wb.active
    ws0.title = "Summary"

    for col, w in zip("ABCDEFGH", [22, 32, 18, 14, 14, 12, 12, 80]):
        ws0.column_dimensions[col].width = w

    ws0.merge_cells("A1:H1")
    t = ws0["A1"]
    t.value     = "PDF Comparison Report  –  Consolidated Summary"
    t.font      = _font(bold=True, size=14, color=C_HDR_FG)
    t.fill      = _fill(C_HDR_BG)
    t.alignment = Alignment(horizontal="center", vertical="center")
    ws0.row_dimensions[1].height = 32

    _hdr_row(ws0, 2, [
        "Folder", "Document Title", "Quote / Policy No",
        "File A", "File B",
        "# Field\nDiffs", "# Section\nDiffs",
        "Differences Summary  (Field changes + Section changes)"
    ], height=30)

    sr = 3
    for res in all_results:
        bg = C_ALT if sr % 2 == 0 else C_SAME
        if res.get("error"):
            diff_text = f"ERROR: {res['error']}"
            diff_bg   = C_ONLY_A
        else:
            diff_text = build_diff_summary(res["key_fields"], res["sec_diffs"])
            diff_bg   = C_DIFF if diff_text != "No differences found" else "E2EFDA"

        row_height = max(16, min(120, diff_text.count("\n") * 14 + 16))
        vals = [res["folder"], res["doc_title"], res["quote_number"],
                res["label_a"], res["label_b"],
                res.get("n_field_diffs", 0), res.get("n_section_diffs", 0),
                diff_text]
        for col, val in enumerate(vals, 1):
            _cell(ws0, sr, col, val, bg=bg, rh=row_height)
        if res.get("n_field_diffs", 0) > 0:
            ws0.cell(sr, 6).fill = _fill(C_DIFF)
        if res.get("n_section_diffs", 0) > 0:
            ws0.cell(sr, 7).fill = _fill(C_DIFF)
        ws0.cell(sr, 8).fill      = _fill(diff_bg)
        ws0.cell(sr, 8).alignment = _align("left", wrap=True)
        sr += 1

    ws0.freeze_panes = "A3"
    ws0.row_dimensions[2].height = 30

    # ── Per-folder detail sheets ──────────────────────────────────────────────
    for res in all_results:
        if res.get("error"):
            continue

        tab = re.sub(r'[\\/*?:\[\]]', '_', res["folder"])[:31]
        existing = [s.title for s in wb.worksheets]
        base, sfx = tab, 2
        while tab in existing:
            tab = f"{base[:28]}_{sfx}"
            sfx += 1

        ws = wb.create_sheet(title=tab)
        for col, w in zip("ABCDE", [30, 38, 38, 18, 13]):
            ws.column_dimensions[col].width = w

        ws.merge_cells("A1:E1")
        h = ws["A1"]
        h.value     = (f"Folder: {res['folder']}   |   "
                       f"{res['doc_title']}   |   Quote/Policy: {res['quote_number']}")
        h.font      = _font(bold=True, size=12, color=C_HDR_FG)
        h.fill      = _fill(C_HDR_BG)
        h.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws.row_dimensions[1].height = 26

        ws.merge_cells("A2:E2")
        s = ws["A2"]
        s.value     = (f"File A: {res['label_a']}     ◀▶     File B: {res['label_b']}     "
                       f"│     Sections detected (bold): {res.get('sections_detected', 'n/a')}")
        s.font      = _font(italic=True, size=10, color="444444")
        s.fill      = _fill(C_SEC_BG)
        s.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws.row_dimensions[2].height = 18

        row = 4

        # Key fields
        ws.merge_cells(f"A{row}:E{row}")
        c = ws[f"A{row}"]
        c.value     = "KEY FIELDS COMPARISON"
        c.font      = _font(bold=True, size=11, color="1F4E79")
        c.fill      = _fill(C_SEC_BG)
        c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        ws.row_dimensions[row].height = 20
        row += 1

        _hdr_row(ws, row, ["Field",
                            f"File A  ({res['label_a']})",
                            f"File B  ({res['label_b']})",
                            "Match?", ""])
        row += 1
        for i, kf in enumerate(res["key_fields"]):
            bg = C_ALT if i % 2 == 0 else C_SAME
            ok = kf["match"]
            _cell(ws, row, 1, kf["field"],   bold=True, bg=bg)
            _cell(ws, row, 2, kf["value_a"], bg=bg)
            _cell(ws, row, 3, kf["value_b"], bg=bg)
            _cell(ws, row, 4, "✓ Match" if ok else "✗ Differs",
                  bg=C_SAME if ok else C_DIFF, align_h="center")
            _cell(ws, row, 5, "", bg=bg)
            ws.row_dimensions[row].height = 16
            row += 1

        row += 1

        # Section diffs
        ws.merge_cells(f"A{row}:E{row}")
        c2 = ws[f"A{row}"]
        c2.value    = "SECTION-BY-SECTION COMPARISON  (sections auto-detected from bold headers in PDF)"
        c2.font     = _font(bold=True, size=11, color="1F4E79")
        c2.fill     = _fill(C_SEC_BG)
        c2.alignment= Alignment(horizontal="left", vertical="center", indent=1)
        ws.row_dimensions[row].height = 20
        row += 1

        _hdr_row(ws, row, ["Section",
                            f"Lines only in A  ({res['label_a']})",
                            f"Lines only in B  ({res['label_b']})",
                            "Change Type", "Similarity %"])
        row += 1
        for i, sd in enumerate(res["sec_diffs"]):
            bg  = C_ALT if i % 2 == 0 else C_SAME
            ct  = sd["change_type"]
            ctc = {"Identical": "E2EFDA", "Modified": C_DIFF,
                   "Only in File A": C_ONLY_A, "Only in File B": C_ONLY_B}.get(ct, C_SAME)
            sim = f"{sd['similarity'] * 100:.1f}%"
            _cell(ws, row, 1, sd["section"],  bold=True, bg=bg, rh=40)
            _cell(ws, row, 2, sd["detail_a"], bg=bg,            rh=40)
            _cell(ws, row, 3, sd["detail_b"], bg=bg,            rh=40)
            _cell(ws, row, 4, ct, bg=ctc, align_h="center",     rh=40)
            _cell(ws, row, 5, sim, align_h="center",            rh=40)
            row += 1

        ws.freeze_panes = "A3"

    # ── Legend ────────────────────────────────────────────────────────────────
    wl = wb.create_sheet("Legend")
    wl.column_dimensions["A"].width = 35
    wl.column_dimensions["B"].width = 70

    wl.merge_cells("A1:B1")
    lh = wl["A1"]
    lh.value     = "Colour Legend  &  How this tool works"
    lh.font      = _font(bold=True, size=13, color=C_HDR_FG)
    lh.fill      = _fill(C_HDR_BG)
    lh.alignment = Alignment(horizontal="center", vertical="center")
    wl.row_dimensions[1].height = 26

    _hdr_row(wl, 2, ["Colour", "Meaning"], bg="374151", height=18)
    legend_items = [
        (C_DIFF,   "Value / section differs between File A and File B"),
        (C_ONLY_A, "Content only in File A  (or ERROR row)"),
        (C_ONLY_B, "Content only in File B"),
        ("E2EFDA", "Identical"),
        (C_SEC_BG, "Section header row"),
        (C_ALT,    "Alternating row tint"),
        (C_WARN,   "Advisory / note row"),
    ]
    for i, (color, label) in enumerate(legend_items, 3):
        c = wl.cell(row=i, column=1, value=label)
        c.fill = _fill(color); c.font = _font(size=10)
        c.alignment = Alignment(horizontal="left", vertical="center", indent=1)
        c.border = _border()
        wl.row_dimensions[i].height = 18

    r = len(legend_items) + 4
    _hdr_row(wl, r, ["Behaviour", "Details"], bg="374151", height=18)
    r += 1
    notes = [
        ("Bold-header detection",
         "Section boundaries are read directly from the PDF's font metadata. "
         "Any line where ≥60% of characters use a Bold font becomes a section header. "
         "This automatically captures headers like 'Property Schedule of Additional Interests' "
         "without needing a predefined list."),
        ("Fallback",
         "If no bold headers are detected (e.g. scanned/image PDFs), a hardcoded list "
         "of known section names is used instead."),
        ("Page top lines dropped",
         f"The first {PAGE_TOP_LINES_TO_DROP} lines of every page are discarded "
         "(overlay headers/footers not part of the document body)."),
        ("Noise stripped",
         "Lines containing OpenText Exstream watermark text, version stamps, or '-*-' "
         "markers are removed before comparison."),
        ("Comparison start",
         "Each file is trimmed to begin at its first document header "
         "(e.g. 'COMMERCIAL PACKAGE POLICY PROPOSAL', 'APPLICATION', 'DECLARATIONS')."),
    ]
    for title, detail in notes:
        for col, val in enumerate([title, detail], 1):
            c = wl.cell(row=r, column=col, value=val)
            c.font      = _font(bold=(col == 1), size=10)
            c.fill      = _fill(C_WARN)
            c.alignment = Alignment(horizontal="left", vertical="top",
                                    wrap_text=True, indent=1)
            c.border    = _border()
        wl.row_dimensions[r].height = 55
        r += 1

    wb.save(output_path)
    print(f"\n✅  Excel saved → {output_path}")


# ══════════════════════════════════════════════════════════════════════════════
#  Core processing
# ══════════════════════════════════════════════════════════════════════════════

def process_pair(folder_name, pdf_a, pdf_b, label_a, label_b):
    print(f"    Comparing: {label_a}  ◀▶  {label_b}")

    # ── Step 1: extract bold section headers from BOTH files and merge ────────
    print(f"      Detecting bold section headers …", end=" ", flush=True)
    hdrs_a = extract_bold_section_headers(pdf_a)
    hdrs_b = extract_bold_section_headers(pdf_b)
    # Union: preserve order from A, append any extras found only in B
    seen = set(hdrs_a)
    merged_hdrs = list(hdrs_a)
    for h in hdrs_b:
        if h not in seen:
            merged_hdrs.append(h)
            seen.add(h)

    if merged_hdrs:
        print(f"{len(merged_hdrs)} found")
    else:
        print(f"none – using fallback list ({len(FALLBACK_SECTION_HEADERS)} headers)")
        merged_hdrs = FALLBACK_SECTION_HEADERS

    # ── Step 2: extract plain text ────────────────────────────────────────────
    text_a = extract_text(pdf_a)
    text_b = extract_text(pdf_b)

    # ── Step 3: key field extraction ──────────────────────────────────────────
    fields_a   = extract_fields(text_a)
    fields_b   = extract_fields(text_b)
    key_fields = compare_fields(fields_a, fields_b)

    # ── Step 4: section splitting & comparison ────────────────────────────────
    sec_diffs = compare_sections(text_a, text_b, merged_hdrs)

    # Document title from text
    doc_title = "(unknown)"
    for hdr in DOCUMENT_HEADERS:
        if re.search(_flex_ws_pattern(hdr), text_a, re.IGNORECASE):
            doc_title = hdr.title()
            break

    quote = (fields_a.get("Quote / Policy No") or
             fields_b.get("Quote / Policy No") or "Unknown")
    if quote != "Unknown":
        quote = quote.split()[0]

    n_fd = sum(1 for f in key_fields if not f["match"])
    n_sd = sum(1 for s in sec_diffs  if s["change_type"] != "Identical")

    return {
        "folder":            folder_name,
        "doc_title":         doc_title,
        "quote_number":      quote,
        "label_a":           label_a,
        "label_b":           label_b,
        "key_fields":        key_fields,
        "sec_diffs":         sec_diffs,
        "n_field_diffs":     n_fd,
        "n_section_diffs":   n_sd,
        "sections_detected": len(merged_hdrs),
    }


def scan_and_compare(root: Path, flat=False, recursive=False, limit=0):
    results, processed = [], 0

    if recursive:
        groups = find_pdf_pairs_recursive(root)
        if not groups:
            print(f"  ⚠  No folder under {root.name!r} contains a PDF pair (searched recursively)")
        else:
            total = min(len(groups), limit) if limit else len(groups)
            # Printed once, up front, in a fixed "Found N folder(s)" shape so a
            # caller (the runner UI's server.js) can regex-parse it as the
            # denominator for a progress bar - the count of "📁" lines seen
            # afterward (each folder printed exactly once, right before it's
            # processed) is the numerator.
            print(f"Found {total} folder(s) with PDF pairs to compare")
        for folder_label, pairs in groups:
            if limit and processed >= limit:
                print(f"\n  [--limit {limit} reached]")
                break
            print(f"\n📁  {folder_label}  ({len(pairs)} pair{'s' if len(pairs)!=1 else ''})")
            for pdf_a, pdf_b, la, lb in pairs:
                try:
                    res = process_pair(folder_label, pdf_a, pdf_b, la, lb)
                except Exception as exc:
                    print(f"    ❌  {exc}")
                    res = {"folder": folder_label, "doc_title": "", "quote_number": "",
                           "label_a": la, "label_b": lb,
                           "key_fields": [], "sec_diffs": [],
                           "n_field_diffs": 0, "n_section_diffs": 0,
                           "error": str(exc)}
                results.append(res)
                processed += 1
        return results

    folders = [root] if flat else sorted(f for f in root.iterdir() if f.is_dir())
    folder_pairs = []
    for f in folders:
        p = find_pdf_pairs(f)
        if p:
            folder_pairs.append((f, p))
        else:
            print(f"  ⚠  Skipping {f.name!r} — fewer than 2 PDFs")

    if not folder_pairs:
        print(f"  ⚠  No folder{'' if flat else ' under ' + repr(root.name)} contains a PDF pair")
    else:
        total = min(len(folder_pairs), limit) if limit else len(folder_pairs)
        print(f"Found {total} folder(s) with PDF pairs to compare")

    for folder, pairs in folder_pairs:
        if limit and processed >= limit:
            print(f"\n  [--limit {limit} reached]")
            break
        print(f"\n📁  {folder.name}  ({len(pairs)} pair{'s' if len(pairs)!=1 else ''})")
        for pdf_a, pdf_b, la, lb in pairs:
            try:
                res = process_pair(folder.name, pdf_a, pdf_b, la, lb)
            except Exception as exc:
                print(f"    ❌  {exc}")
                res = {"folder": folder.name, "doc_title": "", "quote_number": "",
                       "label_a": la, "label_b": lb,
                       "key_fields": [], "sec_diffs": [],
                       "n_field_diffs": 0, "n_section_diffs": 0,
                       "error": str(exc)}
            results.append(res)
            processed += 1
    return results


# ══════════════════════════════════════════════════════════════════════════════
#  Entry point
# ══════════════════════════════════════════════════════════════════════════════

def main():
    ap = argparse.ArgumentParser(
        description="Compare PDF document pairs across folders → Excel",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__)
    ap.add_argument("--input-dir", metavar="DIR")
    ap.add_argument("--output",    metavar="FILE", default="policy_comparison.xlsx")
    ap.add_argument("--flat",      action="store_true",
                    help="PDFs are directly in --input-dir, not in sub-folders")
    ap.add_argument("--recursive", action="store_true",
                    help="PDF pairs live at any depth under --input-dir (e.g. "
                         "root/state-folder/variant-folder/*.pdf) - scans every "
                         "sub-folder recursively instead of assuming --flat's "
                         "depth 0 or the default's fixed depth 1")
    ap.add_argument("--limit",     type=int, default=0, metavar="N",
                    help="Stop after N pairs (0 = no limit)")
    ap.add_argument("--demo",      action="store_true")
    args = ap.parse_args()

    if args.demo:
        uploads   = Path("/mnt/user-data/uploads")
        demo_pdfs = sorted(uploads.glob("*.pdf"))
        if len(demo_pdfs) < 2:
            sys.exit("Demo needs ≥2 PDFs in /mnt/user-data/uploads")
        a, b = demo_pdfs[0], demo_pdfs[1]
        la = re.sub(r"^\d+_", "", a.stem)
        lb = re.sub(r"^\d+_", "", b.stem)
        print(f"\n📁  demo_folder")
        results = [process_pair("demo_folder", a, b, la, lb)]
        out = "/mnt/user-data/outputs/policy_comparison.xlsx"
    elif args.input_dir:
        root = Path(args.input_dir)
        if not root.exists():
            sys.exit(f"Not found: {root}")
        out = args.output
        if not out.lower().endswith(".xlsx"):
            out = re.sub(r"\.\w+$", "", out) + ".xlsx"
            print(f"  ℹ  Output renamed to {out}")
        results = scan_and_compare(root, flat=args.flat, recursive=args.recursive, limit=args.limit)
    else:
        ap.print_help()
        sys.exit(0)

    if not results:
        sys.exit("No PDF pairs found.")

    errored   = sum(1 for r in results if r.get("error"))
    with_diff = sum(1 for r in results
                    if r.get("n_field_diffs", 0) > 0 or r.get("n_section_diffs", 0) > 0)
    identical = len(results) - with_diff - errored

    print(f"\n{'─'*55}")
    print(f"  Pairs processed   : {len(results)}")
    print(f"  With differences  : {with_diff}")
    print(f"  Identical         : {identical}")
    print(f"  Errors            : {errored}")
    print(f"{'─'*55}")

    build_excel(results, out)


if __name__ == "__main__":
    main()
