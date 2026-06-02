#!/usr/bin/env python3
"""
RapidAPI desktop tester: synced tabs from GET /api/provider-tester (fields + defaults, including
api_path per provider); "+ Custom" tabs for any RapidAPI URL + query params (local only).
Synced URLs use POST /api/provider-tester/build-url.

Run: python scripts/linkedin_api_tester.py

Requires Python 3.10+ (tkinter). State persists in scripts/.rapidapi_tester_state.json
(form fields, RapidAPI key(s) comma-separated, Raw/Extracted output panels, last selected tab).

Env: JOB_SEARCH_PUBLIC_BASE_URL overrides wrangler PUBLIC_BASE_URL for catalog + build-url requests.
Env: JOB_SEARCH_TESTER_USER_AGENT — optional override if the Worker still returns 403 (e.g. WAF / bot rules).
"""

from __future__ import annotations

import json
import math
import os
import sys
import threading
import uuid
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
import tkinter as tk
from tkinter import BOTH, END, LEFT, W, X, BooleanVar, PanedWindow, StringVar, Tk
from tkinter import Menu, messagebox, simpledialog
from tkinter import ttk
from tkinter.scrolledtext import ScrolledText
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

# Must stay in sync with wrangler.toml [vars] PUBLIC_BASE_URL.
DEFAULT_WORKER_BASE_URL = "https://job-search.oleg-velikanov.workers.dev"


def _worker_http_headers() -> dict[str, str]:
    """Headers for requests to our Worker. Default urllib User-Agent is often blocked with HTTP 403 by Cloudflare."""
    ua = os.environ.get("JOB_SEARCH_TESTER_USER_AGENT", "").strip()
    if not ua:
        ua = (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 job-search-rapidapi-tester/1"
        )
    return {"Accept": "application/json, text/plain, */*", "User-Agent": ua}

SCRIPT_DIR = Path(__file__).resolve().parent
STATE_PATH = SCRIPT_DIR / ".rapidapi_tester_state.json"
STATE_PATH_LEGACY = SCRIPT_DIR / ".linkedin_api_tester_state.json"


def pick_str(v) -> str | None:
    if isinstance(v, str) and v.strip():
        return v.strip()
    return None


def salary_from_raw(salary_raw: object) -> dict:
    out = {}
    if not salary_raw or not isinstance(salary_raw, dict):
        return out
    o = salary_raw
    cur = pick_str(o.get("currency"))
    val = o.get("value")
    if not val or not isinstance(val, dict):
        return {"salaryCurrency": cur} if cur else {}
    v = val
    min_v = v.get("minValue") if isinstance(v.get("minValue"), (int, float)) else None
    max_v = v.get("maxValue") if isinstance(v.get("maxValue"), (int, float)) else None
    unit = pick_str(v.get("unitText"))
    parts: list[str] = []
    if min_v is not None or max_v is not None:
        if min_v is not None and max_v is not None and min_v != max_v:
            parts.append(f"{min_v}–{max_v}")
        else:
            parts.append(str(min_v if min_v is not None else max_v))
    if cur:
        parts.append(cur)
    if unit:
        parts.append(unit)
    r = {
        "salaryMin": min_v,
        "salaryMax": max_v,
        "salaryCurrency": cur,
        "salaryLine": " ".join(parts) if parts else None,
    }
    return {k: v for k, v in r.items() if v is not None}


def salary_from_ai(raw: dict) -> dict:
    cur = pick_str(raw.get("ai_salary_currency"))
    unit = pick_str(raw.get("ai_salary_unittext"))
    min_v = raw.get("ai_salary_minvalue")
    max_v = raw.get("ai_salary_maxvalue")
    single = raw.get("ai_salary_value")
    min_v = min_v if isinstance(min_v, (int, float)) else None
    max_v = max_v if isinstance(max_v, (int, float)) else None
    single = single if isinstance(single, (int, float)) else None
    parts: list[str] = []
    if min_v is not None or max_v is not None:
        if min_v is not None and max_v is not None and min_v != max_v:
            parts.append(f"{min_v}–{max_v}")
        else:
            parts.append(str(min_v if min_v is not None else max_v))
    elif single is not None:
        parts.append(str(single))
    if cur:
        parts.append(cur)
    if unit:
        parts.append(unit)
    if not parts and not cur:
        return {}
    smin = min_v if min_v is not None else (max_v if max_v is not None else single)
    smax = max_v if max_v is not None else (min_v if min_v is not None else single)
    return {
        "salaryMin": smin,
        "salaryMax": smax,
        "salaryCurrency": cur,
        "salaryLine": " ".join(parts) if parts else None,
    }


def parse_posted_at_unix(raw: dict) -> int | None:
    ts = raw.get("job_posted_at_timestamp")
    if isinstance(ts, (int, float)) and math.isfinite(float(ts)):
        t = float(ts)
        return int(t // 1000) if t > 1e12 else int(t)
    for key in (
        "date_posted",
        "date_created",
        "job_posted_at_datetime_utc",
        "job_posted_at",
        "job_posted_at_datetime",
    ):
        v = raw.get(key)
        if not isinstance(v, str):
            continue
        s = v.strip()
        if not s:
            continue
        try:
            if s.endswith("Z"):
                s = s[:-1] + "+00:00"
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            return int(dt.timestamp())
        except ValueError:
            continue
    return None


def normalize_linkedin_job(raw: dict) -> dict | None:
    external_id = pick_str(raw.get("id"))
    title = pick_str(raw.get("title"))
    company = pick_str(raw.get("organization"))
    job_url = pick_str(raw.get("url"))
    if not external_id or not title or not company or not job_url:
        return None

    desc = pick_str(raw.get("description_text")) or pick_str(raw.get("description_html")) or ""
    ext_apply = pick_str(raw.get("external_apply_url"))
    apply_url = ext_apply if ext_apply else job_url

    locs = raw.get("locations_derived")
    if isinstance(locs, list) and all(isinstance(x, str) for x in locs):
        location = " | ".join(locs)
    else:
        location = ""

    countries = raw.get("countries_derived")
    country = None
    if isinstance(countries, list) and countries and isinstance(countries[0], str):
        country = countries[0]

    is_remote = bool(raw.get("remote_derived"))

    emp = raw.get("employment_type")
    if isinstance(emp, list) and all(isinstance(x, str) for x in emp):
        employment_type = ", ".join(emp)
    else:
        employment_type = None

    from_struct = salary_from_raw(raw.get("salary_raw"))
    from_ai = salary_from_ai(raw)
    has_struct = (
        isinstance(from_struct.get("salaryMin"), (int, float))
        or isinstance(from_struct.get("salaryMax"), (int, float))
        or (from_struct.get("salaryLine") and len(str(from_struct["salaryLine"])) > 0)
    )
    salary_min = from_struct.get("salaryMin") if has_struct else from_ai.get("salaryMin")
    salary_max = from_struct.get("salaryMax") if has_struct else from_ai.get("salaryMax")
    salary_currency = from_struct.get("salaryCurrency") if has_struct else from_ai.get("salaryCurrency")
    salary_line = from_struct.get("salaryLine") if has_struct else from_ai.get("salaryLine")

    posted = parse_posted_at_unix(raw)

    out = {
        "source": "linkedin_jobs",
        "externalId": external_id,
        "title": title,
        "company": company,
        "jobUrl": job_url,
        "applyUrl": apply_url,
        "location": location,
        "country": country,
        "isRemote": is_remote,
        "description": desc,
        "salaryRaw": salary_line,
        "salaryMin": salary_min,
        "salaryMax": salary_max,
        "salaryCurrency": salary_currency,
        "employmentType": employment_type,
        "postedAtUnix": posted,
    }
    return {k: v for k, v in out.items() if v is not None}


def normalize_jsearch_job(raw: dict) -> dict | None:
    external_id = pick_str(raw.get("job_id"))
    title = pick_str(raw.get("job_title"))
    company = pick_str(raw.get("employer_name"))
    apply_url = pick_str(raw.get("job_apply_link")) or pick_str(raw.get("job_google_link"))
    desc_full = pick_str(raw.get("job_description")) or ""

    if not external_id or not title or not company:
        return None

    job_url = pick_str(raw.get("job_google_link")) or apply_url or ""
    location = ", ".join(
        x
        for x in (
            pick_str(raw.get("job_city")),
            pick_str(raw.get("job_state")),
            pick_str(raw.get("job_country")),
        )
        if x
    )

    is_remote = bool(raw.get("job_is_remote"))
    salary_min = raw.get("job_min_salary") if isinstance(raw.get("job_min_salary"), (int, float)) else None
    salary_max = raw.get("job_max_salary") if isinstance(raw.get("job_max_salary"), (int, float)) else None
    salary_raw = pick_str(raw.get("job_salary"))
    salary_currency = pick_str(raw.get("job_salary_currency"))
    employment_type = pick_str(raw.get("job_employment_type"))
    country = pick_str(raw.get("job_country"))
    posted = parse_posted_at_unix(raw)

    out = {
        "source": "jsearch",
        "externalId": external_id,
        "title": title,
        "company": company,
        "jobUrl": job_url,
        "applyUrl": apply_url or "",
        "location": location,
        "country": country,
        "isRemote": is_remote,
        "description": desc_full,
        "salaryRaw": salary_raw,
        "salaryMin": salary_min,
        "salaryMax": salary_max,
        "salaryCurrency": salary_currency,
        "employmentType": employment_type,
        "postedAtUnix": posted,
    }
    return {k: v for k, v in out.items() if v is not None}


def normalize_jobs_api_job(raw: dict) -> dict | None:
    external_id = pick_str(raw.get("id")) or pick_str(raw.get("job_id"))
    title = pick_str(raw.get("title"))
    company = pick_str(raw.get("company_name")) or pick_str(raw.get("company"))
    if not external_id or not title or not company:
        return None

    apply_url = pick_str(raw.get("apply_url")) or pick_str(raw.get("url"))
    job_url = pick_str(raw.get("job_url")) or apply_url or ""
    desc_full = pick_str(raw.get("description")) or pick_str(raw.get("job_description")) or ""

    loc = raw.get("location")
    if isinstance(loc, str) and loc.strip():
        location = loc.strip()
    elif isinstance(loc, dict):
        parts = [
            pick_str(loc.get("city")),
            pick_str(loc.get("state")),
            pick_str(loc.get("country")),
        ]
        location = ", ".join(p for p in parts if p)
    else:
        location = pick_str(loc)

    country = pick_str(raw.get("country")) or pick_str(raw.get("country_code"))
    wt = raw.get("workplace_type")
    if isinstance(wt, list) and all(isinstance(x, str) for x in wt):
        is_remote = any(x.lower() == "remote" for x in wt)
    else:
        is_remote = bool(raw.get("remote")) or (
            isinstance(wt, str) and wt.lower() == "remote"
        )

    employment_type = pick_str(raw.get("employment_type"))
    posted = parse_posted_at_unix(raw)
    if posted is None:
        dp = pick_str(raw.get("date_posted"))
        if dp and len(dp) >= 10 and dp[4] == "-" and dp[7] == "-":
            try:
                y, m, d = int(dp[0:4]), int(dp[5:7]), int(dp[8:10])
                posted = int(datetime(y, m, d, tzinfo=timezone.utc).timestamp())
            except Exception:
                posted = None

    out = {
        "source": "jobs_api",
        "externalId": external_id,
        "title": title,
        "company": company,
        "jobUrl": job_url,
        "applyUrl": apply_url or "",
        "location": location or "",
        "country": country,
        "isRemote": is_remote,
        "description": desc_full,
        "employmentType": employment_type,
        "postedAtUnix": posted,
    }
    return {k: v for k, v in out.items() if v is not None}


def normalize_remote_jobs_job(raw: dict) -> dict | None:
    external_id = pick_str(str(raw.get("id"))) if raw.get("id") is not None else pick_str(raw.get("slug"))
    title = pick_str(raw.get("title"))
    company_raw = raw.get("company")
    company = pick_str(company_raw.get("name")) if isinstance(company_raw, dict) else None
    job_url = pick_str(raw.get("url"))
    desc_full = pick_str(raw.get("description")) or ""
    if not external_id or not title or not company or not job_url:
        return None

    countries = raw.get("countries")
    country = None
    if isinstance(countries, list) and countries and isinstance(countries[0], str):
        country = countries[0].upper()
    employment_types = raw.get("employmentTypes")
    employment_type = None
    if isinstance(employment_types, list) and employment_types and isinstance(employment_types[0], str):
        employment_type = employment_types[0]
    location_types = raw.get("locationTypes")
    is_remote = isinstance(location_types, list) and any(
        isinstance(x, str) and x.strip().lower() == "remote" for x in location_types
    )
    posted = None
    for key in ("datePosted", "dateCreated", "createdAt", "created_at"):
        v = pick_str(raw.get(key))
        if not v:
            continue
        try:
            s = v[:-1] + "+00:00" if v.endswith("Z") else v
            dt = datetime.fromisoformat(s)
            if dt.tzinfo is None:
                dt = dt.replace(tzinfo=timezone.utc)
            posted = int(dt.timestamp())
            break
        except ValueError:
            continue

    out = {
        "source": "remote_jobs",
        "externalId": external_id,
        "title": title,
        "company": company,
        "jobUrl": job_url,
        "applyUrl": job_url,
        "location": country or "",
        "country": country,
        "isRemote": is_remote,
        "description": desc_full,
        "employmentType": employment_type,
        "postedAtUnix": posted,
    }
    return {k: v for k, v in out.items() if v is not None}


def normalize_job_row(provider_id: str, item: dict) -> dict | None:
    if provider_id == "linkedin_jobs":
        return normalize_linkedin_job(item)
    if provider_id == "jsearch":
        return normalize_jsearch_job(item)
    if provider_id == "jobs_api":
        return normalize_jobs_api_job(item)
    if provider_id == "remote_jobs":
        return normalize_remote_jobs_job(item)
    return None


def jobs_array_from_response(provider: dict, parsed: object) -> list | None:
    path = provider.get("jobsArrayPath")
    if path == "root":
        return parsed if isinstance(parsed, list) else None
    if path == "data":
        if isinstance(parsed, dict) and isinstance(parsed.get("data"), list):
            return parsed["data"]
        return None
    return None


def _with_last_tab_pid(base: dict, raw: dict | None) -> dict:
    if isinstance(raw, dict):
        lt = raw.get("last_tab_pid")
        if isinstance(lt, str) and lt.strip():
            base["last_tab_pid"] = lt.strip()
    return base


def normalize_state(raw: dict | None) -> dict:
    if not raw or not isinstance(raw, dict):
        return {"rapidapi_key": "", "providers": {}}
    rk = str(raw.get("rapidapi_key", ""))
    if "providers" in raw and isinstance(raw["providers"], dict):
        return _with_last_tab_pid({"rapidapi_key": rk, "providers": dict(raw["providers"])}, raw)
    prov: dict = {}
    if isinstance(raw.get("linkedin"), dict):
        prov["linkedin_jobs"] = raw["linkedin"]
    if isinstance(raw.get("jsearch"), dict):
        prov["jsearch"] = raw["jsearch"]
    return _with_last_tab_pid({"rapidapi_key": rk, "providers": prov}, raw)


def load_state() -> dict:
    raw: dict | None = None
    if STATE_PATH.is_file():
        try:
            raw = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raw = None
    if raw is None and STATE_PATH_LEGACY.is_file():
        try:
            raw = json.loads(STATE_PATH_LEGACY.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raw = None
    return normalize_state(raw)


def save_state(state: dict) -> None:
    try:
        STATE_PATH.write_text(json.dumps(state, indent=2), encoding="utf-8")
    except OSError as e:
        print("Could not save state:", e, file=sys.stderr)


def worker_base() -> str | None:
    base = os.environ.get("JOB_SEARCH_PUBLIC_BASE_URL", DEFAULT_WORKER_BASE_URL).strip().rstrip("/")
    return base if base else None


def fetch_provider_catalog() -> dict:
    base = worker_base()
    if not base:
        raise RuntimeError("JOB_SEARCH_PUBLIC_BASE_URL is empty")
    url = f"{base}/api/provider-tester"
    req = urllib.request.Request(url, headers=_worker_http_headers(), method="GET")
    with urllib.request.urlopen(req, timeout=25) as resp:
        body = resp.read().decode("utf-8", errors="replace")
    data = json.loads(body)
    if not isinstance(data, dict):
        raise ValueError("catalog is not a JSON object")
    provs = data.get("providers")
    if not isinstance(provs, list) or not provs:
        raise ValueError("catalog.providers missing or empty")
    return data


def post_build_url(provider_id: str, params: dict) -> dict:
    base = worker_base()
    if not base:
        raise RuntimeError("JOB_SEARCH_PUBLIC_BASE_URL is empty")
    url = f"{base}/api/provider-tester/build-url"
    payload = json.dumps({"providerId": provider_id, "params": params}).encode("utf-8")
    h = _worker_http_headers()
    h["Content-Type"] = "application/json; charset=utf-8"
    req = urllib.request.Request(url, data=payload, headers=h, method="POST")
    with urllib.request.urlopen(req, timeout=30) as resp:
        body = resp.read().decode("utf-8", errors="replace")
    return json.loads(body)


def merge_params(defaults: dict, saved: dict | None) -> dict:
    out = dict(defaults)
    if saved:
        for k, v in saved.items():
            if k in defaults:
                out[k] = v
    return out


def build_custom_get_url(base_raw: str, params: list[tuple[str, str]]) -> tuple[str, str]:
    """Build GET URL and RapidAPI host header from base URL + query param pairs."""
    s = (base_raw or "").strip()
    if not s:
        return "", ""
    if not s.lower().startswith(("http://", "https://")):
        s = "https://" + s
    p = urlparse(s)
    if not p.netloc:
        return "", ""
    host = p.netloc.split("@")[-1].lower()
    q_existing = dict(parse_qsl(p.query, keep_blank_values=True))
    for k, v in params:
        kk = (k or "").strip()
        if kk:
            q_existing[kk] = v if v is not None else ""
    path = p.path if p.path else "/"
    qs = urlencode(q_existing)
    full = urlunparse((p.scheme or "https", p.netloc, path, "", qs, ""))
    return full, host


def parse_rapidapi_keys(raw: str) -> list[str]:
    """Split user input on commas; trim segments; drop empties. First key is tried first."""
    return [p.strip() for p in raw.split(",") if p.strip()]


class App(Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("RapidAPI job provider tester")
        self.geometry("1100x760")
        self.minsize(800, 500)

        self.state_root = load_state()
        self.catalog: dict | None = None
        self.provider_forms: dict[str, dict] = {}
        self.provider_outputs: dict[str, tuple[ScrolledText, ScrolledText]] = {}
        self.provider_meta: dict[str, dict] = {}
        self.notebook: ttk.Notebook | None = None
        self._plus_tab_placeholder: ttk.Frame | None = None
        self._suppress_tab_notebook = False
        self._last_tab_pid: str | None = None

        root = ttk.Frame(self, padding=8)
        root.pack(fill=BOTH, expand=True)

        key_row = ttk.Frame(root)
        key_row.pack(fill=X, pady=(0, 2))
        ttk.Label(key_row, text="RapidAPI key(s):").pack(side=LEFT)
        self.key_var = StringVar(value=self.state_root.get("rapidapi_key", ""))
        key_entry = ttk.Entry(key_row, textvariable=self.key_var, width=64, show="*")
        key_entry.pack(side=LEFT, padx=8, fill=X, expand=True)
        ttk.Label(
            root,
            text="Use commas between keys. Synced and custom GET calls use the first key first; on HTTP 403 or 429, the next key is tried automatically.",
            font=("Segoe UI", 8),
            foreground="#64748b",
            wraplength=920,
            justify="left",
        ).pack(anchor=W, pady=(0, 4))

        self.status_var = StringVar(value="Loading provider catalog…")
        ttk.Label(root, textvariable=self.status_var, foreground="#2563eb").pack(anchor=W)

        self.retry_row = ttk.Frame(root)
        self.retry_btn = ttk.Button(self.retry_row, text="Retry catalog load", command=self._load_catalog_thread)
        self.retry_btn.pack(side=LEFT)

        self.content_frame = ttk.Frame(root)
        self.content_frame.pack(fill=BOTH, expand=True, pady=6)

        self.key_var.trace_add("write", lambda *_: self.persist())

        self.after(200, self._load_catalog_thread)

    def _load_catalog_thread(self) -> None:
        self.status_var.set("Loading provider catalog…")
        # Keep self.retry_row as the same Frame; never assign None (success path calls pack_forget).
        self.retry_row.pack_forget()

        def work() -> None:
            try:
                cat = fetch_provider_catalog()
                self.after(0, lambda: self._on_catalog_loaded(cat))
            except Exception as e:
                self.after(0, lambda err=e: self._on_catalog_failed(err))

        threading.Thread(target=work, daemon=True).start()

    def _on_catalog_failed(self, err: Exception) -> None:
        self.status_var.set(f"Catalog load failed: {err}")
        self.retry_row.pack(fill=X, pady=4)

    def _on_catalog_loaded(self, cat: dict) -> None:
        self.state_root = load_state()
        self.catalog = cat
        self.retry_row.pack_forget()
        pub = cat.get("publicBaseUrl")
        hint = f" ({pub.strip()})" if isinstance(pub, str) and pub.strip() else ""
        self.status_var.set(f"Loaded provider catalog from worker{hint}.")
        for w in self.content_frame.winfo_children():
            w.destroy()
        self.provider_forms.clear()
        self.provider_outputs.clear()
        self.provider_meta.clear()
        self._build_catalog_ui(self.content_frame)

    def _build_catalog_ui(self, parent: ttk.Frame) -> None:
        assert self.catalog is not None
        self._suppress_tab_notebook = True
        nb = ttk.Notebook(parent)
        nb.pack(fill=BOTH, expand=True)
        self.notebook = nb

        for prov in self.catalog["providers"]:
            if not isinstance(prov, dict):
                continue
            pid = str(prov.get("id", ""))
            if not pid:
                continue
            tab = ttk.Frame(nb, padding=4)
            nb.add(tab, text=str(prov.get("label", pid)))
            setattr(tab, "_cid", pid)
            self.provider_meta[pid] = prov
            self._build_provider_tab(tab, prov)

        plus = ttk.Frame(nb, padding=12)
        ttk.Label(
            plus,
            text="Choose this tab to add a custom RapidAPI endpoint (not synced with the Worker).",
            wraplength=520,
        ).pack(anchor=W)
        nb.add(plus, text="+ Custom")
        self._plus_tab_placeholder = plus
        setattr(plus, "_cid", "__plus__")

        prov_state = self.state_root.get("providers", {})
        if isinstance(prov_state, dict):
            for cid in sorted(k for k in prov_state if isinstance(k, str) and k.startswith("custom:")):
                d = prov_state.get(cid)
                if isinstance(d, dict) and d.get("custom") is True:
                    self._insert_custom_tab_before_plus(nb, cid, d)

        nb.bind("<<NotebookTabChanged>>", self._on_notebook_tab_changed)
        nb.bind("<Button-3>", self._on_notebook_tab_strip_right_click)
        nb.bind("<Button-2>", self._on_notebook_tab_strip_right_click)
        self._suppress_tab_notebook = False
        self._finalize_select_last_tab()

    def _finalize_select_last_tab(self) -> None:
        nb = self.notebook
        if not nb:
            return
        want = self.state_root.get("last_tab_pid")
        if want is None or not str(want).strip():
            want = getattr(self, "_last_tab_pid", None)
        if not want or not isinstance(want, str):
            return
        want = want.strip()
        for i in range(nb.index("end")):
            w = nb.nametowidget(nb.tabs()[i])
            cid = getattr(w, "_cid", None)
            if cid == want:
                self._suppress_tab_notebook = True
                try:
                    nb.select(i)
                except tk.TclError:
                    pass
                self._suppress_tab_notebook = False
                self._last_tab_pid = want
                return

    def _on_notebook_tab_strip_right_click(self, event: tk.Event) -> None:
        """Right-click on tab labels (ttk.Notebook tab strip)."""
        nb = self.notebook
        if not nb:
            return
        try:
            idx = nb.index(f"@{event.x},{event.y}")
        except tk.TclError:
            return
        w = nb.nametowidget(nb.tabs()[idx])
        cid = getattr(w, "_cid", None)
        if not cid or cid == "__plus__" or not str(cid).startswith("custom:"):
            return
        self._popup_custom_tab_menu(event, str(cid))

    def _popup_custom_tab_menu(self, event: tk.Event, cid: str) -> None:
        m = Menu(self, tearoff=0)
        m.add_command(label="Edit name…", command=lambda: self._rename_custom_tab(cid))
        m.add_command(label="Delete tab", command=lambda: self._delete_custom_tab(cid))
        try:
            m.tk_popup(event.x_root, event.y_root)
        finally:
            try:
                m.grab_release()
            except tk.TclError:
                pass

    def _rename_custom_tab(self, cid: str) -> None:
        meta = self.provider_meta.get(cid)
        if not meta or not meta.get("custom"):
            return
        old = str(meta.get("label", "")).strip()
        new = simpledialog.askstring(
            "Edit name",
            "Provider name (shown after [C] on the tab):",
            parent=self,
            initialvalue=old,
        )
        if new is None:
            return
        new = str(new).strip()
        if not new:
            return
        meta["label"] = new
        nb = self.notebook
        if nb:
            for i in range(nb.index("end")):
                w = nb.nametowidget(nb.tabs()[i])
                if getattr(w, "_cid", None) == cid:
                    nb.tab(i, text=f"[C] {new}")
                    break
        self.persist()

    def _delete_custom_tab(self, cid: str) -> None:
        meta = self.provider_meta.get(cid)
        if not meta or not meta.get("custom"):
            return
        if not messagebox.askyesno(
            "Delete tab",
            "Remove this custom tab? Its saved fields will be deleted.",
            parent=self,
        ):
            return
        nb = self.notebook
        if not nb:
            return
        idx_remove: int | None = None
        for i in range(nb.index("end")):
            w = nb.nametowidget(nb.tabs()[i])
            if getattr(w, "_cid", None) == cid:
                idx_remove = i
                break
        if idx_remove is None:
            return
        self._suppress_tab_notebook = True
        try:
            nb.forget(idx_remove)
        except tk.TclError:
            pass
        self.provider_forms.pop(cid, None)
        self.provider_outputs.pop(cid, None)
        self.provider_meta.pop(cid, None)
        try:
            nb.select(0)
        except tk.TclError:
            pass
        self._suppress_tab_notebook = False
        self.persist()

    def _bind_custom_tab_right_click_recursive(self, widget: tk.Widget, cid: str) -> None:
        """Right-click anywhere on custom tab content opens the same menu as the tab strip."""

        def show(e: tk.Event, c: str = cid) -> None:
            self._popup_custom_tab_menu(e, c)

        widget.bind("<Button-3>", show)
        widget.bind("<Button-2>", show)
        for ch in widget.winfo_children():
            self._bind_custom_tab_right_click_recursive(ch, cid)

    def _insert_custom_tab_before_plus(self, nb: ttk.Notebook, cid: str, data: dict) -> None:
        if self._plus_tab_placeholder is None:
            return
        lbl = str(data.get("label") or "Custom").strip() or "Custom"
        tab = ttk.Frame(nb, padding=4)
        idx = nb.index(self._plus_tab_placeholder)
        nb.insert(idx, tab, text=f"[C] {lbl}")
        setattr(tab, "_cid", cid)
        self.provider_meta[cid] = {"id": cid, "custom": True, "label": lbl}
        self._build_custom_tab_inner(tab, cid, data)

    def _on_notebook_tab_changed(self, _event: object | None = None) -> None:
        if self._suppress_tab_notebook or self.notebook is None:
            return
        try:
            sel = self.notebook.select()
        except tk.TclError:
            return
        w = self.notebook.nametowidget(sel)
        cid = getattr(w, "_cid", None)
        if cid and cid != "__plus__":
            self._last_tab_pid = str(cid)
            self.persist()
        if self._plus_tab_placeholder is None:
            return
        if str(sel) != str(self._plus_tab_placeholder):
            return
        name = simpledialog.askstring(
            "Custom provider",
            "Provider name (e.g. Stone Jobs):\n\n[C] will be shown on the tab.",
            parent=self,
        )
        if not name or not str(name).strip():
            self._suppress_tab_notebook = True
            try:
                self.notebook.select(0)
            except tk.TclError:
                pass
            self._suppress_tab_notebook = False
            return
        name = str(name).strip()
        cid = f"custom:{uuid.uuid4().hex[:12]}"
        nb = self.notebook
        idx = nb.index(self._plus_tab_placeholder)
        tab = ttk.Frame(nb, padding=4)
        nb.insert(idx, tab, text=f"[C] {name}")
        setattr(tab, "_cid", cid)
        self.provider_meta[cid] = {"id": cid, "custom": True, "label": name}
        self._build_custom_tab_inner(
            tab,
            cid,
            {"label": name, "base_url": "", "params": [], "custom": True},
        )
        self._suppress_tab_notebook = True
        try:
            nb.select(tab)
        except tk.TclError:
            pass
        self._suppress_tab_notebook = False
        self.persist()

    def _build_custom_tab_inner(self, parent: ttk.Frame, cid: str, data: dict) -> None:
        form: dict = {}
        self.provider_forms[cid] = form

        lf = ttk.LabelFrame(parent, text="Custom API (not synced with app catalog)", padding=8)
        lf.pack(fill=X, pady=(0, 6))
        ttk.Label(
            lf,
            text=(
                "API endpoint URL (scheme + host + path; host → X-RapidAPI-Host). "
                "Example: https://jsearch.p.rapidapi.com/search"
            ),
            wraplength=420,
            justify=LEFT,
        ).grid(row=0, column=0, sticky="nw", padx=(0, 6))
        bu = ttk.Entry(lf, width=78)
        bu.insert(0, str(data.get("base_url", "") or ""))
        bu.grid(row=0, column=1, sticky="ew", pady=2)
        bu.bind("<KeyRelease>", lambda _e: self.persist())
        form["base_url"] = bu
        lf.columnconfigure(1, weight=1)

        pr = ttk.LabelFrame(parent, text="Query parameters", padding=6)
        pr.pack(fill=BOTH, expand=False, pady=4)
        btn_row_p = ttk.Frame(pr)
        btn_row_p.pack(fill=X, pady=(0, 4))

        def add_param() -> None:
            pname = simpledialog.askstring("Parameter name", "Query parameter name:", parent=self)
            if pname and str(pname).strip():
                self._add_param_row(cid, str(pname).strip(), "")

        ttk.Button(btn_row_p, text="+ param", command=add_param).pack(side=LEFT)
        rows_f = ttk.Frame(pr)
        rows_f.pack(fill=BOTH, expand=True)
        form["params_rows_frame"] = rows_f
        form["param_rows"] = []

        for p in data.get("params", []):
            if isinstance(p, dict) and p.get("name"):
                self._add_param_row(cid, str(p["name"]), str(p.get("value", "")))

        btn_row = ttk.Frame(parent)
        btn_row.pack(fill=X, pady=4)
        ttk.Button(btn_row, text="Run", command=lambda c=cid: self.run_provider(c)).pack(side=LEFT)
        ttk.Button(
            btn_row,
            text="Clear outputs",
            command=lambda c=cid: self._clear_tab_outputs(c),
        ).pack(side=LEFT, padx=(8, 0))
        ttk.Label(btn_row, text=f"state: {STATE_PATH.name} · GET + RapidAPI headers").pack(side=LEFT, padx=12)

        paned = PanedWindow(parent, orient="horizontal", sashrelief="raised", sashwidth=6)
        paned.pack(fill=BOTH, expand=True, pady=4)

        left_f = ttk.LabelFrame(paned, text="Extracted (custom — full response JSON)", padding=4)
        right_f = ttk.LabelFrame(paned, text="Raw API JSON", padding=4)
        paned.add(left_f, stretch="always")
        paned.add(right_f, stretch="always")

        out_ex = ScrolledText(left_f, wrap="word", font=("Consolas", 9))
        out_ex.pack(fill=BOTH, expand=True)
        out_raw = ScrolledText(right_f, wrap="word", font=("Consolas", 9))
        out_raw.pack(fill=BOTH, expand=True)
        self.provider_outputs[cid] = (out_ex, out_raw)

        self.apply_provider_outputs(cid, data if isinstance(data, dict) else None)
        self._bind_output_persist(out_ex, out_raw)
        self._bind_custom_tab_right_click_recursive(parent, cid)

    def _add_param_row(self, cid: str, name: str, value: str = "") -> None:
        form = self.provider_forms.get(cid)
        if not form:
            return
        container = form["params_rows_frame"]

        row = ttk.Frame(container)
        ttk.Label(row, text=f"{name}:", width=22).pack(side=LEFT)
        ve = ttk.Entry(row, width=52)
        ve.insert(0, value)
        ve.pack(side=LEFT, padx=4, fill=X, expand=True)
        ve.bind("<KeyRelease>", lambda _e: self.persist())

        def remove() -> None:
            row.destroy()
            form["param_rows"] = [r for r in form["param_rows"] if r.get("frame") is not row]
            self.persist()

        ttk.Button(row, text="✕", width=2, command=remove).pack(side=LEFT)
        row.pack(fill=X, pady=2)
        form["param_rows"].append({"name": name, "value_entry": ve, "frame": row})
        self.persist()

    def collect_custom_params(self, cid: str) -> dict:
        form = self.provider_forms.get(cid, {})
        meta = self.provider_meta.get(cid, {})
        plist: list[dict[str, str]] = []
        for row in form.get("param_rows", []):
            n = row.get("name", "")
            if n:
                ve = row.get("value_entry")
                v = ve.get() if isinstance(ve, ttk.Entry) else ""
                plist.append({"name": n, "value": v})
        be = form.get("base_url")
        base_url = be.get().strip() if isinstance(be, ttk.Entry) else ""
        return {
            "custom": True,
            "label": str(meta.get("label", "")),
            "base_url": base_url,
            "params": plist,
        }

    def _build_provider_tab(self, parent: ttk.Frame, prov: dict) -> None:
        pid = str(prov["id"])
        defaults = prov.get("defaults")
        if not isinstance(defaults, dict):
            defaults = {}
        saved = self.state_root.get("providers", {})
        saved_entry = saved.get(pid) if isinstance(saved, dict) else None
        merged = merge_params(defaults, saved_entry if isinstance(saved_entry, dict) else None)

        form: dict = {}
        self.provider_forms[pid] = form

        form_grid = ttk.LabelFrame(
            parent,
            text=f"Request parameters ({prov.get('requestSource', '')})",
            padding=8,
        )
        form_grid.pack(fill=X, pady=(0, 6))
        fields = prov.get("fields")
        if not isinstance(fields, list):
            fields = []

        r = 0
        for spec in fields:
            if not isinstance(spec, dict):
                continue
            r = self._add_field_row(form_grid, form, r, spec, merged)

        form_grid.columnconfigure(1, weight=1)

        btn_row = ttk.Frame(parent)
        btn_row.pack(fill=X, pady=4)
        ttk.Button(btn_row, text="Run", command=lambda p=pid: self.run_provider(p)).pack(side=LEFT)
        ttk.Button(
            btn_row,
            text="Restore defaults",
            command=lambda p=pid: self.restore_defaults(p),
        ).pack(side=LEFT, padx=(8, 0))
        ttk.Button(
            btn_row,
            text="Clear outputs",
            command=lambda p=pid: self._clear_tab_outputs(p),
        ).pack(side=LEFT, padx=(8, 0))
        ttk.Label(btn_row, text=f"state: {STATE_PATH.name}").pack(side=LEFT, padx=12)

        ex = prov.get("extractor", "")
        if ex == "linkedin_jobs":
            ext_label = "Extracted (LinkedIn / Fantastic Jobs — full description)"
        elif ex == "jsearch":
            ext_label = "Extracted (JSearch — full description)"
        elif ex == "jobs_api":
            ext_label = "Extracted (Jobs API — full description)"
        elif ex == "remote_jobs":
            ext_label = "Extracted (Remote Jobs — full description)"
        else:
            ext_label = "Extracted"

        paned = PanedWindow(parent, orient="horizontal", sashrelief="raised", sashwidth=6)
        paned.pack(fill=BOTH, expand=True, pady=4)

        left_f = ttk.LabelFrame(paned, text=ext_label, padding=4)
        right_f = ttk.LabelFrame(paned, text="Raw API JSON", padding=4)
        paned.add(left_f, stretch="always")
        paned.add(right_f, stretch="always")

        out_ex = ScrolledText(left_f, wrap="word", font=("Consolas", 9))
        out_ex.pack(fill=BOTH, expand=True)
        out_raw = ScrolledText(right_f, wrap="word", font=("Consolas", 9))
        out_raw.pack(fill=BOTH, expand=True)
        self.provider_outputs[pid] = (out_ex, out_raw)

        self.apply_provider_params(pid, merged)
        self.apply_provider_outputs(pid, saved_entry if isinstance(saved_entry, dict) else None)
        self._bind_output_persist(out_ex, out_raw)

    def _bind_output_persist(self, out_ex: ScrolledText, out_raw: ScrolledText) -> None:
        def save(_e: object | None = None) -> None:
            self.persist()

        out_ex.bind("<KeyRelease>", save)
        out_raw.bind("<KeyRelease>", save)

    def collect_provider_outputs(self, pid: str) -> dict[str, str]:
        outs = self.provider_outputs.get(pid)
        if not outs:
            return {"extracted": "", "raw": ""}
        out_ex, out_raw = outs
        return {
            "extracted": out_ex.get("1.0", END).rstrip("\n"),
            "raw": out_raw.get("1.0", END).rstrip("\n"),
        }

    def apply_provider_outputs(self, pid: str, data: dict | None) -> None:
        if not data or not isinstance(data, dict):
            return
        o = data.get("outputs")
        if not isinstance(o, dict):
            return
        outs = self.provider_outputs.get(pid)
        if not outs:
            return
        out_ex, out_raw = outs
        ex = o.get("extracted")
        raw = o.get("raw")
        if isinstance(ex, str):
            out_ex.delete("1.0", END)
            out_ex.insert("1.0", ex)
        if isinstance(raw, str):
            out_raw.delete("1.0", END)
            out_raw.insert("1.0", raw)

    def _clear_tab_outputs(self, pid: str) -> None:
        if not messagebox.askyesno(
            "Clear outputs",
            "Clear Raw API JSON and Extracted text for this tab?\n\n"
            "They are normally kept across restarts until you clear them.",
            parent=self,
        ):
            return
        if not messagebox.askyesno(
            "Clear outputs — confirm",
            "Clear both panels now? (Second confirmation.)",
            parent=self,
        ):
            return
        outs = self.provider_outputs.get(pid)
        if not outs:
            return
        out_ex, out_raw = outs
        out_ex.delete("1.0", END)
        out_raw.delete("1.0", END)
        self.persist()

    def _add_field_row(self, form_grid: ttk.LabelFrame, form: dict, r: int, spec: dict, merged: dict) -> int:
        key = str(spec.get("key", ""))
        label = str(spec.get("label", key))
        kind = str(spec.get("kind", "string"))
        val = merged.get(key)

        if kind == "multiline":
            ttk.Label(form_grid, text=label).grid(row=r, column=0, sticky="nw", pady=2)
            h = int(spec.get("height") or 4)
            tt = ScrolledText(form_grid, height=h, wrap="word", font=("Segoe UI", 9))
            tt.insert("1.0", str(val if val is not None else ""))
            tt.grid(row=r, column=1, sticky="nsew", pady=2)
            form_grid.rowconfigure(r, weight=1)
            form[key] = tt
            tt.bind("<KeyRelease>", lambda _e: self.persist())
            return r + 1

        if kind == "int":
            ttk.Label(form_grid, text=label).grid(row=r, column=0, sticky=W, pady=2)
            lo = int(spec.get("min") or 0)
            hi = int(spec.get("max") or 999999)
            sp = ttk.Spinbox(form_grid, from_=lo, to=hi, width=12)
            sp.delete(0, END)
            sp.insert(0, str(int(val) if val is not None else lo))
            sp.grid(row=r, column=1, sticky=W, pady=2)
            form[key] = sp
            sp.bind("<KeyRelease>", lambda _e: self.persist())
            sp.bind("<ButtonRelease-1>", lambda _e: self.persist())
            return r + 1

        if kind == "enum":
            opts = spec.get("options")
            if not isinstance(opts, list) or not opts:
                opts = [""]
            opts = [str(x) for x in opts]
            ttk.Label(form_grid, text=label).grid(row=r, column=0, sticky=W, pady=2)
            cb = ttk.Combobox(form_grid, values=opts, width=28, state="readonly")
            v = str(val if val is not None else opts[0])
            cb.set(v if v in opts else opts[0])
            cb.grid(row=r, column=1, sticky=W, pady=2)
            form[key] = cb
            cb.bind("<<ComboboxSelected>>", lambda _e: self.persist())
            return r + 1

        if kind == "bool":
            bl = str(spec.get("checkboxLabel") or label)
            bv = BooleanVar(value=bool(val))
            cb = ttk.Checkbutton(form_grid, text=bl, variable=bv)
            cb.grid(row=r, column=0, columnspan=2, sticky=W, pady=4)
            form[key] = bv
            bv.trace_add("write", lambda *_: self.persist())
            return r + 1

        ttk.Label(form_grid, text=label).grid(row=r, column=0, sticky=W, pady=2)
        e = ttk.Entry(form_grid, width=70)
        e.insert(0, str(val if val is not None else ""))
        e.grid(row=r, column=1, sticky="ew", pady=2)
        form[key] = e
        e.bind("<KeyRelease>", lambda _e: self.persist())
        return r + 1

    def _collect_field(self, form: dict, spec: dict) -> object:
        key = str(spec.get("key", ""))
        kind = str(spec.get("kind", "string"))
        w = form.get(key)
        if kind == "multiline":
            if isinstance(w, ScrolledText):
                return w.get("1.0", END).rstrip("\n")
            return ""
        if kind == "int":
            if isinstance(w, ttk.Spinbox):
                try:
                    return int(w.get().strip() or 0)
                except ValueError:
                    return 0
            return 0
        if kind == "enum":
            if isinstance(w, ttk.Combobox):
                return str(w.get()).strip()
            return ""
        if kind == "bool":
            if isinstance(w, BooleanVar):
                return w.get()
            return False
        if isinstance(w, ttk.Entry):
            return str(w.get()).strip()
        return ""

    def collect_provider_params(self, pid: str) -> dict:
        prov = self.provider_meta.get(pid)
        if not prov:
            return {}
        fields = prov.get("fields")
        if not isinstance(fields, list):
            return {}
        form = self.provider_forms.get(pid, {})
        out: dict = {}
        for spec in fields:
            if isinstance(spec, dict) and spec.get("key"):
                k = str(spec["key"])
                out[k] = self._collect_field(form, spec)
        return out

    def apply_provider_params(self, pid: str, data: dict) -> None:
        prov = self.provider_meta.get(pid)
        if not prov:
            return
        fields = prov.get("fields")
        if not isinstance(fields, list):
            return
        form = self.provider_forms.get(pid, {})
        for spec in fields:
            if not isinstance(spec, dict):
                continue
            key = str(spec.get("key", ""))
            kind = str(spec.get("kind", "string"))
            if key not in data:
                continue
            val = data[key]
            w = form.get(key)
            if kind == "multiline" and isinstance(w, ScrolledText):
                w.delete("1.0", END)
                w.insert("1.0", str(val))
            elif kind == "int" and isinstance(w, ttk.Spinbox):
                w.delete(0, END)
                w.insert(0, str(int(val)))
            elif kind == "enum" and isinstance(w, ttk.Combobox):
                opts = spec.get("options")
                opts = [str(x) for x in opts] if isinstance(opts, list) else []
                v = str(val)
                w.set(v if v in opts else (opts[0] if opts else v))
            elif kind == "bool" and isinstance(w, BooleanVar):
                w.set(bool(val))
            elif isinstance(w, ttk.Entry):
                w.delete(0, END)
                w.insert(0, str(val))

    def restore_defaults(self, pid: str) -> None:
        prov = self.provider_meta.get(pid)
        if not prov or prov.get("custom"):
            return
        d = prov.get("defaults")
        if not isinstance(d, dict):
            return
        self.apply_provider_params(pid, d)
        self.persist()
        self.status_var.set(f"Restored defaults for {prov.get('label', pid)} from catalog.")

    def collect_root(self) -> dict:
        out: dict = {"rapidapi_key": self.key_var.get().strip(), "providers": {}}
        lt = getattr(self, "_last_tab_pid", None)
        if lt is None:
            lt = self.state_root.get("last_tab_pid")
        if isinstance(lt, str) and lt.strip():
            out["last_tab_pid"] = lt.strip()
        for pid in self.provider_forms:
            meta = self.provider_meta.get(pid, {})
            if meta.get("custom"):
                row = self.collect_custom_params(pid)
                row["outputs"] = self.collect_provider_outputs(pid)
                out["providers"][pid] = row
            else:
                row = self.collect_provider_params(pid)
                row["outputs"] = self.collect_provider_outputs(pid)
                out["providers"][pid] = row
        return out

    def persist(self) -> None:
        save_state(self.collect_root())

    def _rapidapi_get_with_key_rotation(
        self,
        url: str,
        host: str,
        keys: list[str],
        out_raw: ScrolledText,
        *,
        include_json_content_type: bool = False,
    ) -> str | None:
        """GET with X-RapidAPI-* headers. On HTTP 403/429, retry with the next key (first key first)."""
        for i, api_key in enumerate(keys):
            h = _worker_http_headers()
            h["X-RapidAPI-Key"] = api_key
            h["X-RapidAPI-Host"] = host
            h["Accept"] = "application/json"
            if include_json_content_type:
                h["Content-Type"] = "application/json"
            req = urllib.request.Request(url, headers=h, method="GET")
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    body = resp.read().decode("utf-8", errors="replace")
                    if i > 0:
                        out_raw.insert(
                            END,
                            f"\n(Used RapidAPI key {i + 1} of {len(keys)} after HTTP 403/429 on earlier key(s).)\n\n",
                        )
                    return body
            except urllib.error.HTTPError as e:
                err_body = e.read().decode("utf-8", errors="replace") if e.fp else ""
                code = e.code
                if code in (403, 429) and i < len(keys) - 1:
                    out_raw.insert(
                        END,
                        f"HTTP {code} with key {i + 1}/{len(keys)}; trying next key…\n{err_body[:2000]}\n\n",
                    )
                    self.update_idletasks()
                    continue
                out_raw.insert(END, f"HTTP {code}\n{err_body}")
                return None
            except urllib.error.URLError as e:
                out_raw.insert(END, f"RapidAPI request failed: {e}")
                return None
        return None

    def run_provider(self, pid: str) -> None:
        self.persist()
        prov = self.provider_meta.get(pid)
        if prov and prov.get("custom"):
            self._run_custom_provider(pid)
            return

        outs = self.provider_outputs.get(pid)
        if not outs:
            return
        out_ex, out_raw = outs
        try:
            out_raw.delete("1.0", END)
            out_ex.delete("1.0", END)

            keys = parse_rapidapi_keys(self.key_var.get())
            if not keys:
                out_raw.insert(END, "Set RapidAPI key first (one or more, comma-separated).")
                return

            if not prov:
                out_raw.insert(END, "Unknown provider.")
                return

            params = self.collect_provider_params(pid)
            try:
                res = post_build_url(pid, params)
            except urllib.error.HTTPError as e:
                err_body = e.read().decode("utf-8", errors="replace") if e.fp else ""
                out_raw.insert(END, f"POST build-url HTTP {e.code}\n{err_body}")
                return
            except urllib.error.URLError as e:
                out_raw.insert(END, f"POST build-url failed: {e}")
                return
            except Exception as e:
                out_raw.insert(END, f"POST build-url failed: {e}")
                return

            if not res.get("ok"):
                out_raw.insert(END, json.dumps(res, indent=2, ensure_ascii=False))
                return

            url = str(res.get("url", ""))
            host = str(res.get("rapidApiHost", prov.get("rapidApiHost", "")))

            out_raw.insert(END, f"GET {url}\n\n")
            self.update_idletasks()

            body = self._rapidapi_get_with_key_rotation(url, host, keys, out_raw)
            if body is None:
                return

            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                out_raw.insert(END, body)
                return

            out_raw.insert(END, json.dumps(parsed, indent=2, ensure_ascii=False))

            arr = jobs_array_from_response(prov, parsed)
            if arr is None:
                out_ex.insert(
                    END,
                    json.dumps(
                        {
                            "error": "Unexpected JSON shape for this provider",
                            "jobsArrayPath": prov.get("jobsArrayPath"),
                        },
                        indent=2,
                        ensure_ascii=False,
                    ),
                )
                return

            extracted: list[dict] = []
            for item in arr:
                if isinstance(item, dict):
                    n = normalize_job_row(pid, item)
                    if n:
                        extracted.append(n)
            out_ex.insert(
                END,
                json.dumps({"count": len(extracted), "jobs": extracted}, indent=2, ensure_ascii=False),
            )
        finally:
            self.persist()

    def _run_custom_provider(self, pid: str) -> None:
        self.persist()
        outs = self.provider_outputs.get(pid)
        if not outs:
            return
        out_ex, out_raw = outs
        try:
            out_raw.delete("1.0", END)
            out_ex.delete("1.0", END)

            keys = parse_rapidapi_keys(self.key_var.get())
            if not keys:
                out_raw.insert(END, "Set RapidAPI key first (one or more, comma-separated).")
                return

            form = self.provider_forms.get(pid, {})
            bu = form.get("base_url")
            if not isinstance(bu, ttk.Entry):
                out_raw.insert(END, "Invalid form.")
                return
            base_raw = bu.get().strip()
            pairs: list[tuple[str, str]] = []
            for row in form.get("param_rows", []):
                n = row.get("name", "")
                if not n:
                    continue
                ve = row.get("value_entry")
                v = ve.get() if isinstance(ve, ttk.Entry) else ""
                pairs.append((n, v))

            url, host = build_custom_get_url(base_raw, pairs)
            if not url or not host:
                out_raw.insert(
                    END,
                    "Enter a valid API endpoint URL (e.g. https://your-api.p.rapidapi.com/search).",
                )
                return

            out_raw.insert(END, f"GET {url}\n\n")
            self.update_idletasks()

            body = self._rapidapi_get_with_key_rotation(
                url, host, keys, out_raw, include_json_content_type=True
            )
            if body is None:
                return

            try:
                parsed = json.loads(body)
            except json.JSONDecodeError:
                out_raw.insert(END, body)
                out_ex.insert(END, "(non-JSON body; see Raw panel)")
                return

            pretty = json.dumps(parsed, indent=2, ensure_ascii=False)
            out_raw.insert(END, pretty)
            out_ex.insert(END, pretty)
        finally:
            self.persist()


def main() -> None:
    app = App()
    app.mainloop()


if __name__ == "__main__":
    main()
