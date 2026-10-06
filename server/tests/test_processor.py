from __future__ import annotations

import zipfile
from pathlib import Path

from app.processor import patch_xml, process_presentation


SAMPLE_XML = b'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
       xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree><p:sp><p:txBody><a:bodyPr/><a:lstStyle/>
    <a:p>
      <a:r><a:rPr lang="en-US" dirty="0" err="1" noProof="1"/><a:t>Example</a:t></a:r>
      <a:r><a:t>Text without explicit properties</a:t></a:r>
      <a:endParaRPr lang="en-US" dirty="0"/>
    </a:p>
  </p:txBody></p:sp></p:spTree></p:cSld>
</p:sld>'''


def test_patch_xml_resets_proofing_and_inserts_missing_rpr():
    patched, stats = patch_xml(SAMPLE_XML)
    assert b'lang="ru-RU"' in patched
    assert b'dirty="1"' in patched
    assert b'err=' not in patched
    assert b'noProof=' not in patched
    assert b'<a:rPr lang="ru-RU" dirty="1"/><a:t>Text without explicit properties</a:t>' in patched
    assert stats["missing_rpr_inserted"] == 1
    assert stats["err_removed"] == 1
    assert stats["noproof_removed"] == 1


def test_process_presentation_preserves_package_and_modifies_slide(tmp_path: Path):
    source = tmp_path / "sample.pptx"
    output = tmp_path / "sample_RU_FIXED.pptx"

    with zipfile.ZipFile(source, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", "<Types xmlns='http://schemas.openxmlformats.org/package/2006/content-types'/>")
        archive.writestr("ppt/presentation.xml", "<p:presentation xmlns:p='http://schemas.openxmlformats.org/presentationml/2006/main'/>")
        archive.writestr("ppt/slides/slide1.xml", SAMPLE_XML)

    stats = process_presentation(source, output)
    assert output.exists()
    assert stats["xml_parts_changed"] == 1

    with zipfile.ZipFile(output, "r") as archive:
        slide = archive.read("ppt/slides/slide1.xml")
        assert b'lang="ru-RU"' in slide
        assert b'err=' not in slide
        assert b'noProof=' not in slide
