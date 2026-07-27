#!/usr/bin/env python3
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote

SCRIPT_DIR = Path(__file__).resolve().parent
PROJECT_ROOT = SCRIPT_DIR.parent
SRC_DIR = PROJECT_ROOT / "src"
DOCUMENTS_DIR = PROJECT_ROOT / "documents"
ROOT_CATALOG_PATH = DOCUMENTS_DIR / "collections.json"
ARCHIVE_OUTPUT_PATH = SRC_DIR / "archive-manifest.js"
BOOKS_DIR = PROJECT_ROOT / "books"
BOOKS_SOURCE_PATH = BOOKS_DIR / "books.json"
BOOKS_OUTPUT_PATH = SRC_DIR / "books-manifest.js"
CATALOG_NAME = "catalog.json"
FILES_CATALOG = "files.json"

SAFE_ID_PATTERN = re.compile(r"^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$")
ARCHIVE_CODE_PATTERN = re.compile(r"^[A-Z0-9]+$")
SHORT_FILE_ID_PATTERN = re.compile(r"^[A-Z0-9]+(?:-[A-Z0-9]+)*$")
VALID_LAYOUTS = {"cards", "list"}
VALID_KINDS = {"catalog", "index"}
VALID_NAVIGABLE_STATUSES = {"Cleared", "Classified"}
VALID_FILE_STATUSES = {"Cleared", "InProgress", "Classified"}
STATUS_DETAILS = {
    "Cleared": {
        "className": "cleared",
        "statusLabel": "Current Archive Copy",
        "actionLabel": "View PDF",
    },
    "InProgress": {
        "className": "in-progress",
        "statusLabel": "Work In Progress",
        "actionLabel": "View PDF",
    },
    "Classified": {
        "className": "classified",
        "statusLabel": "Classified",
        "actionLabel": "PDF Unavailable",
    },
}

DEFAULT_EMPTY_WARNING = "INDEX UNDER MAINTENANCE"
DEFAULT_EMPTY_MESSAGE = (
    "No public records are available through this terminal. "
    "Index reconstruction is pending curator clearance."
)
DEFAULT_BOOKS = [
    {
        "title": "Untitled Novel Project",
        "series": "Works in Progress",
        "shortDescription": (
            "A speculative fiction project connected to the worlds, "
            "languages, and records surfaced in the L9 Archive."
        ),
        "imageUrl": "img/wip-cover.svg",
        "amazonUrl": "",
        "published": False,
    }
]


def title_from_slug(value):
    normalized = value.replace("-", " ").replace("_", " ")
    return " ".join(word.capitalize() for word in normalized.split())


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + "\n", encoding="utf-8")


def read_json(path, fallback):
    if not path.exists():
        write_json(path, fallback)
        return fallback

    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SystemExit(f"Invalid JSON in {path}: {error}") from error


def validate_layout(value, source):
    layout = str(value or "cards")
    if layout not in VALID_LAYOUTS:
        raise SystemExit(
            f"Invalid layout '{layout}' in {source}. Use cards or list."
        )
    return layout


def validate_id(item_id, source, id_pattern=None):
    if not SAFE_ID_PATTERN.fullmatch(item_id):
        raise SystemExit(
            f"Invalid id '{item_id}' in {source}. "
            "Use letters, numbers, and single hyphens."
        )
    if id_pattern:
        try:
            matches = re.fullmatch(id_pattern, item_id)
        except re.error as error:
            raise SystemExit(f"Invalid idPattern in {source}: {error}") from error
        if not matches:
            raise SystemExit(
                f"Invalid id '{item_id}' in {source}; it does not match {id_pattern}."
            )


def validate_archive_code(code, source):
    if not ARCHIVE_CODE_PATTERN.fullmatch(code):
        raise SystemExit(
            f"Invalid archive code '{code}' in {source}. "
            "Use uppercase letters and numbers without punctuation."
        )


def generated_code(item_id):
    parts = re.findall(r"[A-Za-z0-9]+", item_id)
    if not parts:
        return ""
    if len(parts) > 1:
        compact = "".join(parts).upper()
        if len(compact) <= 5:
            return compact
        return "".join(part[0] for part in parts).upper()
    return parts[0][:4].upper()


def archive_id(segments):
    return "-".join(segments)


def default_catalog(default_kind="index"):
    return {
        "layout": "cards",
        "defaultItemKind": default_kind,
        "items": [],
    }


def default_item(folder, kind, status):
    return {
        "id": folder.name,
        "title": title_from_slug(folder.name),
        "kind": kind,
        "status": status,
        "description": (
            "Records unavailable."
            if status == "Classified"
            else "Station records filed under a newly opened archive heading."
        ),
    }


def load_catalog(folder, catalog_path, default_kind="index"):
    raw_catalog = read_json(catalog_path, default_catalog(default_kind))
    if not isinstance(raw_catalog, dict):
        raise SystemExit(
            f"{catalog_path} must contain an object with layout and items."
        )

    layout = validate_layout(raw_catalog.get("layout"), catalog_path)
    catalog_default_kind = str(
        raw_catalog.get("defaultItemKind") or default_kind
    )
    if catalog_default_kind not in VALID_KINDS:
        raise SystemExit(
            f"Invalid defaultItemKind '{catalog_default_kind}' in {catalog_path}."
        )

    default_status = str(raw_catalog.get("defaultItemStatus") or "Cleared")
    if default_status not in VALID_NAVIGABLE_STATUSES:
        raise SystemExit(
            f"Invalid defaultItemStatus '{default_status}' in {catalog_path}. "
            "Navigable items must use Cleared or Classified."
        )

    items = raw_catalog.get("items", [])
    if not isinstance(items, list):
        raise SystemExit(f"{catalog_path} field 'items' must be a JSON list.")

    listed_ids = {
        str(item.get("id"))
        for item in items
        if isinstance(item, dict) and item.get("id")
    }
    discovered = [
        default_item(child, catalog_default_kind, default_status)
        for child in sorted(folder.iterdir(), key=lambda path: path.name.lower())
        if child.is_dir()
        and not child.name.startswith(".")
        and child.name not in listed_ids
    ]
    if discovered:
        items.extend(discovered)
        raw_catalog["items"] = items
        write_json(catalog_path, raw_catalog)

    return {
        "layout": layout,
        "archiveCode": raw_catalog.get("archiveCode"),
        "defaultItemKind": catalog_default_kind,
        "defaultItemStatus": default_status,
        "idPattern": raw_catalog.get("idPattern"),
        "items": items,
    }


def clean_catalog_item(raw_item, catalog, source):
    if not isinstance(raw_item, dict) or not raw_item.get("id"):
        raise SystemExit(f"Every item in {source} must be an object with an id.")

    item_id = str(raw_item["id"]).strip()
    validate_id(item_id, source, catalog["idPattern"])
    kind = str(raw_item.get("kind") or catalog["defaultItemKind"])
    status = str(raw_item.get("status") or catalog["defaultItemStatus"])
    if kind not in VALID_KINDS:
        raise SystemExit(f"Item '{item_id}' in {source} has invalid kind '{kind}'.")
    if status not in VALID_NAVIGABLE_STATUSES:
        raise SystemExit(
            f"Item '{item_id}' in {source} has invalid status '{status}'. "
            "Navigable items must use Cleared or Classified."
        )

    title = str(raw_item.get("title") or title_from_slug(item_id))
    code = str(raw_item.get("code") or generated_code(item_id)).strip().upper()
    validate_archive_code(code, source)
    return {
        "id": item_id,
        "code": code,
        "title": title,
        "kind": kind,
        "status": status,
        "description": str(
            raw_item.get("description")
            or "Station records filed under a newly opened archive heading."
        ),
        "kicker": str(raw_item.get("kicker") or ""),
        "countLabel": str(raw_item.get("countLabel") or ""),
        "includeCodeInDescendants": bool(
            raw_item.get("includeCodeInDescendants", True)
        ),
        "emptyWarning": str(
            raw_item.get("emptyWarning") or DEFAULT_EMPTY_WARNING
        ),
        "emptyTitle": str(
            raw_item.get("emptyTitle")
            or f"{title} records are not yet available through the public terminal."
        ),
        "emptyMessage": str(
            raw_item.get("emptyMessage") or DEFAULT_EMPTY_MESSAGE
        ),
        "unavailableMessage": str(
            raw_item.get("unavailableMessage")
            or "Classified"
        ),
    }


def load_files(index_dir):
    source = index_dir / FILES_CATALOG
    raw_catalog = read_json(source, {"layout": "list", "items": []})
    if not isinstance(raw_catalog, dict):
        raise SystemExit(
            f"{source} must contain an object with layout and items."
        )
    layout = validate_layout(raw_catalog.get("layout") or "list", source)
    items = raw_catalog.get("items", [])
    if not isinstance(items, list):
        raise SystemExit(f"{source} field 'items' must be a JSON list.")
    return layout, items


def href_for(path_parts, relative_path):
    parts = ["documents", *path_parts, *Path(relative_path).parts]
    return "/" + "/".join(quote(part) for part in parts)


def normalize_file(
    raw_file,
    path_parts,
    index_dir,
    index_archive_id,
    used_file_archive_ids,
):
    source = index_dir / FILES_CATALOG
    if not isinstance(raw_file, dict):
        raise SystemExit(f"Every file item in {source} must be an object.")

    title = str(raw_file.get("title") or "").strip()
    record_id = str(raw_file.get("id") or "").strip()
    status = str(raw_file.get("status") or "Cleared").strip()
    relative_path = str(raw_file.get("path") or "").strip()

    if not title:
        raise SystemExit(f"A file item in {source} is missing title.")
    if not record_id:
        raise SystemExit(f"File '{title}' in {source} is missing id.")
    if not SHORT_FILE_ID_PATTERN.fullmatch(record_id):
        raise SystemExit(
            f"File '{title}' in {source} has invalid short id '{record_id}'. "
            "Use uppercase letters and numbers separated by hyphens."
        )
    if status not in VALID_FILE_STATUSES:
        raise SystemExit(
            f"File '{title}' in {source} has invalid status '{status}'. "
            "Files must use Cleared, InProgress, or Classified."
        )

    details = STATUS_DETAILS[status]
    linked_file_exists = bool(relative_path) and (index_dir / relative_path).is_file()
    is_available = linked_file_exists and status != "Classified"
    document_path = (
        "/".join(["documents", *path_parts, relative_path])
        if relative_path
        else ""
    )
    full_archive_id = f"{index_archive_id}-{record_id}"
    if full_archive_id in used_file_archive_ids:
        raise SystemExit(
            f"Duplicate generated file archive id '{full_archive_id}' in {source}."
        )
    used_file_archive_ids.add(full_archive_id)

    return {
        "id": record_id,
        "archiveId": full_archive_id,
        "title": title,
        "path": document_path,
        "href": href_for(path_parts, relative_path) if is_available else "",
        "status": status,
        "className": details["className"],
        "statusLabel": details["statusLabel"],
        "actionLabel": details["actionLabel"]
        if is_available
        else "PDF Unavailable",
        "isAvailable": is_available,
    }


def build_index(
    item,
    item_dir,
    path_parts,
    item_archive_id,
    used_file_archive_ids,
):
    item_dir.mkdir(parents=True, exist_ok=True)
    layout, raw_files = load_files(item_dir)
    documents = [
        normalize_file(
            raw_file,
            path_parts,
            item_dir,
            item_archive_id,
            used_file_archive_ids,
        )
        for raw_file in raw_files
    ]
    accessible = item["status"] != "Classified"
    details = STATUS_DETAILS[item["status"]]
    availability = (
        "classified"
        if not accessible
        else "available"
        if documents
        else "maintenance"
    )

    return {
        **item,
        "archiveId": item_archive_id,
        "className": details["className"],
        "isAccessible": accessible,
        "layout": layout,
        "count": len(documents),
        "availability": availability,
        "documents": documents if accessible else [],
    }


def build_catalog(
    folder,
    catalog_path,
    path_parts,
    default_kind="index",
    archive_prefix=None,
    used_archive_ids=None,
    used_file_archive_ids=None,
):
    catalog = load_catalog(folder, catalog_path, default_kind)
    if used_archive_ids is None:
        used_archive_ids = set()
    if used_file_archive_ids is None:
        used_file_archive_ids = set()
    if archive_prefix is None:
        root_code = str(catalog["archiveCode"] or "L9").strip().upper()
        validate_archive_code(root_code, catalog_path)
        archive_prefix = [root_code]

    items = []
    seen_ids = set()
    seen_codes = set()

    for raw_item in catalog["items"]:
        item = clean_catalog_item(raw_item, catalog, catalog_path)
        if item["id"] in seen_ids:
            raise SystemExit(f"Duplicate id '{item['id']}' in {catalog_path}.")
        seen_ids.add(item["id"])
        if item["code"] in seen_codes:
            raise SystemExit(
                f"Duplicate generated code '{item['code']}' in {catalog_path}. "
                "Add a code override to one of the colliding items."
            )
        seen_codes.add(item["code"])

        item_dir = folder / item["id"]
        item_path = [*path_parts, item["id"]]
        item_archive_id = archive_id([*archive_prefix, item["code"]])
        if item_archive_id in used_archive_ids:
            raise SystemExit(
                f"Duplicate generated archive id '{item_archive_id}' in {catalog_path}."
            )
        used_archive_ids.add(item_archive_id)

        if item["kind"] == "index":
            built_item = build_index(
                item,
                item_dir,
                item_path,
                item_archive_id,
                used_file_archive_ids,
            )
        else:
            item_dir.mkdir(parents=True, exist_ok=True)
            child_prefix = (
                [*archive_prefix, item["code"]]
                if item["includeCodeInDescendants"]
                else archive_prefix
            )
            child = build_catalog(
                item_dir,
                item_dir / CATALOG_NAME,
                item_path,
                default_kind="index",
                archive_prefix=child_prefix,
                used_archive_ids=used_archive_ids,
                used_file_archive_ids=used_file_archive_ids,
            )
            accessible = item["status"] != "Classified"
            details = STATUS_DETAILS[item["status"]]
            availability = (
                "classified"
                if not accessible
                else "available"
                if child["items"]
                else "maintenance"
            )
            built_item = {
                **item,
                "archiveId": item_archive_id,
                "className": details["className"],
                "isAccessible": accessible,
                "availability": availability,
                "layout": child["layout"],
                "count": len(child["items"]) if accessible else None,
                "items": child["items"] if accessible else [],
            }
        items.append(built_item)

    return {
        "archiveId": archive_id(archive_prefix),
        "layout": catalog["layout"],
        "items": items,
    }


def build_manifest():
    root = build_catalog(
        DOCUMENTS_DIR,
        ROOT_CATALOG_PATH,
        [],
        default_kind="catalog",
    )
    return {
        "station": "Orbital Archive Station L-9",
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "root": {
            "id": "archive",
            "archiveId": root["archiveId"],
            "title": "Archive Divisions",
            "kicker": "Directory",
            **root,
        },
    }


def validate_book_url(value, source, field, required=False):
    url = str(value or "").strip()
    if required and not url:
        raise SystemExit(f"A published book in {source} is missing {field}.")
    return url


def normalize_book(raw_book, index, source):
    if not isinstance(raw_book, dict):
        raise SystemExit(f"Every item in {source} must be an object.")

    title = str(raw_book.get("title") or "").strip()
    series = str(raw_book.get("series") or "").strip()
    short_description = str(raw_book.get("shortDescription") or "").strip()
    published = bool(raw_book.get("published", False))
    image_url = validate_book_url(raw_book.get("imageUrl"), source, "imageUrl")
    amazon_url = validate_book_url(
        raw_book.get("amazonUrl"),
        source,
        "amazonUrl",
        required=published,
    )

    if not title:
        raise SystemExit(f"Book item #{index} in {source} is missing title.")
    if not series:
        raise SystemExit(f"Book '{title}' in {source} is missing series.")
    if not short_description:
        raise SystemExit(
            f"Book '{title}' in {source} is missing shortDescription."
        )
    if not image_url:
        raise SystemExit(f"Book '{title}' in {source} is missing imageUrl.")

    return {
        "title": title,
        "series": series,
        "shortDescription": short_description,
        "imageUrl": image_url,
        "amazonUrl": amazon_url if published else "",
        "published": published,
    }


def build_books_manifest():
    raw_books = read_json(BOOKS_SOURCE_PATH, DEFAULT_BOOKS)
    if not isinstance(raw_books, list):
        raise SystemExit(f"{BOOKS_SOURCE_PATH} must contain a JSON list.")

    books = [
        normalize_book(raw_book, index + 1, BOOKS_SOURCE_PATH)
        for index, raw_book in enumerate(raw_books)
    ]
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "items": books,
    }


def write_js_manifest(path, namespace, manifest):
    path.write_text(
        f"window.{namespace} = {json.dumps(manifest, indent=2)};\n",
        encoding="utf-8",
    )


def main():
    archive_manifest = build_manifest()
    books_manifest = build_books_manifest()
    write_js_manifest(ARCHIVE_OUTPUT_PATH, "archiveManifest", archive_manifest)
    write_js_manifest(BOOKS_OUTPUT_PATH, "booksManifest", books_manifest)
    print(
        f"Generated {ARCHIVE_OUTPUT_PATH.relative_to(PROJECT_ROOT)} "
        f"with {len(archive_manifest['root']['items'])} top-level collections."
    )
    print(
        f"Generated {BOOKS_OUTPUT_PATH.relative_to(PROJECT_ROOT)} "
        f"with {len(books_manifest['items'])} books."
    )


if __name__ == "__main__":
    main()
