# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#      https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""Test that A2uiValidator caching eliminates redundant construction.

This validates the fix for https://github.com/a2ui-project/a2ui/issues/1971:
Caching the validator avoids repeated work on every .validator access,
and ensures that in restricted execution environments (like Temporal
workflows), the validator is built once and reused.
"""

from unittest import mock

import pytest

from a2ui.basic_catalog import BasicCatalog
from a2ui.core import A2uiValidationError
from a2ui.inference_formats.transport.format import TransportFormat
from a2ui.schema.constants import VERSION_0_9


def _make_catalog():
    """Create a real A2uiCatalog with v0.9 basic catalog."""
    tf = TransportFormat(VERSION_0_9, catalogs=[BasicCatalog.get_config(VERSION_0_9)])
    return tf._supported_catalogs[0]


def _clear_cache_for(cat):
    """Clear the cached_property validator for a specific catalog instance."""
    try:
        object.__delattr__(cat, "validator")
    except AttributeError:
        pass


def test_validator_is_cached():
    """Two calls to .validator return the same instance."""
    cat = _make_catalog()
    v1 = cat.validator
    v2 = cat.validator
    assert v1 is v2, "validator property should return cached instance"


def test_uncached_validator_creates_new_instance():
    """Without cache, each access creates a new validator."""
    cat = _make_catalog()

    v1 = cat.validator
    _clear_cache_for(cat)
    v2 = cat.validator

    assert v1 is not v2, "After cache clear, a new validator should be constructed"


def test_cached_validator_survives_import_restrictions():
    """A cached validator still works even if imports are blocked."""
    cat = _make_catalog()

    # Prime the cache
    v1 = cat.validator

    # Block the referencing import that happens during construction
    with mock.patch.dict("sys.modules", {"referencing": None}):
        # Should hit cache, not try to import referencing
        v2 = cat.validator

    assert v1 is v2, "Cached validator should be returned without re-importing"


def test_validate_works_on_cached_validator():
    """validate() on a cached validator produces correct results."""
    cat = _make_catalog()

    payload = [{
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "test",
            "catalogId": cat.catalog_id,
        },
    }]

    # First call — primes cache
    cat.validator.validate(payload)

    # Second call — uses cache
    cat.validator.validate(payload)

    # Verify it's the same instance doing both
    assert cat.validator is cat.validator


def test_validate_rejects_invalid_on_cached_validator():
    """Cached validator still correctly rejects invalid payloads."""
    cat = _make_catalog()

    # Prime cache with a valid call
    cat.validator.validate([{
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "test",
            "catalogId": cat.catalog_id,
        },
    }])

    # Now try an invalid payload — should still reject
    invalid_payload = [{"bogus": "data"}]
    with pytest.raises(A2uiValidationError):
        cat.validator.validate(invalid_payload)


def test_cache_is_per_catalog_instance():
    """Different catalog instances get different cached validators."""
    cat1 = _make_catalog()
    cat2 = _make_catalog()

    v1 = cat1.validator
    v2 = cat2.validator

    # Different catalog instances should produce different validators
    assert v1 is not v2, "Different catalogs should have different validators"
    # But each should be cached
    assert cat1.validator is v1
    assert cat2.validator is v2


def test_multiple_validate_calls_use_same_instance():
    """Validator construction only happens once across many validate calls."""
    cat = _make_catalog()
    payload = [{
        "version": "v0.9",
        "createSurface": {
            "surfaceId": "test",
            "catalogId": cat.catalog_id,
        },
    }]

    # Prime cache
    first_validator = cat.validator

    # Run validate many times
    for _ in range(10):
        cat.validator.validate(payload)

    # All should have used the same cached validator
    assert cat.validator is first_validator
