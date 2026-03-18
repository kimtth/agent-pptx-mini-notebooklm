#!/usr/bin/env python3

import argparse
import json
import sys
from urllib.parse import parse_qs, urlsplit

from bs4 import BeautifulSoup

from icrawler.builtin.google import GoogleFeeder, GoogleParser
from icrawler.utils import ProxyPool, Session, Signal


USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/134.0.0.0 Safari/537.36"
)


def browser_headers(referer: str | None = None) -> dict[str, str]:
    headers = {
        "Accept-Language": "en-US,en;q=0.9",
        "User-Agent": USER_AGENT,
    }
    if referer:
        headers["Referer"] = referer
    return headers


def candidate_key(candidate: dict[str, str | None]) -> str | None:
    return (
        candidate.get("imageUrl")
        or candidate.get("sourcePageUrl")
        or candidate.get("thumbnailUrl")
    )


def append_candidate(
    candidates: list[dict[str, str | None]],
    seen_keys: set[str],
    candidate: dict[str, str | None],
    max_num: int,
) -> None:
    if len(candidates) >= max_num:
        return
    key = candidate_key(candidate)
    if not key or key in seen_keys:
        return
    seen_keys.add(key)
    candidates.append(candidate)


def build_google_candidates(
    query: str, max_num: int, session: Session
) -> list[dict[str, str | None]]:
    signal = Signal()
    signal.set(feeder_exited=False, parser_exited=False, reach_max_num=False)

    feeder = GoogleFeeder(1, signal, session)
    parser = GoogleParser(1, signal, session)
    feeder.feed(keyword=query, offset=0, max_num=max_num)

    seen_pages: set[str] = set()
    seen_images: set[str] = set()
    seen_keys: set[str] = set()
    candidates: list[dict[str, str | None]] = []

    while not feeder.out_queue.empty() and len(candidates) < max_num:
        search_url = feeder.out_queue.get()
        base_url = "{0.scheme}://{0.netloc}".format(urlsplit(search_url))
        response = session.get(
            search_url, timeout=10, headers=browser_headers(base_url)
        )
        if not response.text:
            continue

        soup = BeautifulSoup(response.text, "html.parser")
        thumbnails = []
        for image in soup.find_all("img"):
            src = image.get("src")
            if isinstance(src, str) and src.startswith(
                "https://encrypted-tbn0.gstatic.com/images"
            ):
                thumbnails.append(src)

        source_pages = []
        for anchor in soup.find_all("a"):
            href = anchor.get("href")
            if not isinstance(href, str) or not href.startswith("/url?"):
                continue
            target = parse_qs(urlsplit(href).query).get("q", [None])[0]
            if not target or not target.startswith(("http://", "https://")):
                continue
            if target in seen_pages:
                continue
            seen_pages.add(target)
            source_pages.append(target)

        pair_count = min(len(thumbnails), len(source_pages), max_num - len(candidates))
        for idx in range(pair_count):
            page_url = source_pages[idx]
            thumb_url = thumbnails[idx]
            parsed = urlsplit(page_url)
            title = parsed.path.split("/")[-1] or parsed.netloc or "Google image"
            append_candidate(
                candidates,
                seen_keys,
                {
                    "provider": "google",
                    "imageUrl": None,
                    "thumbnailUrl": thumb_url,
                    "sourcePageUrl": page_url,
                    "title": title,
                    "attribution": parsed.netloc or None,
                },
                max_num,
            )

        if len(candidates) >= max_num:
            break

        tasks = parser.parse(response) or []
        for task in tasks:
            image_url = task.get("file_url")
            if not image_url or image_url in seen_images:
                continue
            seen_images.add(image_url)
            parsed = urlsplit(image_url)
            host = parsed.netloc or None
            title = parsed.path.split("/")[-1] or host or "Google image"
            append_candidate(
                candidates,
                seen_keys,
                {
                    "provider": "google",
                    "imageUrl": image_url,
                    "thumbnailUrl": image_url,
                    "sourcePageUrl": None,
                    "title": title,
                    "attribution": host,
                },
                max_num,
            )
            if len(candidates) >= max_num:
                break

    return candidates


def build_bing_candidates(
    query: str, max_num: int, session: Session
) -> list[dict[str, str | None]]:
    response = session.get(
        "https://www.bing.com/images/search",
        params={"q": query, "form": "HDRSC3"},
        timeout=15,
        headers=browser_headers("https://www.bing.com/"),
    )
    if not response.text:
        return []

    soup = BeautifulSoup(response.text, "html.parser")
    seen_keys: set[str] = set()
    candidates: list[dict[str, str | None]] = []

    for anchor in soup.select("a.iusc"):
        metadata_text = anchor.get("m")
        if not isinstance(metadata_text, str) or not metadata_text:
            continue

        try:
            metadata = json.loads(metadata_text)
        except json.JSONDecodeError:
            continue

        image_url = metadata.get("murl")
        thumb_url = metadata.get("turl") or image_url
        page_url = metadata.get("purl")
        title = metadata.get("t") or metadata.get("desc") or "Bing image"
        attribution = (
            urlsplit(page_url).netloc
            if isinstance(page_url, str) and page_url
            else None
        )

        append_candidate(
            candidates,
            seen_keys,
            {
                "provider": "bing",
                "imageUrl": image_url,
                "thumbnailUrl": thumb_url,
                "sourcePageUrl": page_url,
                "title": title,
                "attribution": attribution,
            },
            max_num,
        )
        if len(candidates) >= max_num:
            break

    return candidates


def build_candidates(query: str, max_num: int) -> list[dict[str, str | None]]:
    session = Session(ProxyPool())
    candidates = build_google_candidates(query, max_num, session)
    if len(candidates) < max_num:
        fallback_candidates = build_bing_candidates(query, max_num, session)
        seen_keys = {
            key for candidate in candidates if (key := candidate_key(candidate))
        }
        for candidate in fallback_candidates:
            append_candidate(candidates, seen_keys, candidate, max_num)
            if len(candidates) >= max_num:
                break

    return candidates


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--query", action="append", required=True)
    parser.add_argument("--max-num", type=int, default=12)
    args = parser.parse_args()

    queries = [query.strip() for query in args.query if query.strip()]
    payload_candidates = []
    for query in queries:
        for candidate in build_candidates(query, max(1, min(args.max_num, 20))):
            payload_candidates.append(
                {
                    **candidate,
                    "searchQuery": query,
                }
            )

    payload = {
        "query": "\n".join(queries),
        "candidates": payload_candidates,
    }
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
