#!/usr/bin/env python3
"""Regression checks for two previously accepted invalid recipes; never rewrite data/reports."""
import contextlib
import copy
import io
import pathlib
import unittest
from unittest.mock import patch

import validate_design as validator


class RecipeValidationRegression(unittest.TestCase):
    def setUp(self):
        validator.checks.clear()
        validator.errors.clear()

    def tearDown(self):
        validator.checks.clear()
        validator.errors.clear()

    def validate_changed_group(self, filename, change):
        target = validator.PACKAGE / 'data/equipment' / filename
        original_read = validator.read
        changed = []

        def read_changed(path):
            data = original_read(path)
            if pathlib.Path(path).resolve() == target:
                data = copy.deepcopy(data)
                change(data)
                changed.append(True)
            return data

        with patch.object(validator, 'read', side_effect=read_changed), \
                patch.object(validator, 'write') as report_write, \
                contextlib.redirect_stdout(io.StringIO()):
            result = validator.main()

        self.assertEqual(changed, [True], 'The intended recipe fixture must be changed exactly once.')
        self.assertEqual(result, 1)
        self.assertEqual(len(validator.errors), 1)
        self.assertEqual(report_write.call_args.args[1]['errorCount'], 1)
        return validator.errors[0]

    def test_changed_money_is_rejected_even_with_unchanged_source_record(self):
        def change(group):
            recipe = next(r for r in group['recipes'] if r['id'] == 'recipe.heavy_blade.002')
            self.assertEqual(recipe['money'], 120)
            recipe['money'] = 121
            self.assertEqual(recipe['sourceRecord']['cost']['money'], 120)

        error = self.validate_changed_group('001-galdros.json', change)
        self.assertEqual(error, 'weapon.heavy_blade.002 runtime recipe output changed: money')

    def test_rank_two_recipe_cannot_require_existing_rank_four_material(self):
        def change(group):
            recipe = next(r for r in group['recipes'] if r['resultId'] == 'weapon.heavy_blade.nemboraf.r2')
            self.assertEqual(recipe['rank'], 2)
            self.assertEqual(recipe['ingredients'][0]['materialId'], 'mat.nemboraf.main')
            recipe['ingredients'][0]['materialId'] = 'mat.nemboraf.main.r4'

        error = self.validate_changed_group('030-nemboraf.json', change)
        self.assertEqual(error, 'recipe.craft.weapon.heavy_blade.nemboraf.r2 material grade exceeds recipe rank: mat.nemboraf.main.r4')


if __name__ == '__main__':
    unittest.main()
