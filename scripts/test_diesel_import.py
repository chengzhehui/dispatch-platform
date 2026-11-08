import importlib.util
from pathlib import Path
import sqlite3
import unittest
from contextlib import closing

spec = importlib.util.spec_from_file_location('diesel_import', Path(__file__).with_name('import_diesel_history.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ImportTests(unittest.TestCase):
    def test_date_and_cap_welder_normalization(self):
        self.assertEqual(module.date_text('2026/9/6'), '2026-09-06')
        self.assertEqual(module.date_text('invalid date'), '')
        self.assertEqual(module.cap_welders('0015 / 2017A、0015'), ['0015', '2017A'])
        self.assertEqual(module.cap_welders(None), [])
        self.assertEqual(module.key(' PD02 ', 'L / 1', ' yd2 '), 'PD02|L/1|YD2')

    def test_database_snapshot_conserves_source_rows_and_missing_data(self):
        database = (Path(__file__).resolve().parents[1] / 'server-data/diesel-history/welding.db')
        with closing(sqlite3.connect(database.as_uri() + '?mode=ro', uri=True)) as db:
            self.assertEqual(db.execute('select count(*) from weld_records').fetchone()[0], 57822)
            self.assertEqual(db.execute("select count(*) from weld_records where weld_date!=''").fetchone()[0], 35462)
            self.assertEqual(db.execute("select count(*) from weld_records where weld_date!='' and cap_welders_json='[]'").fetchone()[0], 1)
            codes = {row[0] for row in db.execute("select cap_welders_json from weld_records where weld_date='2026-09-16'")}
            self.assertIn('["0015"]', codes)


if __name__ == '__main__':
    unittest.main()
