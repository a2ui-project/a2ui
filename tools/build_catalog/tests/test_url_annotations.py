# Copyright 2024 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent.resolve()))
from url_annotations import (
    find_url_annotation_problems,
    looks_like_url_property,
    main,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
DYNAMIC_STRING = {"$ref": "common_types.json#/$defs/DynamicString"}


def catalog(components, catalog_id="urn:test", **extra):
    return {"catalogId": catalog_id, "components": components, **extra}


class LooksLikeUrlPropertyTest(unittest.TestCase):

    def test_url_like_names(self):
        for name in [
            "url",
            "uri",
            "href",
            "src",
            "imageUrl",
            "posterUrl",
            "avatarURL",
            "resourceUri",
            "image_url",
        ]:
            with self.subTest(name=name):
                self.assertTrue(looks_like_url_property(name))

    def test_other_names(self):
        for name in [
            "urlLabel",
            "title",
            "source",
            "curl",
            "hrefs",
            "Url",
            "uriScheme",
        ]:
            with self.subTest(name=name):
                self.assertFalse(looks_like_url_property(name))


class FindUrlAnnotationProblemsTest(unittest.TestCase):

    def test_reports_unmarked_url_property(self):
        problems = find_url_annotation_problems(
            catalog({
                "ProductCard": {
                    "properties": {"title": DYNAMIC_STRING, "imageUrl": DYNAMIC_STRING}
                }
            })
        )
        self.assertEqual(problems, ["ProductCard.imageUrl: no x-a2ui-url-context"])

    def test_accepts_every_known_mark(self):
        for mark in ["media", "navigation", "iframe", "none"]:
            with self.subTest(mark=mark):
                self.assertEqual(
                    find_url_annotation_problems(
                        catalog({
                            "Card": {
                                "properties": {
                                    "imageUrl": {
                                        **DYNAMIC_STRING,
                                        "x-a2ui-url-context": mark,
                                    }
                                }
                            }
                        })
                    ),
                    [],
                )

    def test_reports_unknown_mark_on_any_property(self):
        problems = find_url_annotation_problems(
            catalog({
                "Card": {
                    "properties": {
                        "imageUrl": {"type": "string", "x-a2ui-url-context": "image"},
                        "title": {"type": "string", "x-a2ui-url-context": True},
                    }
                }
            })
        )
        self.assertEqual(
            problems,
            [
                'Card.imageUrl: unknown x-a2ui-url-context value "image"',
                "Card.title: unknown x-a2ui-url-context value true",
            ],
        )

    def test_skips_properties_that_cannot_hold_a_string(self):
        self.assertEqual(
            find_url_annotation_problems(
                catalog({
                    "Card": {
                        "properties": {
                            "imageUrl": {"type": "object", "properties": {}},
                            "src": {"type": ["array", "null"]},
                            "href": {"type": ["string", "null"]},
                        }
                    }
                })
            ),
            ["Card.href: no x-a2ui-url-context"],
        )

    def test_walks_nested_objects_arrays_and_combinators(self):
        problems = find_url_annotation_problems(
            catalog(
                {
                    "Gallery": {
                        "allOf": [
                            {"$ref": "#/$defs/Common"},
                            {
                                "properties": {
                                    "items": {
                                        "type": "array",
                                        "items": {
                                            "type": "object",
                                            "properties": {
                                                "thumbnailUrl": DYNAMIC_STRING,
                                                "link": {
                                                    "oneOf": [{
                                                        "type": "object",
                                                        "properties": {
                                                            "href": DYNAMIC_STRING
                                                        },
                                                    }]
                                                },
                                            },
                                        },
                                    }
                                }
                            },
                        ]
                    }
                },
                **{
                    "$defs": {
                        "Common": {
                            "properties": {
                                "iconSrc": {"type": "string"},
                                "src": DYNAMIC_STRING,
                            }
                        }
                    }
                },
            )
        )
        self.assertEqual(
            problems,
            [
                "Gallery.src: no x-a2ui-url-context",
                "Gallery.items[].thumbnailUrl: no x-a2ui-url-context",
                "Gallery.items[].link.href: no x-a2ui-url-context",
            ],
        )

    def test_follows_recursive_refs_once(self):
        problems = find_url_annotation_problems(
            catalog(
                {"Tree": {"$ref": "#/$defs/Node"}},
                **{
                    "$defs": {
                        "Node": {
                            "properties": {
                                "iconUrl": DYNAMIC_STRING,
                                "children": {
                                    "type": "array",
                                    "items": {"$ref": "#/$defs/Node"},
                                },
                            }
                        }
                    }
                },
            )
        )
        self.assertEqual(problems, ["Tree.iconUrl: no x-a2ui-url-context"])

    def test_built_in_list_covers_basic_catalog_ids_only(self):
        components = {
            "Image": {"properties": {"url": DYNAMIC_STRING}},
            "Video": {
                "properties": {"url": DYNAMIC_STRING, "posterUrl": DYNAMIC_STRING}
            },
        }
        for catalog_id in [
            "https://a2ui.org/specification/v0_9/catalogs/basic/catalog.json",
            "https://a2ui.org/specification/v1_0/catalogs/basic/catalog.json",
        ]:
            with self.subTest(catalog_id=catalog_id):
                self.assertEqual(
                    find_url_annotation_problems(catalog(components, catalog_id)), []
                )
        self.assertEqual(
            find_url_annotation_problems(catalog(components, "urn:my-catalog")),
            [
                "Image.url: no x-a2ui-url-context",
                "Video.url: no x-a2ui-url-context",
                "Video.posterUrl: no x-a2ui-url-context",
            ],
        )

    def test_ignores_functions(self):
        self.assertEqual(
            find_url_annotation_problems(
                catalog(
                    {},
                    functions={
                        "openUrl": {"properties": {"args": {"properties": {"url": {}}}}}
                    },
                )
            ),
            [],
        )


class MainTest(unittest.TestCase):

    def run_main(self, *paths):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            status = main([str(p) for p in paths])
        return status, out.getvalue()

    def test_repository_catalogs_pass(self):
        status, output = self.run_main(
            REPO_ROOT / "catalogs",
            REPO_ROOT / "specification" / "v0_9" / "catalogs",
            REPO_ROOT / "specification" / "v0_9_1" / "catalogs",
        )
        self.assertEqual((status, output), (0, ""))

    def test_fails_and_names_the_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "nested" / "catalog.json"
            path.parent.mkdir()
            path.write_text(
                json.dumps(catalog({"Card": {"properties": {"href": DYNAMIC_STRING}}}))
            )
            status, output = self.run_main(tmp)
        self.assertEqual(status, 1)
        self.assertIn(f"{path}: Card.href: no x-a2ui-url-context", output)


if __name__ == "__main__":
    unittest.main()
