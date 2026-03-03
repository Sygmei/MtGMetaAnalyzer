from __future__ import annotations

import difflib
import html
import logging
import re
import time
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import parse_qs, quote_plus, urlparse

import requests
from bs4 import BeautifulSoup, Tag

from .models import DeckRecord
from .utils import absolutize_url, normalize_name, with_query_params

BASE_URL = "https://www.mtgtop8.com"
DUEL_COMMANDER_ALL_META = "56"
DUEL_COMMANDER_FORMAT = "EDH"
DUEL_COMMANDER_INDEX_URL = f"{BASE_URL}/format?f={DUEL_COMMANDER_FORMAT}&meta={DUEL_COMMANDER_ALL_META}&a="
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)
logger = logging.getLogger(__name__)


@dataclass(slots=True)
class CommanderEntry:
    name: str
    url: str
    score: float


@dataclass(slots=True, frozen=True)
class PageRequest:
    method: str
    url: str
    data: tuple[tuple[str, str], ...] = ()

    def key(self) -> str:
        payload = "&".join(f"{k}={v}" for k, v in self.data)
        return f"{self.method}|{self.url}|{payload}"


class MtgTop8Client:
    def __init__(self, timeout: int = 25, delay_seconds: float = 0.2):
        self.timeout = timeout
        self.delay_seconds = delay_seconds
        self.session = requests.Session()
        self.session.headers.update(
            {
                "User-Agent": DEFAULT_USER_AGENT,
                "Accept-Language": "en-US,en;q=0.9",
                "Referer": f"{BASE_URL}/",
            }
        )
        self._commander_scan_diagnostics: list[str] = []
        self._commander_search_diagnostics: list[str] = []

    def find_commander_entry(self, commanders: list[str]) -> CommanderEntry:
        entries = self._load_commander_entries()
        if not entries:
            entries = self._search_commander_entries(commanders)
        if not entries:
            diagnostic_text = " | ".join(self._commander_scan_diagnostics[-6:])
            search_text = " | ".join(self._commander_search_diagnostics[-6:])
            raise RuntimeError(
                "No commander archetypes discovered on MtgTop8. "
                f"Scan diagnostics: {diagnostic_text}. "
                f"Search diagnostics: {search_text}"
            )

        wanted_tokens = [normalize_name(name) for name in commanders if name.strip()]
        wanted_set = set(wanted_tokens)
        best_name = ""
        best_url = ""
        best_score = -1.0

        for name, url in entries:
            norm = normalize_name(name)
            score = self._score_name_match(norm, wanted_tokens, wanted_set)
            if score > best_score:
                best_score = score
                best_name = name
                best_url = with_query_params(url, f=DUEL_COMMANDER_FORMAT, meta=DUEL_COMMANDER_ALL_META)

        logger.info(
            "MtgTop8: matched commander query=%s candidate=%s score=%.2f",
            " / ".join(commanders),
            best_name,
            best_score,
        )
        if best_score < 0.4:
            targeted_entries = self._search_commander_entries(commanders)
            if targeted_entries:
                for name, url in targeted_entries:
                    norm = normalize_name(name)
                    score = self._score_name_match(norm, wanted_tokens, wanted_set)
                    if score > best_score:
                        best_score = score
                        best_name = name
                        best_url = with_query_params(url, f=DUEL_COMMANDER_FORMAT, meta=DUEL_COMMANDER_ALL_META)
                logger.info(
                    "MtgTop8: targeted search refinement candidate=%s score=%.2f",
                    best_name,
                    best_score,
                )

        if best_score < 0.4:
            raise RuntimeError(
                f"Unable to confidently match commander on MtgTop8. Best candidate '{best_name}' score={best_score:.2f}"
            )
        return CommanderEntry(name=best_name, url=best_url, score=best_score)

    def crawl_commander_decks(self, commander_url: str, max_pages: int | None = None) -> list[DeckRecord]:
        first_url = with_query_params(
            commander_url,
            f=DUEL_COMMANDER_FORMAT,
            meta=DUEL_COMMANDER_ALL_META,
        )
        request: PageRequest | None = PageRequest(method="GET", url=first_url)
        visited_pages: set[str] = set()
        seen_decks: set[str] = set()
        decks: list[DeckRecord] = []
        page_count = 0
        logger.info("MtgTop8: crawl start url=%s delay_seconds=%.2f", first_url, self.delay_seconds)

        while request and request.key() not in visited_pages:
            visited_pages.add(request.key())
            page_count += 1
            logger.info("MtgTop8: crawl page=%d request=%s %s", page_count, request.method, request.url)
            html = self._request_page(request)
            page_decks, next_request = self._parse_commander_page(html, request.url)
            page_decks, next_request = self._retry_page_request_if_stalled(
                request=request,
                page_decks=page_decks,
                next_request=next_request,
                seen_decks=seen_decks,
            )
            logger.info(
                "MtgTop8: crawl page=%d deck_rows=%d next=%s",
                page_count,
                len(page_decks),
                next_request.key() if next_request else "<none>",
            )
            for deck in page_decks:
                if deck.deck_url in seen_decks:
                    continue
                seen_decks.add(deck.deck_url)
                logger.debug("MtgTop8: fetching decklist url=%s", deck.deck_url)
                deck.cards, deck.sections = self.fetch_deck_cards(deck.deck_url)
                decks.append(deck)
                if len(decks) % 10 == 0:
                    logger.info("MtgTop8: cached decks=%d", len(decks))
                self._sleep()

            if max_pages is not None and page_count >= max_pages:
                logger.info("MtgTop8: crawl reached max_pages=%d", max_pages)
                break
            request = next_request
            self._sleep()
        logger.info("MtgTop8: crawl completed pages=%d cached_decks=%d", page_count, len(decks))
        return decks

    def _retry_page_request_if_stalled(
        self,
        *,
        request: PageRequest,
        page_decks: list[DeckRecord],
        next_request: PageRequest | None,
        seen_decks: set[str],
    ) -> tuple[list[DeckRecord], PageRequest | None]:
        if request.method.upper() != "POST":
            return page_decks, next_request

        form_data = dict(request.data)
        target_page = form_data.get("current_page")
        if not target_page:
            return page_decks, next_request

        new_on_page = sum(1 for deck in page_decks if deck.deck_url not in seen_decks)
        if new_on_page > 0:
            return page_decks, next_request

        logger.warning(
            "MtgTop8: no new decks from POST page request target_page=%s, trying fallback pagination requests",
            target_page,
        )

        fallbacks = [
            PageRequest(method="GET", url=with_query_params(request.url, cp=target_page)),
            PageRequest(method="GET", url=with_query_params(request.url, current_page=target_page)),
            PageRequest(method="POST", url=request.url, data=(("cp", target_page),)),
            PageRequest(method="POST", url=request.url, data=(("current_page", target_page), ("cp", target_page))),
        ]

        for candidate in fallbacks:
            if candidate.key() == request.key():
                continue
            try:
                html = self._request_page(candidate)
                rows, candidate_next = self._parse_commander_page(html, candidate.url)
            except requests.RequestException as exc:
                logger.warning("MtgTop8: fallback request failed request=%s error=%s", candidate.key(), exc)
                continue

            candidate_new = sum(1 for deck in rows if deck.deck_url not in seen_decks)
            logger.info(
                "MtgTop8: fallback request=%s rows=%d new=%d",
                candidate.key(),
                len(rows),
                candidate_new,
            )
            if candidate_new > 0:
                return rows, candidate_next

        return page_decks, next_request

    def fetch_deck_cards(self, deck_url: str) -> tuple[dict[str, int], dict[str, dict[str, int]]]:
        html = self._get(deck_url)
        soup = BeautifulSoup(html, "html.parser")
        sections, parser = _extract_deck_sections(soup)

        cards = dict(sections.get("main", {}))
        for commander_name, quantity in sections.get("commander", {}).items():
            cards.setdefault(commander_name, quantity)
        commander_names = sorted(sections.get("commander", {}).keys())
        logger.debug(
            "MtgTop8: parsed deck cards url=%s parser=%s main=%d commander=%d sideboard=%d commanders=%s",
            deck_url,
            parser,
            len(sections.get("main", {})),
            len(sections.get("commander", {})),
            len(sections.get("sideboard", {})),
            " | ".join(commander_names[:3]) if commander_names else "<none>",
        )
        return cards, sections

    def _load_commander_entries(self) -> list[tuple[str, str]]:
        self._commander_scan_diagnostics = []
        entries: dict[str, str] = {}
        queue = [
            DUEL_COMMANDER_INDEX_URL,
            f"{BASE_URL}/format?f={DUEL_COMMANDER_FORMAT}&meta={DUEL_COMMANDER_ALL_META}",
            f"{BASE_URL}/format?f={DUEL_COMMANDER_FORMAT}",
        ]
        seen_urls: set[str] = set()

        while queue:
            scan_url = queue.pop(0)
            if scan_url in seen_urls:
                continue
            seen_urls.add(scan_url)

            html = self._get(scan_url)
            soup = BeautifulSoup(html, "html.parser")
            title_text = soup.title.get_text(" ", strip=True) if soup.title else ""
            page_entries = _extract_commander_entries_from_soup(soup)
            entries.update(page_entries)

            diag = (
                f"url={scan_url} title={title_text[:80]} "
                f"archetype_links={_count_archetype_links(soup)} entries_added={len(page_entries)}"
            )
            self._commander_scan_diagnostics.append(diag)
            logger.info("MtgTop8: commander scan %s", diag)

            all_commander_link = _find_all_commander_decks_link(soup, scan_url)
            if all_commander_link and all_commander_link not in seen_urls and all_commander_link not in queue:
                queue.append(all_commander_link)

            if entries:
                break

        if not entries:
            dynamic_entries = self._load_commander_entries_from_dynamic_endpoint()
            entries.update(dynamic_entries)

        return sorted(entries.items(), key=lambda x: x[0].lower())

    def _load_commander_entries_from_dynamic_endpoint(self, max_pages: int = 64) -> dict[str, str]:
        entries: dict[str, str] = {}
        consecutive_no_growth = 0
        for page in range(1, max_pages + 1):
            url = (
                f"{BASE_URL}/cEDH_decks?f={DUEL_COMMANDER_FORMAT}&show=alpha&cid="
                f"&meta={DUEL_COMMANDER_ALL_META}&gamerid1=&gamerid2=&cEDH_cp={page}"
            )
            html_text = self._post(url)
            soup = BeautifulSoup(html_text, "html.parser")
            page_entries = _extract_commander_entries_from_soup(soup)
            before_count = len(entries)
            entries.update(page_entries)
            new_added = len(entries) - before_count

            diag = (
                f"dynamic_url={url} archetype_links={_count_archetype_links(soup)} "
                f"entries_seen={len(page_entries)} entries_added={new_added} total={len(entries)}"
            )
            self._commander_scan_diagnostics.append(diag)
            logger.info("MtgTop8: commander scan %s", diag)

            if new_added == 0:
                consecutive_no_growth += 1
            else:
                consecutive_no_growth = 0

            # cEDH_decks can return the full list on every page; stop once we see no growth.
            if page > 1 and len(entries) > 0 and consecutive_no_growth >= 1:
                logger.info(
                    "MtgTop8: stopping dynamic commander scan at page=%d due to no new archetypes",
                    page,
                )
                break
        return entries

    def _search_commander_entries(self, commanders: list[str]) -> list[tuple[str, str]]:
        self._commander_search_diagnostics = []
        entries: dict[str, str] = {}

        for commander in commanders:
            query = commander.strip()
            if not query:
                continue
            for variant in _commander_query_variants(query):
                encoded = quote_plus(variant)
                url = f"{BASE_URL}/cEDH_card_search?n={encoded}&b=1"
                try:
                    html_text = self._post(url)
                except requests.RequestException as exc:
                    self._commander_search_diagnostics.append(f"url={url} failed={exc}")
                    continue

                page_entries = _extract_commander_entries_from_search_html(html_text)
                for name, archetype_id in page_entries:
                    entries[name] = (
                        f"{BASE_URL}/archetype?a={archetype_id}&meta={DUEL_COMMANDER_ALL_META}&f={DUEL_COMMANDER_FORMAT}"
                    )
                diag = f"url={url} results={len(page_entries)}"
                self._commander_search_diagnostics.append(diag)
                logger.info("MtgTop8: commander search %s", diag)
                if page_entries:
                    break

        return sorted(entries.items(), key=lambda x: x[0].lower())

    def _score_name_match(self, candidate: str, wanted: list[str], wanted_set: set[str]) -> float:
        if not candidate:
            return 0.0
        if candidate in wanted_set:
            return 1.0
        if all(token in candidate for token in wanted):
            return 0.95

        candidate_words = set(candidate.split())
        wanted_words: set[str] = set()
        for token in wanted:
            wanted_words.update(token.split())
        coverage = (len(candidate_words & wanted_words) / len(wanted_words)) if wanted_words else 0.0

        direct_contains = 0.8 if any(token and token in candidate for token in wanted) else 0.0
        similarity = max(
            (difflib.SequenceMatcher(a=token, b=candidate).ratio() for token in wanted),
            default=0.0,
        )
        return max(direct_contains, coverage, similarity)

    def _parse_commander_page(self, html: str, page_url: str) -> tuple[list[DeckRecord], PageRequest | None]:
        soup = BeautifulSoup(html, "html.parser")
        table, headers = _find_results_table(soup)
        if table is None:
            return [], _find_next_page_request(soup, page_url)
        required_cells = (max(headers.values()) + 1) if headers else 0

        rows: list[DeckRecord] = []
        for row in table.find_all("tr"):
            cells = row.find_all("td")
            if not cells or len(cells) < required_cells:
                continue
            normalized_text = [c.get_text(" ", strip=True) for c in cells]
            if not any(normalized_text):
                continue
            if "deck" in normalize_name(" ".join(normalized_text)) and "player" in normalize_name(
                " ".join(normalized_text)
            ):
                continue

            def get_value(column: str) -> str:
                idx = headers.get(column)
                if idx is None or idx >= len(cells):
                    return ""
                return cells[idx].get_text(" ", strip=True)

            deck_cell = cells[headers["deck"]]
            deck_url = _extract_deck_url(deck_cell, page_url)
            if not deck_url:
                continue

            rows.append(
                DeckRecord(
                    deck_name=get_value("deck"),
                    player=get_value("player"),
                    event=get_value("event"),
                    event_level=get_value("level"),
                    rank=get_value("rank"),
                    event_date=get_value("date"),
                    deck_url=deck_url,
                    page_url=page_url,
                )
            )
        return rows, _find_next_page_request(soup, page_url)

    def _get(self, url: str) -> str:
        logger.debug("MtgTop8: GET %s", url)
        response = self.session.get(url, timeout=self.timeout)
        logger.debug("MtgTop8: response status=%s url=%s", response.status_code, response.url)
        response.raise_for_status()
        return response.text

    def _post(self, url: str, data: dict[str, str] | None = None) -> str:
        logger.debug("MtgTop8: POST %s data=%s", url, data or {})
        response = self.session.post(url, data=data or {}, timeout=self.timeout)
        logger.debug("MtgTop8: response status=%s url=%s", response.status_code, response.url)
        response.raise_for_status()
        return response.text

    def _request_page(self, request: PageRequest) -> str:
        if request.method.upper() == "POST":
            return self._post(request.url, data=dict(request.data))
        return self._get(request.url)

    def _sleep(self) -> None:
        if self.delay_seconds > 0:
            time.sleep(self.delay_seconds)


def _parse_quantity(text: str) -> int | None:
    stripped = text.strip().rstrip("xX")
    if not stripped.isdigit():
        return None
    return int(stripped)


def _extract_card_name(cell: Tag) -> str:
    anchor = cell.find("a")
    if anchor:
        href = (anchor.get("href") or "").strip().lower()
        if not href or (
            "cards=" not in href
            and "search?" not in href
            and "card?" not in href
            and "find?" not in href
            and "/cards/" not in href
        ):
            return ""
        value = anchor.get_text(" ", strip=True)
        if value:
            return value
    return ""


def _extract_deck_sections(soup: BeautifulSoup) -> tuple[dict[str, dict[str, int]], str]:
    sections = _extract_deck_sections_from_div_layout(soup)
    if _sections_have_cards(sections):
        return sections, "div"

    sections = _extract_deck_sections_from_table_layout(soup)
    if _sections_have_cards(sections):
        return sections, "table"
    return sections, "none"


def _extract_deck_sections_from_div_layout(soup: BeautifulSoup) -> dict[str, dict[str, int]]:
    sections: dict[str, dict[str, int]] = {"main": {}}
    current_section = "main"

    for div in soup.find_all("div"):
        classes = div.get("class") or []
        if "O14" in classes:
            current_section = _resolve_section_from_header(div.get_text(" ", strip=True), current_section)
            sections.setdefault(current_section, {})
            continue
        if "deck_line" not in classes:
            continue

        quantity = _extract_div_line_quantity(div)
        card_name = _extract_div_line_card_name(div)
        if quantity is None or not card_name:
            continue

        line_section = current_section
        row_id = (div.get("id") or "").strip().lower()
        if row_id.startswith("sb") and current_section == "main":
            line_section = "sideboard"
        sections.setdefault(line_section, {})
        sections[line_section][card_name] = sections[line_section].get(card_name, 0) + quantity

    return sections


def _extract_deck_sections_from_table_layout(soup: BeautifulSoup) -> dict[str, dict[str, int]]:
    sections: dict[str, dict[str, int]] = {"main": {}}
    current_section = "main"

    for row in soup.find_all("tr"):
        row_text = row.get_text(" ", strip=True)
        if not row_text:
            continue
        current_section = _resolve_section_from_header(row_text, current_section)
        if _is_section_header_only(row_text):
            sections.setdefault(current_section, {})
            continue

        cells = row.find_all("td")
        if len(cells) < 2:
            continue
        qty = _parse_quantity(cells[0].get_text(" ", strip=True))
        if qty is None:
            continue
        name = _extract_card_name(cells[1])
        if not name:
            continue
        sections.setdefault(current_section, {})
        sections[current_section][name] = sections[current_section].get(name, 0) + qty

    return sections


def _resolve_section_from_header(text: str, current_section: str) -> str:
    upper = text.upper()
    if "SIDEBOARD" in upper:
        return "sideboard"
    if "COMMANDER" in upper:
        return "commander"
    if "MAYBEBOARD" in upper:
        return "maybeboard"
    if "MAINBOARD" in upper or "MAIN DECK" in upper:
        return "main"
    # Duel Commander pages often show "COMMANDER" and then category headers
    # like "33 LANDS", which means main deck starts after commander entries.
    if current_section == "commander" and re.match(r"^\d+\s+[A-Z]", upper):
        return "main"
    return current_section


def _is_section_header_only(text: str) -> bool:
    upper = text.upper()
    return any(token in upper for token in ("SIDEBOARD", "COMMANDER", "MAYBEBOARD", "MAINBOARD", "MAIN DECK"))


def _extract_div_line_quantity(line: Tag) -> int | None:
    text = line.get_text(" ", strip=True)
    match = re.match(r"^(\d+)\b", text)
    if not match:
        return None
    return int(match.group(1))


def _extract_div_line_card_name(line: Tag) -> str:
    span = line.find("span", class_=re.compile(r"\bL14\b"))
    if span:
        value = span.get_text(" ", strip=True)
        if value:
            return value

    anchor = line.find("a")
    if anchor:
        value = anchor.get_text(" ", strip=True)
        if value:
            return value

    onclick = (line.get("onclick") or "").strip()
    match = re.search(r"AffCard\(\s*'[^']*'\s*,\s*'((?:\\'|[^'])+)'", onclick)
    if match:
        raw = match.group(1).replace("\\'", "'")
        return html.unescape(raw).replace("+", " ").strip()

    value = line.get_text(" ", strip=True)
    prefix_match = re.match(r"^\d+\s+(.+)$", value)
    if prefix_match:
        return prefix_match.group(1).strip()
    return ""


def _sections_have_cards(sections: dict[str, dict[str, int]]) -> bool:
    return any(cards for cards in sections.values())


def _read_anchor_label(anchor: Tag) -> str:
    text = anchor.get_text(" ", strip=True)
    text = re.sub(r"\s+", " ", text).strip()
    if text:
        return text
    img = anchor.find("img")
    if img:
        for attr in ("alt", "title"):
            value = (img.get(attr) or "").strip()
            value = re.sub(r"\s+", " ", value).strip()
            if value:
                return value
    return ""


def _find_results_table(soup: BeautifulSoup) -> tuple[Tag | None, dict[str, int]]:
    desired = ("deck", "player", "event", "level", "rank", "date")
    best_table: Tag | None = None
    best_map: dict[str, int] = {}
    best_score: tuple[int, int, int] = (-1, -1, -999999)

    for table in soup.find_all("table"):
        for row in table.find_all("tr"):
            cells = row.find_all(["th", "td"])
            if not cells:
                continue
            headers = [normalize_name(cell.get_text(" ", strip=True)) for cell in cells]
            header_map: dict[str, int] = {}
            for idx, header in enumerate(headers):
                for key in desired:
                    if header == key and key not in header_map:
                        header_map[key] = idx
            if all(key in header_map for key in desired):
                deck_idx = header_map["deck"]
                deck_hits = _count_deck_rows_for_candidate(table, deck_idx)
                # Prefer candidates that actually expose deck links with d=<deck_id>.
                # Then prefer narrower header positions (usually the real deck table, not container tables).
                score = (1 if deck_hits > 0 else 0, deck_hits, -max(header_map.values()))
                if score > best_score:
                    best_score = score
                    best_table = table
                    best_map = header_map
    return best_table, best_map


def _find_next_page_request(soup: BeautifulSoup, base_url: str) -> PageRequest | None:
    nav_form = soup.find("form", attrs={"name": "nav_form"})
    if nav_form is not None:
        action = (nav_form.get("action") or "").strip()
        if action:
            action_url = absolutize_url(base_url, action)
            current_page = 1
            cur = nav_form.find(class_=re.compile(r"^Nav_cur$", re.IGNORECASE))
            if cur:
                match = re.search(r"\d+", cur.get_text(" ", strip=True))
                if match:
                    current_page = int(match.group(0))

            candidates_num: list[int] = []
            page_target: int | None = None
            for tag in nav_form.find_all(attrs={"onclick": True}):
                label = normalize_name(tag.get_text(" ", strip=True))
                onclick = (tag.get("onclick") or "").strip()
                match = re.search(r"PageSubmit_arch\((\d+)\)", onclick)
                if not match:
                    continue
                page_num = int(match.group(1))
                candidates_num.append(page_num)
                if label == "next":
                    page_target = page_num
                    break

            if page_target is None:
                larger = sorted({n for n in candidates_num if n > current_page})
                if larger:
                    page_target = larger[0]

            if page_target is not None:
                return PageRequest(method="POST", url=action_url, data=(("current_page", str(page_target)),))

    candidates: Iterable[Tag] = soup.find_all("a")
    for anchor in candidates:
        text = anchor.get_text(" ", strip=True).lower()
        if text != "next":
            continue
        href = (anchor.get("href") or "").strip()
        if not href:
            continue
        return PageRequest(method="GET", url=absolutize_url(base_url, href))

    if nav_form is not None:
        for tag in nav_form.find_all(attrs={"onclick": True}):
            onclick = (tag.get("onclick") or "").strip()
            match = re.search(r"PageSubmit_arch\((\d+)\)", onclick)
            if match:
                candidates_num.append(int(match.group(1)))
        if candidates_num:
            first = sorted(set(candidates_num))[0]
            action = (nav_form.get("action") or "").strip()
            if action:
                action_url = absolutize_url(base_url, action)
                return PageRequest(method="POST", url=action_url, data=(("current_page", str(first)),))
    return None
    return None


def _extract_deck_url(deck_cell: Tag, base_url: str) -> str:
    for anchor in deck_cell.find_all("a"):
        href = (anchor.get("href") or "").strip()
        if not href or "event?" not in href:
            continue
        absolute = absolutize_url(base_url, href)
        query = parse_qs(urlparse(absolute).query)
        if "d" in query:
            return absolute
    return ""


def _extract_commander_entries_from_soup(soup: BeautifulSoup) -> dict[str, str]:
    entries: dict[str, str] = {}
    for anchor in soup.find_all("a"):
        href = (anchor.get("href") or "").strip()
        if "archetype?" not in href:
            continue
        absolute_url = absolutize_url(BASE_URL, href)
        query = parse_qs(urlparse(absolute_url).query)
        format_value = query.get("f", [DUEL_COMMANDER_FORMAT])[0].upper()
        if format_value != DUEL_COMMANDER_FORMAT:
            continue
        commander_name = _read_anchor_label(anchor)
        if not commander_name:
            continue
        entries[commander_name] = absolute_url
    return entries


def _find_all_commander_decks_link(soup: BeautifulSoup, base_url: str) -> str | None:
    for anchor in soup.find_all("a"):
        label = normalize_name(anchor.get_text(" ", strip=True))
        if "all commander decks" not in label:
            continue
        href = (anchor.get("href") or "").strip()
        if not href:
            continue
        absolute = absolutize_url(base_url, href)
        return with_query_params(absolute, f=DUEL_COMMANDER_FORMAT, meta=DUEL_COMMANDER_ALL_META)
    return None


def _count_archetype_links(soup: BeautifulSoup) -> int:
    count = 0
    for anchor in soup.find_all("a"):
        href = (anchor.get("href") or "").strip()
        if "archetype?" in href:
            count += 1
    return count


def _count_deck_rows_for_candidate(table: Tag, deck_idx: int) -> int:
    hits = 0
    for row in table.find_all("tr"):
        cells = row.find_all("td")
        if len(cells) <= deck_idx:
            continue
        deck_cell = cells[deck_idx]
        for anchor in deck_cell.find_all("a"):
            href = (anchor.get("href") or "").strip().lower()
            if "event?" not in href:
                continue
            if "d=" in href:
                hits += 1
                break
    return hits


def _commander_query_variants(value: str) -> list[str]:
    variants = [value]
    if "//" in value:
        variants.extend([part.strip() for part in value.split("//") if part.strip()])
    if " / " in value:
        variants.extend([part.strip() for part in value.split(" / ") if part.strip()])
    deduped: list[str] = []
    seen: set[str] = set()
    for item in variants:
        key = normalize_name(item)
        if not key or key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped


def _extract_commander_entries_from_search_html(payload: str) -> list[tuple[str, str]]:
    matches = re.findall(
        r"AddCom\(\s*'(?P<id>\d+)'\s*,\s*'[^']*'\s*,\s*'(?P<name>(?:\\'|[^'])+)'\s*\)",
        payload,
        flags=re.IGNORECASE,
    )
    entries: list[tuple[str, str]] = []
    for archetype_id, raw_name in matches:
        name = html.unescape(raw_name.replace("\\'", "'")).strip()
        name = re.sub(r"\s+", " ", name)
        if not name:
            continue
        entries.append((name, archetype_id))
    return entries
