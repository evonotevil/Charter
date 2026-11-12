#!/usr/bin/env python3
"""Populate Figma placeholder color variables from a DTCG color group."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


def figma_color(value: str) -> dict[str, Any]:
    match = re.fullmatch(r"#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?", value)
    if not match:
        raise ValueError(f"Unsupported color value: {value}")
    rgb = match.group(1)
    return {
        "colorSpace": "srgb",
        "components": [int(rgb[index : index + 2], 16) / 255 for index in (0, 2, 4)],
        "alpha": int(match.group(2), 16) / 255 if match.group(2) else 1,
        "hex": f"#{rgb.upper()}",
    }


def patch_mode(native_path: Path, tokens_path: Path, output_path: Path, mode: str) -> None:
    native = json.loads(native_path.read_text(encoding="utf-8"))
    source = json.loads(tokens_path.read_text(encoding="utf-8"))

    color_group = source["color"]
    colors = {
        name: token
        for name, token in color_group.items()
        if not name.startswith("$")
    }
    if len(colors) != 28:
        raise ValueError(f"Expected 28 colors, found {len(colors)}")

    def patched_color(existing: dict[str, Any], token: dict[str, Any]) -> dict[str, Any]:
        variable_id = existing.get("$extensions", {}).get("com.figma.variableId")
        if not variable_id:
            raise ValueError("Color variable has no Figma variable ID")
        description = token.get("$description")
        return {
            "$type": "color",
            "$value": figma_color(token["$value"]),
            **({"$description": description} if description else {}),
            "$extensions": existing["$extensions"],
        }

    placeholders = [key for key in native if re.fullmatch(r"Color(?: \d+)?", key)]
    if placeholders:
        if len(placeholders) != len(colors):
            raise ValueError(
                f"Expected {len(colors)} placeholder colors, found {len(placeholders)}"
            )
        color_variables = {
            name: patched_color(native[placeholder], token)
            for placeholder, (name, token) in zip(
                placeholders, colors.items(), strict=True
            )
        }
        patched: dict[str, Any] = {}
        inserted = False
        placeholder_set = set(placeholders)
        for key, value in native.items():
            if key == placeholders[0]:
                patched["color"] = color_variables
                inserted = True
            elif key not in placeholder_set:
                patched[key] = value
        if not inserted:
            raise ValueError("Could not place color group in native export")
    elif isinstance(native.get("color"), dict):
        existing_colors = [
            key for key in native["color"] if not key.startswith("$")
        ]
        if existing_colors != list(colors):
            raise ValueError(
                "Native color group does not match the source color token order"
            )
        patched = json.loads(json.dumps(native))
        patched["color"] = {
            name: patched_color(native["color"][name], token)
            for name, token in colors.items()
        }
    else:
        raise ValueError("Native export has no color placeholders or color group")

    patched.setdefault("$extensions", {})["com.figma.modeName"] = mode
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(patched, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Wrote {output_path} with {len(colors)} colors for mode {mode}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--native", type=Path, required=True)
    parser.add_argument("--tokens", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--mode", required=True)
    args = parser.parse_args()
    patch_mode(args.native, args.tokens, args.output, args.mode)


if __name__ == "__main__":
    main()
