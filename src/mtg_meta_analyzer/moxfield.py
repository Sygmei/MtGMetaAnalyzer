from __future__ import annotations

import json
import logging
import os
import re
from typing import Any

from bs4 import BeautifulSoup, Tag

from .models import MoxfieldDeck

logger = logging.getLogger(__name__)
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/122.0.0.0 Safari/537.36"
)


def extract_deck_id(moxfield_url: str) -> str:
    match = re.search(r"/decks/([A-Za-z0-9_-]+)", moxfield_url)
    if not match:
        raise ValueError(f"Could not parse Moxfield deck id from: {moxfield_url}")
    return match.group(1)


def fetch_moxfield_deck(moxfield_url: str, timeout: int = 25, *, headless: bool = True) -> MoxfieldDeck:
    deck_id = extract_deck_id(moxfield_url)
    logger.info("Moxfield: start fetch deck_id=%s url=%s headless=%s", deck_id, moxfield_url, headless)
    headers = _moxfield_headers()
    failures: list[str] = []
    payload = _fetch_with_playwright(
        moxfield_url=moxfield_url,
        deck_id=deck_id,
        timeout=timeout,
        headers=headers,
        headless=headless,
        failures=failures,
    )
    if payload is None:
        failures_summary = "; ".join(failures[-8:])
        logger.error("Moxfield: extraction failed deck_id=%s failures=%s", deck_id, failures_summary)
        raise RuntimeError(
            f"Unable to fetch Moxfield deck {deck_id}. "
            f"Playwright extraction failed. Last failures: {failures_summary}. "
            "Install Playwright Chromium and retry."
        )

    commanders = _extract_commanders(payload)
    if not commanders:
        logger.error("Moxfield: payload extracted but commander list is empty deck_id=%s", deck_id)
        raise RuntimeError("Could not detect commander from Moxfield deck payload")

    cards = _extract_cards(_get_mainboard_payload(payload))
    logger.info(
        "Moxfield: parsed deck_id=%s name=%s commanders=%s cards=%d",
        deck_id,
        str(payload.get("name") or deck_id),
        " | ".join(commanders),
        len(cards),
    )
    return MoxfieldDeck(
        deck_id=deck_id,
        name=str(payload.get("name") or deck_id),
        url=moxfield_url,
        commanders=commanders,
        cards=cards,
    )


def _extract_cards(board_payload: dict[str, Any]) -> dict[str, int]:
    cards: dict[str, int] = {}
    entries = board_payload.values() if isinstance(board_payload, dict) else board_payload
    if not isinstance(entries, list) and not isinstance(entries, dict) and not hasattr(entries, "__iter__"):
        return cards
    for card_entry in entries:
        if not isinstance(card_entry, dict):
            continue
        quantity = _safe_int(card_entry.get("quantity", 0))
        card = card_entry.get("card") if isinstance(card_entry.get("card"), dict) else card_entry
        name = str(
            card.get("name")
            or card.get("cardName")
            or card.get("card_name")
            or card_entry.get("name")
            or ""
        ).strip()
        if quantity > 0 and name:
            cards[name] = quantity
    return cards


def _extract_commanders(payload: dict[str, Any]) -> list[str]:
    commanders_payload = _get_commanders_payload(payload)
    if isinstance(commanders_payload, dict):
        names = [
            str(
                entry.get("card", {}).get("name")
                or entry.get("name")
                or entry.get("cardName")
                or ""
            ).strip()
            for entry in commanders_payload.values()
            if isinstance(entry, dict)
        ]
        names = [name for name in names if name]
        if names:
            return names

    if isinstance(commanders_payload, list):
        names = []
        for entry in commanders_payload:
            if not isinstance(entry, dict):
                continue
            card = entry.get("card") if isinstance(entry.get("card"), dict) else entry
            name = str(card.get("name") or card.get("cardName") or entry.get("name") or "").strip()
            if name:
                names.append(name)
        if names:
            return names

    commander_name = str(payload.get("commander") or "").strip()
    return [commander_name] if commander_name else []


def _moxfield_headers() -> dict[str, str]:
    ua = (os.getenv("MOXFIELD_USER_AGENT") or "").strip() or DEFAULT_USER_AGENT
    return {
        "User-Agent": ua,
        "Accept-Language": "en-US,en;q=0.9",
    }


def _safe_int(value: Any) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def _payload_looks_like_deck(payload: Any) -> bool:
    if not isinstance(payload, dict):
        return False
    return bool(_get_mainboard_payload(payload)) or bool(_get_commanders_payload(payload))


def _fetch_with_playwright(
    moxfield_url: str,
    deck_id: str,
    timeout: int,
    headers: dict[str, str],
    headless: bool,
    failures: list[str],
) -> dict[str, Any] | None:
    try:
        from playwright.sync_api import Error as PlaywrightError
        from playwright.sync_api import sync_playwright
    except Exception as exc:
        failures.append(f"Playwright unavailable: {exc}")
        return None

    timeout_ms = timeout * 1000
    try:
        with sync_playwright() as playwright:
            logger.info("Moxfield: launching Chromium")
            browser = playwright.chromium.launch(headless=headless)
            context = browser.new_context(
                user_agent=headers.get("User-Agent", DEFAULT_USER_AGENT),
                locale="en-US",
            )
            page = context.new_page()
            found_payload: dict[str, Any] | None = None
            response_counts = {"deck_api_hits": 0, "deck_api_non_200": 0}

            def handle_response(response: Any) -> None:
                nonlocal found_payload
                url = response.url.lower()
                if "/decks/all/" not in url:
                    return
                if "moxfield.com" not in url:
                    return
                response_counts["deck_api_hits"] += 1
                if response.status != 200:
                    failures.append(f"Playwright response {response.url} returned {response.status}")
                    response_counts["deck_api_non_200"] += 1
                    return
                try:
                    payload = response.json()
                except Exception as exc:  # noqa: BLE001
                    failures.append(f"Playwright JSON parse failed for {response.url}: {exc}")
                    return
                extracted = _extract_deck_payload_from_tree(payload)
                if extracted is not None:
                    found_payload = extracted

            page.on("response", handle_response)
            logger.info("Moxfield: opening page %s", moxfield_url)
            page.goto(moxfield_url, wait_until="domcontentloaded", timeout=timeout_ms)
            logger.info("Moxfield: DOM loaded for deck page")
            try:
                page.wait_for_load_state("networkidle", timeout=timeout_ms)
                logger.debug("Moxfield: network idle reached")
            except Exception:
                # networkidle is not guaranteed if page keeps polling; still continue
                logger.debug("Moxfield: network idle timeout, continuing with current DOM")
                pass

            html = page.content()
            logger.debug("Moxfield: page HTML size=%d bytes", len(html))
            dom_payload = _extract_deck_payload_from_dom_html(html, deck_id)
            if dom_payload is not None:
                dom_commanders = _extract_commanders(dom_payload)
                dom_cards = _extract_cards(_get_mainboard_payload(dom_payload))
                logger.info(
                    "Moxfield: DOM extraction succeeded commanders=%s cards=%d",
                    " | ".join(dom_commanders) if dom_commanders else "<none>",
                    len(dom_cards),
                )
            else:
                logger.warning("Moxfield: DOM extraction returned no deck payload")

            if found_payload is not None and dom_payload is not None:
                found_payload = _merge_deck_payload(found_payload, dom_payload)
            elif found_payload is None:
                found_payload = _extract_deck_payload_from_html(html)
                if found_payload is not None and dom_payload is not None:
                    found_payload = _merge_deck_payload(found_payload, dom_payload)
                elif found_payload is None:
                    found_payload = dom_payload

            context.close()
            browser.close()
            logger.info(
                "Moxfield: network deck-api hits=%d non-200=%d",
                response_counts["deck_api_hits"],
                response_counts["deck_api_non_200"],
            )
            if found_payload is not None:
                logger.info("Moxfield: payload extraction completed")
                return found_payload
            failures.append(f"Playwright visited {moxfield_url} but could not extract a deck payload")
            return None
    except PlaywrightError as exc:
        failures.append(f"Playwright failed: {exc}")
        return None


def _extract_deck_payload_from_html(html: str) -> dict[str, Any] | None:
    matches = re.findall(
        r'<script[^>]+id=["\']__NEXT_DATA__["\'][^>]*>\s*(.*?)\s*</script>',
        html,
        flags=re.IGNORECASE | re.DOTALL,
    )
    for raw_json in matches:
        try:
            payload = json.loads(raw_json)
        except json.JSONDecodeError:
            continue
        extracted = _extract_deck_payload_from_tree(payload)
        if extracted is not None:
            return extracted
    return None


def _extract_deck_payload_from_tree(root: Any) -> dict[str, Any] | None:
    stack: list[Any] = [root]
    seen: set[int] = set()
    while stack:
        node = stack.pop()
        node_id = id(node)
        if node_id in seen:
            continue
        seen.add(node_id)

        if _payload_looks_like_deck(node):
            return node

        if isinstance(node, dict):
            stack.extend(node.values())
            continue
        if isinstance(node, list):
            stack.extend(node)
    return None


def _get_mainboard_payload(payload: dict[str, Any]) -> Any:
    if "mainboard" in payload:
        return payload.get("mainboard")
    if "mainBoard" in payload:
        return payload.get("mainBoard")
    boards = payload.get("boards")
    if isinstance(boards, dict):
        if "mainboard" in boards:
            return boards.get("mainboard")
        if "mainBoard" in boards:
            return boards.get("mainBoard")
        if "main" in boards:
            return boards.get("main")
    return {}


def _get_commanders_payload(payload: dict[str, Any]) -> Any:
    if "commanders" in payload:
        return payload.get("commanders")
    if "commander" in payload and isinstance(payload.get("commander"), (dict, list)):
        return payload.get("commander")
    boards = payload.get("boards")
    if isinstance(boards, dict):
        for key in ("commanders", "commander", "command"):
            if key in boards:
                return boards.get(key)
    return {}


def _merge_deck_payload(primary: dict[str, Any], fallback: dict[str, Any]) -> dict[str, Any]:
    merged = dict(primary)
    primary_name = str(primary.get("name") or "").strip()
    if not primary_name:
        merged["name"] = fallback.get("name") or merged.get("name")

    primary_mainboard = _get_mainboard_payload(primary)
    if not _extract_cards(primary_mainboard):
        merged["mainboard"] = fallback.get("mainboard", {})
    elif "mainboard" not in merged and "mainboard" in fallback:
        merged["mainboard"] = fallback["mainboard"]

    if not _extract_commanders(primary):
        merged["commanders"] = fallback.get("commanders", {})
    elif "commanders" not in merged and "commanders" in fallback:
        merged["commanders"] = fallback["commanders"]

    return merged


def _extract_deck_payload_from_dom_html(html: str, deck_id: str) -> dict[str, Any] | None:
    soup = BeautifulSoup(html, "html.parser")
    article_candidates = soup.find_all("article")
    best: dict[str, Any] | None = None
    best_score = -1

    for article in article_candidates:
        parsed = _parse_article_deck(article)
        if parsed is None:
            continue
        commanders = parsed["commanders"]
        mainboard = parsed["mainboard"]
        total_cards = sum(entry.get("quantity", 0) for entry in mainboard.values())
        score = total_cards + (1000 if commanders else 0)
        if score > best_score:
            best_score = score
            best = parsed

    if best is None:
        return None

    deck_name = _extract_deck_name_from_dom(soup) or deck_id
    return {
        "publicId": deck_id,
        "name": deck_name,
        "commanders": best["commanders"],
        "mainboard": best["mainboard"],
    }


def _parse_article_deck(article: Tag) -> dict[str, dict[str, dict[str, Any]]] | None:
    commanders: dict[str, dict[str, Any]] = {}
    mainboard: dict[str, dict[str, Any]] = {}
    saw_card_row = False

    for section_ul in article.find_all("ul"):
        header_label = _extract_section_label(section_ul)
        if not header_label:
            continue
        section_key = header_label.lower()
        card_rows = section_ul.find_all("li")
        for row in card_rows:
            anchor = row.find("a", href=re.compile(r"^/cards/"))
            if anchor is None:
                continue
            name = anchor.get_text(" ", strip=True)
            if not name:
                continue

            qty = 1
            qty_input = row.find("input")
            if qty_input and qty_input.get("value"):
                qty = _safe_int(qty_input.get("value"))
            if qty <= 0:
                qty = 1

            target = commanders if "commander" in section_key else mainboard
            if name in target:
                target[name]["quantity"] += qty
            else:
                target[name] = {"quantity": qty, "card": {"name": name}}
            saw_card_row = True

    if not saw_card_row:
        return None
    if not mainboard:
        return None
    return {"commanders": commanders, "mainboard": mainboard}


def _extract_section_label(section_ul: Tag) -> str:
    first_li = section_ul.find("li")
    if first_li is None:
        return ""
    raw = first_li.get_text(" ", strip=True)
    if not raw:
        return ""

    raw = re.sub(r"\bChange\b", " ", raw, flags=re.IGNORECASE)
    raw = re.sub(r"\(\d+\)", " ", raw)
    raw = re.sub(r"\s+", " ", raw).strip()
    if len(raw) > 60:
        return ""
    return raw


def _extract_deck_name_from_dom(soup: BeautifulSoup) -> str:
    h1 = soup.find("h1")
    if h1:
        text = h1.get_text(" ", strip=True)
        if text:
            return text
    title = soup.find("title")
    if title:
        text = title.get_text(" ", strip=True)
        if text:
            return text.split("//")[0].strip()
    return ""
