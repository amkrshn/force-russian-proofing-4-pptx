from __future__ import annotations

import os
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Callable, Dict, Iterable, Optional, Tuple

LANG = b"ru-RU"

DRAWINGML_URIS = (
    b"http://schemas.openxmlformats.org/drawingml/2006/main",
    b"http://purl.oclc.org/ooxml/drawingml/main",
)

PROP_LOCAL_NAMES = (b"rPr", b"defRPr", b"endParaRPr")
ATTR_RE_CACHE: Dict[bytes, re.Pattern[bytes]] = {}

MAX_ZIP_ENTRIES = int(os.getenv("MAX_ZIP_ENTRIES", "10000"))
MAX_UNCOMPRESSED_BYTES = int(os.getenv("MAX_UNCOMPRESSED_BYTES", str(500 * 1024 * 1024)))
MAX_COMPRESSION_RATIO = float(os.getenv("MAX_COMPRESSION_RATIO", "250"))


class PresentationValidationError(ValueError):
    pass


def attr_re(name: bytes) -> re.Pattern[bytes]:
    if name not in ATTR_RE_CACHE:
        ATTR_RE_CACHE[name] = re.compile(
            rb"(?<![A-Za-z0-9_.:-])" + re.escape(name) + rb"\s*=\s*([\"'])(.*?)\1",
            re.DOTALL,
        )
    return ATTR_RE_CACHE[name]


def has_attr(tag: bytes, name: bytes) -> bool:
    return attr_re(name).search(tag) is not None


def set_attr(tag: bytes, name: bytes, value: bytes) -> Tuple[bytes, bool]:
    pattern = attr_re(name)
    replacement = name + b'="' + value + b'"'

    if pattern.search(tag):
        new_tag = pattern.sub(replacement, tag, count=1)
        return new_tag, new_tag != tag

    pos = tag.rfind(b"/>")
    if pos != -1:
        new_tag = tag[:pos].rstrip() + b" " + replacement + b"/>"
        return new_tag, True

    pos = tag.rfind(b">")
    if pos != -1:
        new_tag = tag[:pos].rstrip() + b" " + replacement + b">"
        return new_tag, True

    return tag, False


def remove_attr(tag: bytes, name: bytes) -> Tuple[bytes, bool]:
    pattern = re.compile(
        rb"\s+" + re.escape(name) + rb"\s*=\s*([\"'])(.*?)\1",
        re.DOTALL,
    )
    new_tag, n = pattern.subn(b"", tag)
    return new_tag, n > 0


def drawingml_prefixes(xml: bytes) -> Iterable[bytes]:
    prefixes = set()
    for uri in DRAWINGML_URIS:
        prefixed = re.compile(
            rb"xmlns:([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*([\"'])"
            + re.escape(uri)
            + rb"\2"
        )
        for match in prefixed.finditer(xml):
            prefixes.add(match.group(1))

        default = re.compile(rb"xmlns\s*=\s*([\"'])" + re.escape(uri) + rb"\1")
        if default.search(xml):
            prefixes.add(b"")

    return prefixes


def make_prop_tag_regex(prefix: bytes) -> re.Pattern[bytes]:
    names = b"|".join(re.escape(name) for name in PROP_LOCAL_NAMES)
    if prefix:
        start = rb"<" + re.escape(prefix) + rb":(?:" + names + rb")\b"
    else:
        start = rb"<(?:" + names + rb")\b"
    return re.compile(start + rb"[^>]*>", re.DOTALL)


def _run_regex(prefix: bytes, local_name: bytes) -> re.Pattern[bytes]:
    if prefix:
        qname = re.escape(prefix) + rb":" + re.escape(local_name)
    else:
        qname = re.escape(local_name)
    return re.compile(
        rb"(<" + qname + rb"\b[^>]*>)(.*?)(</" + qname + rb">)",
        re.DOTALL,
    )


def _contains_qname(body: bytes, prefix: bytes, local_name: bytes) -> bool:
    if prefix:
        needle = rb"<" + re.escape(prefix) + rb":" + re.escape(local_name) + rb"\b"
    else:
        needle = rb"<" + re.escape(local_name) + rb"\b"
    return re.search(needle, body) is not None


def _make_rpr(prefix: bytes) -> bytes:
    name = (prefix + b":" if prefix else b"") + b"rPr"
    return b"<" + name + b' lang="ru-RU" dirty="1"/>'


def patch_xml(xml: bytes) -> Tuple[bytes, Dict[str, int]]:
    stats = {
        "tags": 0,
        "lang_changed": 0,
        "altlang_changed": 0,
        "dirty_changed": 0,
        "err_removed": 0,
        "noproof_removed": 0,
        "missing_rpr_inserted": 0,
    }

    prefixes = list(drawingml_prefixes(xml))
    if not prefixes:
        return xml, stats

    result = xml

    for prefix in prefixes:
        prop_tag_re = make_prop_tag_regex(prefix)

        def patch_tag(match: re.Match[bytes]) -> bytes:
            tag = match.group(0)
            original = tag
            stats["tags"] += 1

            tag, changed = set_attr(tag, b"lang", LANG)
            if changed:
                stats["lang_changed"] += 1

            if has_attr(tag, b"altLang"):
                tag, changed = set_attr(tag, b"altLang", LANG)
                if changed:
                    stats["altlang_changed"] += 1

            tag, changed = remove_attr(tag, b"err")
            if changed:
                stats["err_removed"] += 1

            tag, changed = remove_attr(tag, b"noProof")
            if changed:
                stats["noproof_removed"] += 1

            tag, changed = set_attr(tag, b"dirty", b"1")
            if changed:
                stats["dirty_changed"] += 1

            return tag if tag != original else original

        result = prop_tag_re.sub(patch_tag, result)

        # Some PowerPoint runs contain text but no explicit rPr. In that case the
        # proofing language is inherited. Insert an explicit rPr so every actual
        # text run is normalized, matching the effect of confirming the Language dialog.
        for local_name in (b"r", b"fld"):
            run_re = _run_regex(prefix, local_name)

            def ensure_rpr(match: re.Match[bytes]) -> bytes:
                opening, body, closing = match.groups()
                if not _contains_qname(body, prefix, b"t"):
                    return match.group(0)
                if _contains_qname(body, prefix, b"rPr"):
                    return match.group(0)
                stats["missing_rpr_inserted"] += 1
                stats["tags"] += 1
                stats["lang_changed"] += 1
                stats["dirty_changed"] += 1
                return opening + _make_rpr(prefix) + body + closing

            result = run_re.sub(ensure_rpr, result)

    if result != xml:
        try:
            ET.fromstring(result)
        except ET.ParseError as exc:
            raise PresentationValidationError(f"Modified XML is invalid: {exc}") from exc

    return result, stats


def clone_zipinfo(info: zipfile.ZipInfo) -> zipfile.ZipInfo:
    clone = zipfile.ZipInfo(info.filename, date_time=info.date_time)
    clone.compress_type = info.compress_type
    clone.comment = info.comment
    clone.extra = info.extra
    clone.internal_attr = info.internal_attr
    clone.external_attr = info.external_attr
    clone.create_system = info.create_system
    clone.create_version = info.create_version
    clone.extract_version = info.extract_version
    clone.flag_bits = info.flag_bits
    clone.volume = info.volume
    return clone


def validate_presentation_package(path: Path) -> None:
    if not zipfile.is_zipfile(path):
        raise PresentationValidationError("The uploaded file is not a valid PowerPoint ZIP package.")

    with zipfile.ZipFile(path, "r") as archive:
        infos = archive.infolist()
        if len(infos) > MAX_ZIP_ENTRIES:
            raise PresentationValidationError("The presentation contains too many package entries.")

        names = {info.filename for info in infos}
        required = {"[Content_Types].xml", "ppt/presentation.xml"}
        missing = required - names
        if missing:
            raise PresentationValidationError(
                "The PowerPoint package is incomplete: " + ", ".join(sorted(missing))
            )

        total_uncompressed = sum(info.file_size for info in infos)
        if total_uncompressed > MAX_UNCOMPRESSED_BYTES:
            raise PresentationValidationError("The unpacked presentation is too large.")

        for info in infos:
            if info.file_size <= 0:
                continue
            compressed = max(info.compress_size, 1)
            ratio = info.file_size / compressed
            if ratio > MAX_COMPRESSION_RATIO:
                raise PresentationValidationError(
                    f"Suspicious compression ratio in package entry: {info.filename}"
                )


def process_presentation(
    src: Path,
    dst: Path,
    progress: Optional[Callable[[int, int, str], None]] = None,
) -> Dict[str, int]:
    validate_presentation_package(src)

    totals = {
        "entries": 0,
        "xml_parts": 0,
        "xml_parts_changed": 0,
        "tags": 0,
        "lang_changed": 0,
        "altlang_changed": 0,
        "dirty_changed": 0,
        "err_removed": 0,
        "noproof_removed": 0,
        "missing_rpr_inserted": 0,
    }

    temp_output = dst.with_suffix(dst.suffix + ".tmp")
    if temp_output.exists():
        temp_output.unlink()

    try:
        with zipfile.ZipFile(src, "r") as source:
            infos = source.infolist()
            totals["entries"] = len(infos)

            with zipfile.ZipFile(temp_output, "w", allowZip64=True) as target:
                for index, info in enumerate(infos, start=1):
                    if progress:
                        progress(index - 1, len(infos), info.filename)

                    data = source.read(info.filename)
                    new_data = data

                    is_target_xml = (
                        info.filename.startswith("ppt/")
                        and info.filename.lower().endswith(".xml")
                    )
                    if is_target_xml:
                        totals["xml_parts"] += 1
                        new_data, stats = patch_xml(data)
                        if new_data != data:
                            totals["xml_parts_changed"] += 1

                        for key in (
                            "tags",
                            "lang_changed",
                            "altlang_changed",
                            "dirty_changed",
                            "err_removed",
                            "noproof_removed",
                            "missing_rpr_inserted",
                        ):
                            totals[key] += stats[key]

                    target.writestr(clone_zipinfo(info), new_data)

                if progress:
                    progress(len(infos), len(infos), "Validating output package")

        validate_presentation_package(temp_output)
        with zipfile.ZipFile(temp_output, "r") as check:
            bad = check.testzip()
            if bad is not None:
                raise PresentationValidationError(f"CRC validation failed for: {bad}")

        os.replace(temp_output, dst)
        return totals

    except Exception:
        if temp_output.exists():
            try:
                temp_output.unlink()
            except OSError:
                pass
        raise
