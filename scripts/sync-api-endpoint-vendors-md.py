#!/usr/bin/env python3
"""
Read `.cursor/rules/api-endpoint-vendors.txt` and merge into `.cursor/rules/api-endpoint-vendors.md`.

- Preserves existing vendor sections from the `.md` (by RapidAPI listing fingerprint).
- Adds new vendors from the `.txt` when the fingerprint is new.
- Replaces a vendor's body when the same fingerprint appears again (re-sync / updated paste).
- Formats loosely: optional ### subsections for common headings; never drops lines from the paste.

Run from repo root:
  python scripts/sync-api-endpoint-vendors-md.py
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TXT = ROOT / ".cursor/rules/api-endpoint-vendors.txt"
MD = ROOT / ".cursor/rules/api-endpoint-vendors.md"

# First match is the canonical RapidAPI listing URL: .../owner/api/api-slug
RAPIDAPI_LISTING_FP = re.compile(
    r"https://rapidapi\.com/(?P<owner>[^/\s?]+)/api/(?P<slug>[^/\s?)]+)",
    re.IGNORECASE,
)

# Vendor block starts: "Title (https://rapidapi.com/...)"
VENDOR_TITLE_LINE = re.compile(
    r"^(?P<title>[^\n(]+)\((?P<url>https://rapidapi\.com/[^)]+)\)\s*$",
    re.MULTILINE,
)

DEFAULT_PREAMBLE = """<!-- Regenerate from `api-endpoint-vendors.txt` via `python scripts/sync-api-endpoint-vendors-md.py` -->

# RapidAPI vendor endpoint reference (full archive)

**Purpose:** Verbatim vendor / RapidAPI documentation for job-search integrations. **Nothing in the body below this preamble should be removed** when updating—only append or replace sections the user pastes.

## For agents (how to use)

1. **Search this file** (or the `.txt` original) for: parameter names, hosts, paths, enums, credits, error text, and JSON field names.
2. **Vendors** are separated by horizontal rules (`---`) and `## Vendor N:` headings (see below).
3. If **`docs/rapidapi-job-providers.md`** or code disagree with this file, **prefer this file** for raw parameter semantics; prefer **repo code** for what we actually implement.
4. After changing **`api-endpoint-vendors.txt`**, run **`python scripts/sync-api-endpoint-vendors-md.py`** to merge into this `.md`.

---

"""

# Lines that become markdown ### headings when not already a heading (case-insensitive match on strip).
SECTION_LINE_PATTERNS: tuple[tuple[str, str], ...] = (
    (r"^API endpoint\s+https?://\S", "Endpoint (listing / playground URL)"),
    (r"^endpoint\s+https?://\S", "Endpoint (listing / playground URL)"),
    (r"^Query Params\s*$", "Query Params"),
    (r"^Sample request\s*$", "Sample request"),
    (r"^Sample json\s*$", "Sample JSON"),
    (r"^example request\s*$", "Example request"),
    (r"^Example response\s*$", "Example response"),
    (r"^Additional info\s*$", "Additional info"),
)


@dataclass
class VendorBlock:
    """One logical vendor: display title + raw body text (no ## header line)."""

    title: str
    body: str
    fingerprint: str | None = None
    source_title_line: str = ""

    def __post_init__(self) -> None:
        if self.fingerprint is None:
            blob = (
                (self.source_title_line + "\n" if self.source_title_line else "")
                + self.title
                + "\n"
                + self.body[:8000]
            )
            self.fingerprint = fingerprint_from_text(blob)


def fingerprint_from_text(text: str) -> str | None:
    """Stable id: owner/api-slug from first RapidAPI listing URL."""
    m = RAPIDAPI_LISTING_FP.search(text)
    if not m:
        return None
    return f"{m.group('owner').lower()}/{m.group('slug').lower()}"


def extract_display_title(title_line: str) -> str:
    """`Jobs API (https://...)` -> `Jobs API`. Fallback: stripped first line."""
    title_line = title_line.strip()
    m = re.match(r"^([^(]+)\(", title_line)
    if m:
        return m.group(1).strip()
    return title_line[:200] if title_line else "Unknown vendor"


def split_txt_into_vendors(raw: str) -> list[tuple[str, str]]:
    """
    Split the .txt into (title_line, body) segments.
    Title line must look like: Name (https://rapidapi.com/...)
    If no such pattern, treat whole file as one block.
    """
    text = raw.replace("\r\n", "\n")
    if not text.strip():
        return []

    matches = list(VENDOR_TITLE_LINE.finditer(text))
    if not matches:
        first = next((i for i, line in enumerate(text.split("\n")) if line.strip()), None)
        if first is None:
            return [("", text)]
        lines = text.split("\n")
        title_guess = lines[first].strip()[:120]
        return [(title_guess, text)]

    segments: list[tuple[str, str]] = []
    for i, m in enumerate(matches):
        title_line = m.group(0).strip()
        start_content = m.end()
        end_content = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start_content:end_content].strip("\n")
        segments.append((title_line, body))
    return segments


def parse_md_vendors(md_text: str) -> tuple[str, list[VendorBlock]]:
    """Return (preamble before first ## Vendor, list of VendorBlock with body only)."""
    md_text = md_text.replace("\r\n", "\n")
    m = re.search(r"^## Vendor\s+\d+:", md_text, re.MULTILINE)
    if not m:
        return md_text.rstrip() + "\n", []

    preamble = md_text[: m.start()]
    rest = md_text[m.start() :]

    blocks: list[VendorBlock] = []
    header_re = re.compile(r"^## Vendor\s+(\d+):\s*(.+)$", re.MULTILINE)
    matches = list(header_re.finditer(rest))
    for i, hm in enumerate(matches):
        num = int(hm.group(1))
        title = hm.group(2).strip()
        body_start = hm.end()
        body_end = matches[i + 1].start() if i + 1 < len(matches) else len(rest)
        body = rest[body_start:body_end].strip("\n")
        # Strip leading --- if present (leftover separator)
        body = re.sub(r"^---\s*\n+", "", body)
        body = strip_trailing_hrule(body.strip("\n"))
        vb = VendorBlock(title=title, body=body, source_title_line="")
        blocks.append(vb)
    return preamble, blocks


def strip_trailing_hrule(text: str) -> str:
    """Remove a trailing markdown horizontal rule so we do not duplicate `---` between vendors."""
    return re.sub(r"(?ms)\n*---\s*$", "", text.rstrip())


def format_vendor_body(raw_body: str) -> str:
    """
    Add ### subsections where common headings are detected; keep every line.
    Does not fence the entire body (keeps agent search useful).
    """
    lines = raw_body.replace("\r\n", "\n").split("\n")
    out: list[str] = []
    for line in lines:
        stripped = line.strip()
        heading_label: str | None = None
        if stripped.startswith("#"):
            out.append(line)
            continue
        for pattern, label in SECTION_LINE_PATTERNS:
            if re.match(pattern, stripped, re.IGNORECASE):
                heading_label = label
                break
        if heading_label:
            out.append(f"### {heading_label}")
            out.append(line)
        else:
            out.append(line)
    return "\n".join(out).rstrip() + "\n"


def merge_vendors(
    existing: list[VendorBlock],
    incoming: list[VendorBlock],
) -> list[VendorBlock]:
    """
    Match incoming by fingerprint to replace; append unseen fingerprints.
    Order: existing vendors in original order (minus replaced), then new at end.
    """
    by_fp: dict[str, VendorBlock] = {}
    order: list[str] = []

    for vb in existing:
        fp = vb.fingerprint or fingerprint_from_text(vb.title + "\n" + vb.body)
        if not fp:
            fp = f"__nohash_{len(order)}__"
        vb.fingerprint = fp
        if fp not in by_fp:
            order.append(fp)
        by_fp[fp] = VendorBlock(
            title=vb.title,
            body=vb.body,
            fingerprint=fp,
            source_title_line=vb.source_title_line,
        )

    for inc in incoming:
        fp = inc.fingerprint or fingerprint_from_text(inc.source_title_line + "\n" + inc.body)
        if not fp:
            fp = f"__incoming_plain_{hash(inc.body) & 0xFFFFFFFF:08x}__"
        inc.fingerprint = fp
        inc.title = extract_display_title(inc.source_title_line) if inc.source_title_line else inc.title
        formatted = format_vendor_body(inc.body)
        if fp in by_fp:
            by_fp[fp] = VendorBlock(
                title=by_fp[fp].title,
                body=formatted,
                fingerprint=fp,
                source_title_line=inc.source_title_line,
            )
        else:
            by_fp[fp] = VendorBlock(
                title=inc.title,
                body=formatted,
                fingerprint=fp,
                source_title_line=inc.source_title_line,
            )
            order.append(fp)

    return [by_fp[fp] for fp in order]


def render_md(preamble: str, vendors: list[VendorBlock]) -> str:
    parts: list[str] = []
    pre = preamble.rstrip() + "\n"
    if "---" not in pre.split("\n")[-5:]:
        pre = pre.rstrip() + "\n\n---\n"
    parts.append(pre)
    if not pre.endswith("\n"):
        parts.append("\n")

    for i, vb in enumerate(vendors, start=1):
        if i > 1:
            parts.append("\n---\n\n")
        parts.append(f"## Vendor {i}: {vb.title}\n\n")
        parts.append(strip_trailing_hrule(vb.body).rstrip() + "\n")

    return "".join(parts)


def main() -> None:
    if not TXT.is_file():
        raise SystemExit(f"Missing {TXT}")

    raw_txt = TXT.read_text(encoding="utf-8")

    incoming: list[VendorBlock] = []
    for title_line, body in split_txt_into_vendors(raw_txt):
        incoming.append(
            VendorBlock(
                title=extract_display_title(title_line) if title_line else "Pasted vendor",
                body=body,
                source_title_line=title_line,
            )
        )

    existing: list[VendorBlock] = []
    preamble = DEFAULT_PREAMBLE
    if MD.is_file():
        preamble, existing = parse_md_vendors(MD.read_text(encoding="utf-8"))
        if not preamble.strip():
            preamble = DEFAULT_PREAMBLE

    merged = merge_vendors(existing, incoming)
    out = render_md(preamble, merged)
    MD.write_text(out, encoding="utf-8")
    print(f"Wrote {MD} ({len(out)} chars), vendors={len(merged)}")
    for i, vb in enumerate(merged, start=1):
        fp = vb.fingerprint or "?"
        print(f"  Vendor {i}: {vb.title[:60]!r} fp={fp}")


if __name__ == "__main__":
    main()
